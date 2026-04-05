import { createLogger } from "@rezovo/logging";

const logger = createLogger({ service: "jobs", module: "billingReconciliation" });

export function startBillingReconciliation(intervalMs = 10 * 60 * 1000): void {
  logger.info("billing reconciliation scheduler started", { intervalMs });
  setInterval(() => {
    logger.info("billing reconciliation tick");
    // Placeholder: compare internal aggregates vs provider invoices.
  }, intervalMs);
}
