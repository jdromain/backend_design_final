import { FastifyReply, FastifyRequest } from "fastify";

import { EventBusClient, createEventEnvelope } from "@rezovo/event-bus";
import { createLogger } from "@rezovo/logging";
import { EventPayloadByType } from "@rezovo/core-types";
import { PersistenceStore } from "./persistence/store";

const logger = createLogger({ service: "platform-api", module: "billingQuota" });
const persistence = new PersistenceStore();

type UsageIngestBody = {
  tenantId: string;
  callId: string;
  usage: EventPayloadByType["UsageReported"]["usage"];
  callStartedAt: string;
  callEndedAt: string;
  status?: "in_progress" | "completed";
};

const activeCalls = new Map<string, number>();

export async function canStartCallHandler(
  request: FastifyRequest<{ Body: { tenantId: string } }>,
  reply: FastifyReply
): Promise<unknown> {
  const { tenantId } = request.body ?? {};
  if (!tenantId) {
    reply.status(400);
    return { allowed: false, reason: "tenantId required" };
  }

  const active = activeCalls.get(tenantId) ?? 0;
  // Simple soft cap of 10 concurrent calls per tenant in this scaffold.
  if (active >= 10) {
    return { allowed: false, reason: "concurrency_limit" };
  }

  activeCalls.set(tenantId, active + 1);
  return { allowed: true, active: active + 1 };
}

export function registerUsageIngest(eventBus: EventBusClient) {
  return async (request: FastifyRequest<{ Body: UsageIngestBody }>, reply: FastifyReply): Promise<unknown> => {
    const body = request.body;
    if (!body?.tenantId || !body?.callId || !body?.usage) {
      reply.status(400);
      return { ok: false, error: "missing required fields" };
    }

    const envelope = createEventEnvelope({
      eventType: "UsageReported",
      tenantId: body.tenantId,
      callId: body.callId,
      payload: {
        usage: body.usage,
        callStartedAt: body.callStartedAt,
        callEndedAt: body.callEndedAt
      }
    });

    await eventBus.publish(envelope);
    const active = activeCalls.get(body.tenantId) ?? 1;
    const nextActive = Math.max(0, active - 1);
    activeCalls.set(body.tenantId, nextActive);

    await persistence.appendUsage({
      tenantId: body.tenantId,
      callId: body.callId,
      usage: body.usage,
      callStartedAt: body.callStartedAt,
      callEndedAt: body.callEndedAt
    });
    logger.info("usage ingested", { tenantId: body.tenantId, callId: body.callId });
    return { ok: true, event_id: envelope.event_id };
  };
}

