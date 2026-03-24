import { FastifyRequest, FastifyReply } from "fastify";
import { createLogger } from "@rezovo/logging";
import { env } from "../env";
import { AuthStoreClient } from "../auth/storeClient";

const logger = createLogger({ service: "platform-api", module: "clerkSync" });
const authStore = new AuthStoreClient();

interface ClerkWebhookEvent {
  type: string;
  data: {
    id: string;
    email_addresses?: Array<{ email_address: string }>;
    first_name?: string;
    last_name?: string;
    [key: string]: unknown;
  };
}

export async function clerkSyncHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const secret = request.headers["x-rezovo-clerk-secret"] as string | undefined;
  if (!secret || secret !== env.REZOVO_CLERK_SYNC_SECRET) {
    reply.status(401).send({ error: "unauthorized" });
    return;
  }

  const event = request.body as ClerkWebhookEvent;
  if (!event?.type || !event?.data?.id) {
    reply.status(400).send({ error: "invalid webhook payload" });
    return;
  }

  if (event.type === "user.created" || event.type === "user.updated") {
    const email = event.data.email_addresses?.[0]?.email_address;
    if (!email) {
      logger.warn("clerk webhook missing email", { clerkId: event.data.id });
      reply.send({ ok: true, skipped: true });
      return;
    }

    const name = [event.data.first_name, event.data.last_name]
      .filter(Boolean)
      .join(" ");

    await authStore.upsertUser({
      id: `clerk-${event.data.id}`,
      tenantId: env.CLERK_DEFAULT_TENANT_ID,
      email,
      clerkId: event.data.id,
      name: name || undefined,
    });

    logger.info("clerk user synced", { clerkId: event.data.id, email, type: event.type });
  }

  reply.send({ ok: true });
}
