import { EventBusClient } from "@rezovo/event-bus";
import { CallEndedPayload, EventEnvelope, ToolUsedPayload } from "@rezovo/core-types";
import { createLogger } from "@rezovo/logging";

import { AnalyticsStore } from "./store";
import { PersistenceStore } from "../persistence/store";

const logger = createLogger({ service: "platform-api", module: "analytics" });
const persistence = new PersistenceStore();

export function registerAnalyticsConsumer(bus: EventBusClient, store: AnalyticsStore) {
  bus.subscribe("CallEnded", async (event: EventEnvelope<CallEndedPayload>) => {
    const payload = event.payload;
    const duration = payload.durationMs ?? 0;
    store.recordCall(event.tenant_id, duration, payload.outcome);
    await persistence.appendAnalytics({
      tenantId: event.tenant_id,
      durationMs: duration,
      outcome: payload.outcome
    });
    logger.info("analytics call recorded", { tenant_id: event.tenant_id, duration });
  });

  bus.subscribe("ToolUsed", async (event: EventEnvelope<ToolUsedPayload>) => {
    const tool = event.payload.toolName;
    store.recordTool(event.tenant_id, tool);
    await persistence.appendToolUsage({ tenantId: event.tenant_id, toolName: tool, count: 1 });
    logger.info("analytics tool recorded", { tenant_id: event.tenant_id, tool });
  });
}

