import { EventEmitter } from "events";
import { createLogger } from "@rezovo/logging";
import { InboundCallArgs } from "./callController";

const logger = createLogger({ service: "realtime-core", module: "pbxBridge" });

export type InboundCallHandler = (call: InboundCallArgs, ctx: { signal: AbortSignal }) => Promise<void>;

export class PbxBridge extends EventEmitter {
  private handler?: InboundCallHandler;

  registerHandler(handler: InboundCallHandler): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    logger.info("pbx bridge initialized");
  }

  async registerCarrierWebhook(payload: { raw: unknown }): Promise<void> {
    logger.info("received carrier webhook", payload);
    if (!this.handler) {
      logger.error("webhook received but no handler registered");
      return;
    }
    // TODO: translate Twilio/Bandwidth payloads into InboundCallArgs and invoke handler.
  }
}
