import { createHmac } from "crypto";
import { FastifyReply, FastifyRequest } from "fastify";

import { createEventEnvelope, EventBusClient } from "@rezovo/event-bus";
import { createLogger } from "@rezovo/logging";
import { PersistenceStore } from "../persistence/store";

const logger = createLogger({ service: "platform-api", module: "webhooks" });
const persistence = new PersistenceStore();
const CALENDLY_SECRET = process.env.CALENDLY_WEBHOOK_SECRET;

type CalendlyWebhook = {
  event: string;
  payload: {
    event_type: string;
    name?: string;
    start_time?: string;
    end_time?: string;
    invitee?: { name?: string; email?: string };
  };
};

export async function calendlyWebhookHandler(
  eventBus: EventBusClient,
  request: FastifyRequest<{ Body: CalendlyWebhook }>,
  reply: FastifyReply
): Promise<unknown> {
  const body = request.body;
  if (!body?.payload?.event_type) {
    reply.status(400);
    return { ok: false };
  }

  const signatureHeader = (request.headers["calendly-webhook-signature"] ??
    request.headers["x-calendly-signature"]) as string | undefined;
  if (!verifySignature(body, signatureHeader)) {
    reply.status(401);
    return { ok: false, error: "invalid_signature" };
  }

  const normalized = normalizeCalendlyEvent(body);
  const envelope = createEventEnvelope({
    eventType: "AppointmentUpdated",
    tenantId: request.headers["x-tenant-id"]?.toString() ?? "unknown-tenant",
    payload: {
      externalId: normalized.externalId,
      status: normalized.status,
      startsAt: normalized.startsAt,
      endsAt: normalized.endsAt,
      metadata: normalized.metadata
    }
  });

  await eventBus.publish(envelope);
  await persistence.appendWebhook({
    type: "calendly",
    payload: body,
    receivedAt: new Date().toISOString(),
    tenantId: envelope.tenant_id
  });
  logger.info("calendly webhook ingested", { event_id: envelope.event_id });
  return { ok: true };
}

function verifySignature(payload: CalendlyWebhook, header?: string): boolean {
  if (!CALENDLY_SECRET) {
    // Secret unset => treat as disabled validation (local/dev).
    return true;
  }
  if (!header) {
    return false;
  }
  const expected = createHmac("sha256", CALENDLY_SECRET).update(JSON.stringify(payload)).digest("hex");
  if (header.startsWith("sha256=")) {
    return header.slice("sha256=".length) === expected;
  }
  return header === expected;
}

function normalizeCalendlyEvent(body: CalendlyWebhook): {
  externalId: string;
  status: string;
  startsAt?: string;
  endsAt?: string;
  metadata: Record<string, unknown>;
} {
  const status = mapStatus(body.event);
  return {
    externalId: body.payload.event_type,
    status,
    startsAt: body.payload.start_time,
    endsAt: body.payload.end_time,
    metadata: {
      rawEvent: body.event,
      inviteeName: body.payload.name,
      inviteeEmail: body.payload.invitee?.email,
      rawPayload: body.payload
    }
  };
}

function mapStatus(event: string): string {
  if (!event) return "unknown";
  const normalized = event.toLowerCase();
  if (normalized.includes("canceled")) return "canceled";
  if (normalized.includes("rescheduled")) return "rescheduled";
  if (normalized.includes("created") || normalized.includes("scheduled")) return "scheduled";
  return normalized;
}

