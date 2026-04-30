import { createLogger } from "@rezovo/logging";
import { persistCallEnd, persistCallEvent, persistCallStart } from "../callPersistence";
import type { InboundCallArgs } from "./callController";

type InboundHandler = {
  handleInboundCall: (args: InboundCallArgs, ctx?: { signal?: AbortSignal }) => Promise<void>;
};

type RejectDetails = {
  limit: number;
};

type GateOptions = {
  onReject?: (args: InboundCallArgs, details: RejectDetails) => Promise<void> | void;
};

const logger = createLogger({ service: "realtime-core", module: "inboundConcurrencyGate" });

async function persistConcurrencyLimitRejection(args: InboundCallArgs, details: RejectDetails): Promise<void> {
  if (!args.callId) {
    return;
  }
  const startedAt = new Date().toISOString();
  await Promise.allSettled([
    persistCallStart({
      callId: args.callId,
      orgId: args.orgId,
      phoneNumber: args.did,
      callerNumber: args.callerNumber ?? "",
      direction: "inbound",
      startedAt,
    }),
    persistCallEvent({
      callId: args.callId,
      orgId: args.orgId,
      eventType: "concurrency_limit_rejected",
      payload: { limit: details.limit },
    }),
    persistCallEnd({
      callId: args.callId,
      orgId: args.orgId,
      endReason: "quota_denied",
      outcome: "failed",
      failureType: "concurrency_limit",
      durationSec: 0,
    }),
  ]);
}

export function createInboundConcurrencyGate(
  handler: InboundHandler,
  limit: number,
  options?: GateOptions,
): InboundHandler {
  let activeInbound = 0;
  const onReject = options?.onReject ?? persistConcurrencyLimitRejection;

  return {
    handleInboundCall: async (args: InboundCallArgs, ctx?: { signal?: AbortSignal }) => {
      if (activeInbound >= limit) {
        logger.warn("inbound call rejected: concurrency limit", {
          callId: args.callId,
          orgId: args.orgId,
          did: args.did,
          limit,
        });
        await onReject(args, { limit });
        return;
      }
      activeInbound += 1;
      try {
        await handler.handleInboundCall(args, ctx);
      } finally {
        activeInbound -= 1;
      }
    },
  };
}

