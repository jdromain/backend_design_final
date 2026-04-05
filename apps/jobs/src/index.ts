import { createInMemoryEventBus, createRedisEventBus } from "@rezovo/event-bus";
import { createLogger } from "@rezovo/logging";

import { registerKbReembedWorker } from "./kbReembedWorker";
import { startBillingReconciliation } from "./billingReconciliation";

const logger = createLogger({ service: "jobs", module: "bootstrap" });

function optionalBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v === "true";
}

/**
 * KB re-embed only runs when platform-api publishes `DocIngestRequested` on the **same** bus.
 * With `EVENT_BUS_IMPL=memory` (default), each process has its own bus — use `redis` + shared `REDIS_URL` for cross-service ingest.
 */
async function bootstrap(): Promise<void> {
  const impl = (process.env.EVENT_BUS_IMPL || "memory") as "memory" | "redis";
  const redisOn = optionalBool("REDIS_ENABLED", false);
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

  if (impl === "redis" && !redisOn) {
    logger.error("EVENT_BUS_IMPL=redis requires REDIS_ENABLED=true");
    process.exit(1);
  }

  const bus = impl === "redis" ? createRedisEventBus(redisUrl) : createInMemoryEventBus();

  await registerKbReembedWorker(bus);
  startBillingReconciliation();

  logger.info("jobs runtime initialized", { eventBusImpl: impl });
}

bootstrap().catch((err) => {
  logger.error("jobs runtime bootstrap failed", { error: err });
  process.exit(1);
});

