import { FastifyReply, FastifyRequest } from "fastify";

import { EventBusClient, createEventEnvelope } from "@rezovo/event-bus";
import { createLogger } from "@rezovo/logging";
import { EventPayloadByType } from "@rezovo/core-types";
import { PersistenceStore } from "./persistence/store";

const logger = createLogger({ service: "platform-api", module: "billingQuota" });
const persistence = new PersistenceStore();

type UsageIngestBody = {
  orgId: string;
  callId: string;
  usage: EventPayloadByType["UsageReported"]["usage"];
  callStartedAt: string;
  callEndedAt: string;
  status?: "in_progress" | "completed";
};

const activeCalls = new Map<string, number>();

export async function canStartCallHandler(
  request: FastifyRequest<{ Body: { orgId: string } }>,
  reply: FastifyReply
): Promise<unknown> {
  const { orgId } = request.body ?? {};
  if (!orgId) {
    reply.status(400);
    return { allowed: false, reason: "orgId required" };
  }

  const active = activeCalls.get(orgId) ?? 0;
  // Simple soft cap of 10 concurrent calls per organization in this scaffold.
  if (active >= 10) {
    return { allowed: false, reason: "concurrency_limit" };
  }

  activeCalls.set(orgId, active + 1);
  return { allowed: true, active: active + 1 };
}

export function registerUsageIngest(eventBus: EventBusClient) {
  return async (request: FastifyRequest<{ Body: UsageIngestBody }>, reply: FastifyReply): Promise<unknown> => {
    const body = request.body;
    if (!body?.orgId || !body?.callId || !body?.usage) {
      reply.status(400);
      return { ok: false, error: "missing required fields" };
    }

    const envelope = createEventEnvelope({
      eventType: "UsageReported",
      orgId: body.orgId,
      callId: body.callId,
      payload: {
        usage: body.usage,
        callStartedAt: body.callStartedAt,
        callEndedAt: body.callEndedAt
      }
    });

    await eventBus.publish(envelope);
    const active = activeCalls.get(body.orgId) ?? 1;
    const nextActive = Math.max(0, active - 1);
    activeCalls.set(body.orgId, nextActive);

    await persistence.appendUsage({
      orgId: body.orgId,
      callId: body.callId,
      usage: body.usage,
      callStartedAt: body.callStartedAt,
      callEndedAt: body.callEndedAt
    });
    logger.info("usage ingested", { orgId: body.orgId, callId: body.callId });
    return { ok: true, event_id: envelope.event_id };
  };
}

