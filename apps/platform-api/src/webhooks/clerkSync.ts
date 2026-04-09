import { FastifyReply, FastifyRequest } from "fastify";
import { Webhook } from "svix";
import { createLogger } from "@rezovo/logging";
import { env } from "../env";
import { AuthStoreClient } from "../auth/storeClient";
import { getClerkBackendClient } from "../auth/clerk";

const logger = createLogger({ service: "platform-api", module: "clerkSync" });
const authStore = new AuthStoreClient();

function getHeader(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0];
  return v;
}

type ClerkWebhookEvt = {
  type: string;
  data: Record<string, unknown>;
};

/**
 * POST /webhooks/clerk — Clerk Dashboard webhook with Svix verification.
 * Configure URL in Clerk; use signing secret as CLERK_WEBHOOK_SECRET.
 */
export async function clerkSyncHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const secret = env.CLERK_WEBHOOK_SECRET?.trim();
  if (!secret) {
    reply.status(503).send({ error: "webhook_not_configured", message: "CLERK_WEBHOOK_SECRET is not set" });
    return;
  }

  const rawBody = (request as { rawBody?: Buffer | string }).rawBody;
  if (rawBody === undefined || rawBody === null) {
    logger.error("clerk webhook missing raw body — ensure fastify-raw-body on this route");
    reply.status(500).send({ error: "server_misconfiguration" });
    return;
  }

  const payloadString = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody);

  const svixId = getHeader(request, "svix-id");
  const svixTimestamp = getHeader(request, "svix-timestamp");
  const svixSignature = getHeader(request, "svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    reply.status(400).send({ error: "missing_svix_headers" });
    return;
  }

  let evt: ClerkWebhookEvt;
  try {
    const wh = new Webhook(secret);
    evt = wh.verify(payloadString, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ClerkWebhookEvt;
  } catch (e) {
    logger.warn("clerk webhook verify failed", { error: (e as Error).message });
    reply.status(400).send({ error: "invalid_signature" });
    return;
  }

  try {
    await dispatchClerkEvent(evt);
  } catch (e) {
    logger.error("clerk webhook handler error", { error: (e as Error).message, type: evt.type });
    reply.status(500).send({ error: "handler_failed" });
    return;
  }

  reply.send({ ok: true });
}

async function dispatchClerkEvent(evt: ClerkWebhookEvt): Promise<void> {
  const { type, data } = evt;
  if (!data || typeof data !== "object") return;

  switch (type) {
    case "user.created":
    case "user.updated":
      await handleUserUpsert(data);
      break;
    case "organization.updated":
    case "organization.created":
      await handleOrganizationUpsert(data);
      break;
    case "organizationMembership.created":
    case "organizationMembership.updated":
      await handleOrganizationMembership(data);
      break;
    default:
      logger.debug("clerk webhook ignored event type", { type });
  }
}

async function handleUserUpsert(data: Record<string, unknown>): Promise<void> {
  const id = data.id as string | undefined;
  if (!id) return;

  const emails = data.email_addresses as Array<{ email_address?: string }> | undefined;
  const email = emails?.[0]?.email_address;
  if (!email) {
    logger.warn("clerk user event missing email", { clerkId: id });
    return;
  }

  const first = (data.first_name as string) ?? "";
  const last = (data.last_name as string) ?? "";
  const name = [first, last].filter(Boolean).join(" ") || undefined;

  // User events do not carry authoritative org membership.
  // Only update an already-provisioned user row; membership events create tenant assignments.
  const existing = (await authStore.findByClerkId(id)) ?? (await authStore.findByEmail(email));
  if (!existing) {
    logger.debug("clerk user event skipped pending organization membership sync", { clerkId: id, email });
    return;
  }

  await authStore.upsertUser({
    id: `clerk-${id}`,
    tenantId: existing.tenantId,
    email,
    clerkId: id,
    name,
    roles: existing.roles,
  });

  logger.info("clerk user profile synced on existing tenant assignment", {
    clerkId: id,
    email,
    tenantId: existing.tenantId,
  });
}

async function handleOrganizationUpsert(data: Record<string, unknown>): Promise<void> {
  const orgId = data.id as string | undefined;
  if (!orgId) {
    return;
  }

  await authStore.upsertTenantFromClerkOrg({
    orgId,
    name: (data.name as string | undefined) ?? orgId,
    slug: data.slug as string | undefined,
    imageUrl: data.image_url as string | undefined,
    membersCount: typeof data.members_count === "number" ? data.members_count : undefined,
    publicMetadata: (data.public_metadata as Record<string, unknown> | undefined) ?? {},
    privateMetadata: (data.private_metadata as Record<string, unknown> | undefined) ?? {},
  });

  logger.info("upserted tenant from Clerk organization", { orgId });
}

async function handleOrganizationMembership(data: Record<string, unknown>): Promise<void> {
  const org = data.organization as { id?: string } | undefined;
  const orgId = org?.id ?? (data.organization_id as string | undefined);
  const publicUser = data.public_user_data as { user_id?: string } | undefined;
  const clerkUserId = publicUser?.user_id;
  if (!orgId || !clerkUserId) {
    logger.warn("organizationMembership missing org or user", { orgId, clerkUserId });
    return;
  }

  const tenantId = await authStore.findActiveTenantId(orgId);
  if (!tenantId) {
    logger.warn("organizationMembership: org not linked to tenant", { orgId, clerkUserId });
    return;
  }

  const clerk = getClerkBackendClient();
  let email = "";
  try {
    const u = await clerk.users.getUser(clerkUserId);
    const primary = u.emailAddresses?.find((e: { id: string }) => e.id === u.primaryEmailAddressId) ?? u.emailAddresses?.[0];
    email = primary?.emailAddress ?? "";
  } catch (e) {
    logger.warn("could not fetch Clerk user for membership", { clerkUserId, error: (e as Error).message });
  }
  if (!email) {
    logger.warn("organizationMembership: no email for user", { clerkUserId });
    return;
  }

  await authStore.upsertUser({
    id: `clerk-${clerkUserId}`,
    tenantId: orgId,
    email,
    clerkId: clerkUserId,
  });

  logger.info("clerk user tenant set from membership", { clerkUserId, tenantId: orgId, orgId });
}
