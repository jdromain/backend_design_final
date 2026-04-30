import { FastifyReply, FastifyRequest } from "fastify";

import { EventBusClient, createEventEnvelope } from "@rezovo/event-bus";
import { createLogger } from "@rezovo/logging";
import { EventPayloadByType } from "@rezovo/core-types";
import { PersistenceStore } from "./persistence/store";
import { callStore } from "./persistence/callStore";
import { query } from "./persistence/dbClient";

const logger = createLogger({ service: "platform-api", module: "billingQuota" });
const persistence = new PersistenceStore();

const DEFAULT_CONCURRENT_LIMIT = 10;

async function getOrgConcurrentLimit(orgId: string): Promise<number> {
  try {
    const result = await query(
      "SELECT concurrent_calls_limit FROM plans WHERE org_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1",
      [orgId]
    );
    return result.rows[0]?.concurrent_calls_limit ?? DEFAULT_CONCURRENT_LIMIT;
  } catch (err) {
    logger.warn("failed to load plan; using default concurrent limit", {
      error: (err as Error).message,
      orgId,
    });
    return DEFAULT_CONCURRENT_LIMIT;
  }
}

type UsageIngestBody = {
  orgId: string;
  callId: string;
  usage: EventPayloadByType["UsageReported"]["usage"];
  callStartedAt: string;
  callEndedAt: string;
  status?: "in_progress" | "completed";
};

export async function canStartCallHandler(
  request: FastifyRequest<{ Body: { orgId: string } }>,
  reply: FastifyReply
): Promise<unknown> {
  const { orgId } = request.body ?? {};
  if (!orgId) {
    reply.status(400);
    return { allowed: false, reason: "orgId required" };
  }

  const active = await callStore.countActiveLiveCalls(orgId);
  const limit = await getOrgConcurrentLimit(orgId);
  if (active >= limit) {
    return { allowed: false, reason: "concurrency_limit" };
  }

  return { allowed: true, active };
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

