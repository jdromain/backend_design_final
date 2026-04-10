import { FastifyReply, FastifyRequest } from "fastify";

import { createLogger } from "@rezovo/logging";
import { createEventEnvelope, EventBusClient } from "@rezovo/event-bus";

import { executeToolCall, toolResultIsMocked } from "./toolbus/connectors";
import { PersistenceStore } from "./persistence/store";

const logger = createLogger({ service: "platform-api", module: "toolbus" });
const MOCK_MODE = process.env.MOCK_CONNECTORS === "true";

type ToolCallBody = {
  orgId: string;
  toolName: string;
  idempotencyKey: string;
  args: Record<string, unknown>;
  provider?: string;
};

const persistence = new PersistenceStore();

function resolveProvider(toolName: string, explicit?: string): string {
  if (explicit) return explicit;
  if (toolName === "book_appointment") return "calendly";
  if (toolName === "send_sms") return "twilio";
  if (toolName === "crm_upsert_contact") return "hubspot";
  return "custom";
}

export function toolCallHandler(eventBus: EventBusClient) {
  return async (request: FastifyRequest<{ Body: ToolCallBody }>, reply: FastifyReply): Promise<unknown> => {
    const { orgId, toolName, idempotencyKey, args, provider: explicitProvider } = request.body ?? {};
    if (!orgId || !toolName || !idempotencyKey) {
      reply.status(400);
      return { ok: false, error: "orgId, toolName, idempotencyKey required" };
    }

    const provider = resolveProvider(toolName, explicitProvider);
    const storeKey = `${orgId}::${toolName}::${idempotencyKey}`;
    const cached = await persistence.loadToolResult(orgId, toolName, storeKey);
    if (cached) {
      return {
        ok: true,
        fromCache: true,
        mocked: toolResultIsMocked(cached.result),
        result: cached.result,
      };
    }

    const credentials = (await persistence.loadCredentials(orgId, provider)) ?? {};
    if (!MOCK_MODE && Object.keys(credentials).length === 0) {
      logger.warn("missing tool credentials, using mock path", { orgId, provider, toolName });
    }

    const result = await executeToolCall({
      toolName,
      provider,
      args: args ?? {},
      credentials
    });

    const mocked =
      MOCK_MODE ||
      Object.keys(credentials).length === 0 ||
      toolResultIsMocked(result);

    await persistence.saveToolResult(orgId, toolName, storeKey, result);
    const envelope = createEventEnvelope({
      eventType: "ToolUsed",
      orgId,
      payload: {
        toolName,
        idempotencyKey,
        args: args ?? {},
        provider,
        result
      }
    });
    // Best-effort emit; do not block response.
    void eventBus.publish(envelope);
    logger.info("tool executed", { orgId, toolName, idempotencyKey, provider });

    return { ok: true, provider, mocked, result };
  };
}

