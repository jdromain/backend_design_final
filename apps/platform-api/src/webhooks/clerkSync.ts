import { FastifyReply, FastifyRequest } from "fastify";
import { Webhook } from "svix";
import { createLogger } from "@rezovo/logging";
import { env } from "../env";
import { AuthStoreClient } from "../auth/storeClient";
import { getClerkBackendClient } from "../auth/clerk";
import { mapClerkOrgRoleToAppRoles } from "../auth/roleMap";

const logger = createLogger({ service: "platform-api", module: "clerkSync" });
const authStore = new AuthStoreClient();

function getHeader(req: FastifyRequest, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

type ClerkWebhookEvent = {
  type: string;
  data: Record<string, unknown>;
};

function normalizeEmailFromClerkUser(user: any): string {
  const primary = user.emailAddresses?.find((entry: { id: string }) => entry.id === user.primaryEmailAddressId) ?? user.emailAddresses?.[0];
  return primary?.emailAddress ?? "";
}

async function upsertMembershipByIds(params: { orgId: string; clerkUserId: string; role?: unknown }): Promise<void> {
  const clerk = getClerkBackendClient();
  const user = await clerk.users.getUser(params.clerkUserId);
  const email = normalizeEmailFromClerkUser(user);
  if (!email) {
    logger.warn("membership sync skipped: Clerk user has no email", { clerkUserId: params.clerkUserId, orgId: params.orgId });
    return;
  }

  await authStore.upsertUser({
    id: `clerk-${params.clerkUserId}-${params.orgId}`,
    orgId: params.orgId,
    email,
    clerkId: params.clerkUserId,
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined,
    roles: mapClerkOrgRoleToAppRoles(params.role),
  });
}

/**
 * POST /webhooks/clerk — Clerk Dashboard webhook with Svix verification.
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

  let event: ClerkWebhookEvent;
  try {
    const webhook = new Webhook(secret);
    event = webhook.verify(payloadString, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ClerkWebhookEvent;
  } catch (error) {
    logger.warn("clerk webhook verify failed", { error: (error as Error).message });
    reply.status(400).send({ error: "invalid_signature" });
    return;
  }

  try {
    await dispatchClerkEvent(event);
  } catch (error) {
    logger.error("clerk webhook handler error", { error: (error as Error).message, type: event.type });
    reply.status(500).send({ error: "handler_failed" });
    return;
  }

  reply.send({ ok: true });
}

async function dispatchClerkEvent(event: ClerkWebhookEvent): Promise<void> {
  const { type, data } = event;
  if (!data || typeof data !== "object") return;

  switch (type) {
    case "organization.created":
    case "organization.updated":
      await handleOrganizationUpsert(data);
      break;
    case "organizationMembership.created":
    case "organizationMembership.updated":
      await handleOrganizationMembership(data);
      break;
    case "user.created":
    case "user.updated":
      await handleUserUpsert(data);
      break;
    default:
      logger.debug("clerk webhook ignored event type", { type });
  }
}

async function handleOrganizationUpsert(data: Record<string, unknown>): Promise<void> {
  const orgId = data.id as string | undefined;
  if (!orgId) return;

  await authStore.upsertOrgFromClerk({
    orgId,
    name: (data.name as string | undefined) ?? orgId,
    slug: data.slug as string | undefined,
    imageUrl: data.image_url as string | undefined,
    membersCount: typeof data.members_count === "number" ? data.members_count : undefined,
    publicMetadata: (data.public_metadata as Record<string, unknown> | undefined) ?? {},
    privateMetadata: (data.private_metadata as Record<string, unknown> | undefined) ?? {},
  });

  logger.info("upserted organization from Clerk", { orgId });
}

async function handleOrganizationMembership(data: Record<string, unknown>): Promise<void> {
  const orgObj = data.organization as { id?: string } | undefined;
  const orgId = orgObj?.id ?? (data.organization_id as string | undefined);
  const publicUser = data.public_user_data as { user_id?: string } | undefined;
  const clerkUserId = publicUser?.user_id;

  if (!orgId || !clerkUserId) {
    logger.warn("organizationMembership missing org or user", { orgId, clerkUserId });
    return;
  }

  const activeOrg = await authStore.findActiveOrgId(orgId);
  if (!activeOrg) {
    logger.warn("organizationMembership received for unknown org", { orgId, clerkUserId });
    return;
  }

  await upsertMembershipByIds({
    orgId,
    clerkUserId,
    role: (data.role as string | undefined) ?? (data as any).organizationMembership?.role,
  });

  logger.info("clerk membership synced", { orgId, clerkUserId });
}

async function handleUserUpsert(data: Record<string, unknown>): Promise<void> {
  const clerkUserId = data.id as string | undefined;
  if (!clerkUserId) return;

  const clerk = getClerkBackendClient();
  const memberships = await clerk.users.getOrganizationMembershipList({ userId: clerkUserId, limit: 50 });
  for (const membership of memberships.data ?? []) {
    const orgId = membership.organization?.id as string | undefined;
    if (!orgId) continue;

    const activeOrg = await authStore.findActiveOrgId(orgId);
    if (!activeOrg) continue;

    await upsertMembershipByIds({
      orgId,
      clerkUserId,
      role: (membership as any).role,
    });
  }

  logger.info("clerk user memberships reconciled", {
    clerkUserId,
    membershipCount: memberships.data?.length ?? 0,
  });
}
