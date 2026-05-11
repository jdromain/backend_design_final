import { createHmac } from "crypto";
import { FastifyReply, FastifyRequest } from "fastify";

import { createEventEnvelope, EventBusClient } from "@rezovo/event-bus";
import { createLogger } from "@rezovo/logging";
import { PersistenceStore } from "../persistence/store";
import { query } from "../persistence/dbClient";

const logger = createLogger({ service: "platform-api", module: "webhooks" });
const persistence = new PersistenceStore();
const CALENDLY_SECRET = process.env.CALENDLY_WEBHOOK_SECRET;

type CalendlyWebhook = {
  event: string;
  payload: Record<string, unknown> & {
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
  await applyCalendlyBookingSync(normalized.externalId, normalized.status, body.payload).catch((error) => {
    logger.warn("calendar webhook sync failed", {
      externalId: normalized.externalId,
      status: normalized.status,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  const envelope = createEventEnvelope({
    eventType: "AppointmentUpdated",
    orgId: request.headers["x-org-id"]?.toString() ?? "unknown-organization",
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
    orgId: envelope.org_id
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
  const payload = body.payload as Record<string, unknown>;
  const eventUri =
    asString((payload.event as Record<string, unknown> | undefined)?.uri) ??
    asString((payload.scheduled_event as Record<string, unknown> | undefined)?.uri) ??
    body.payload.event_type;
  return {
    externalId: eventUri,
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

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function applyCalendlyBookingSync(
  providerEventId: string,
  status: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!providerEventId) return;

  const mappedStatus =
    status === "canceled"
      ? "canceled"
      : status === "scheduled" || status === "rescheduled"
        ? "confirmed"
        : null;
  if (!mappedStatus) return;

  const result = await query(
    `UPDATE calendar_bookings
     SET status = $2,
         source = 'provider_synced',
         metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('calendlyWebhookStatus', $3),
         updated_at = now()
     WHERE provider_type = 'calendly'
       AND provider_event_id = $1
     RETURNING id, org_id, resource_id`,
    [providerEventId, mappedStatus, status],
  );

  for (const row of result.rows as Array<{ id: string; org_id: string; resource_id: string }>) {
    await query(
      `INSERT INTO calendar_booking_events (
         id, booking_id, org_id, resource_id, event_type, provider_type,
         result, payload
       ) VALUES (
         gen_random_uuid(), $1, $2, $3, 'sync', 'calendly', 'success', $4::jsonb
       )`,
      [
        row.id,
        row.org_id,
        row.resource_id,
        JSON.stringify({
          source: "calendly_webhook",
          providerEventId,
          status,
          payload,
        }),
      ],
    );
  }

  if (result.rowCount && result.rowCount > 0) {
    logger.info("calendar booking synced from calendly webhook", {
      providerEventId,
      mappedStatus,
      updated: result.rowCount,
    });
  }
}
