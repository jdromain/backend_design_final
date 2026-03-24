import { createInMemoryEventBus } from "@rezovo/event-bus";
import { createLogger } from "@rezovo/logging";

import { registerKbReembedWorker } from "./kbReembedWorker";
import { startBillingReconciliation } from "./billingReconciliation";

const logger = createLogger({ service: "jobs", module: "bootstrap" });

async function bootstrap(): Promise<void> {
  const bus = createInMemoryEventBus();

  await registerKbReembedWorker(bus);
  startBillingReconciliation();

  logger.info("jobs runtime initialized", { busReady: true });
}

bootstrap().catch((err) => {
  logger.error("jobs runtime bootstrap failed", { error: err });
  process.exit(1);
});

