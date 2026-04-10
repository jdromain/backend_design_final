import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import twilio from "twilio";
import { createLogger } from "@rezovo/logging";
import { env } from "../env";
import { callStore, PhoneNumberRecord } from "../persistence/callStore";
import { randomUUID } from "crypto";

const logger = createLogger({ service: "platform-api", module: "twilioRoutes" });

type TerminalUpdate = {
  status: "completed" | "failed" | "abandoned";
  outcome: "handled" | "failed" | "abandoned";
  endReason: "agent_end" | "error" | "timeout" | "caller_hangup";
  failureType?: string;
};

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value[0];
  return value.split(",")[0]?.trim();
}

function buildTwilioValidationUrl(request: FastifyRequest): string {
  const forwardedProto = firstHeader(request.headers["x-forwarded-proto"]);
  const forwardedHost = firstHeader(request.headers["x-forwarded-host"]);
  const proto = forwardedProto || request.protocol;
  const host = forwardedHost || request.hostname;
  return `${proto}://${host}${request.url}`;
}

export function mapTwilioTerminalStatus(
  callStatus: string | undefined,
  body: Record<string, string>
): TerminalUpdate | null {
  const status = (callStatus || "").toLowerCase();
  switch (status) {
    case "completed":
      return {
        status: "completed",
        outcome: "handled",
        endReason: "agent_end",
      };
    case "busy":
      return {
        status: "failed",
        outcome: "failed",
        endReason: "error",
        failureType: "busy",
      };
    case "no-answer":
      return {
        status: "failed",
        outcome: "failed",
        endReason: "timeout",
        failureType: "no-answer",
      };
    case "failed":
      return {
        status: "failed",
        outcome: "failed",
        endReason: "error",
        failureType: body.ErrorMessage || body.ErrorCode || "carrier_failed",
      };
    case "canceled":
    case "cancelled":
      return {
        status: "abandoned",
        outcome: "abandoned",
        endReason: "caller_hangup",
        failureType: "canceled",
      };
    default:
      return null;
  }
}

function isFinalizedByRealtime(call: {
  status?: string;
  outcome?: string;
  endedAt?: string;
}): boolean {
  if (call.outcome === "handled" || call.outcome === "failed" || call.outcome === "transferred" || call.outcome === "abandoned") {
    return true;
  }
  if (call.endedAt && ["completed", "failed", "abandoned", "transferred"].includes(call.status ?? "")) {
    return true;
  }
  return false;
}

export function registerTwilioRoutes(app: FastifyInstance): void {
  app.post("/twilio/voice", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as Record<string, string>;
      const { CallSid, From, To, CallStatus, Direction } = body;

      logger.info("received Twilio voice webhook", { CallSid, From, To, CallStatus, Direction });

      // Look up organization by phone number
      logger.info("looking up phone number", { To });
      const voiceNumber: PhoneNumberRecord | null = await callStore.getPhoneNumber(To);

      logger.info("phone number lookup result", { found: !!voiceNumber, To });
      if (!voiceNumber) {
        logger.error("no phone number found for To", { To });
        const response = new twilio.twiml.VoiceResponse();
        response.say("Sorry, this number is not configured.");
        response.hangup();
        reply.type("text/xml").send(response.toString());
        return;
      }

      // Create call record
      const callId = randomUUID();
      await callStore.upsertCall({
        callId,
        orgId: voiceNumber.orgId,
        phoneNumber: To,
        callerNumber: From,
        twilioCallSid: CallSid,
        direction: (Direction === "outbound-api" || Direction === "outbound-dial") ? "outbound" : "inbound",
        status: "initiated",
        startedAt: new Date().toISOString(),
      });

      // Log as call event
      await callStore.insertEvent({
        callId,
        orgId: voiceNumber.orgId,
        eventType: "carrier_voice",
        payload: body as unknown as Record<string, unknown>,
      });

      // Notify realtime-core about the incoming call
      const realtimeCoreUrl = env.REALTIME_CORE_URL;
      try {
        const notifyResponse = await fetch(`${realtimeCoreUrl}/inbound-call`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callId,
            did: To,
            orgId: voiceNumber.orgId,
            lob: voiceNumber.lob || "default",
            callerNumber: From,
          }),
        });
        if (!notifyResponse.ok) {
          logger.warn("failed to notify realtime-core", { status: notifyResponse.status, callId });
        } else {
          logger.info("notified realtime-core of inbound call", { callId, orgId: voiceNumber.orgId });
        }
      } catch (err) {
        logger.error("error notifying realtime-core", { error: (err as Error).message, callId });
      }

      // Respond with TwiML using Media Streams → RTP Bridge
      const rtpBridgeUrl = env.RTP_BRIDGE_PUBLIC_URL;
      if (!rtpBridgeUrl) {
        logger.error("RTP_BRIDGE_PUBLIC_URL not configured");
        const response = new twilio.twiml.VoiceResponse();
        response.say("System configuration error. Please contact support.");
        response.hangup();
        reply.type("text/xml").send(response.toString());
        return;
      }
      const streamUrl = `${rtpBridgeUrl}/stream/${callId}`;

      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}" />
  </Connect>
</Response>`;

      reply.type("text/xml").send(twiml);
      logger.info("call routed to Media Stream", { callId, callSid: CallSid, orgId: voiceNumber.orgId, streamUrl });
    } catch (err) {
      logger.error("voice webhook error", { error: (err as Error).message, stack: (err as Error).stack });
      const response = new twilio.twiml.VoiceResponse();
      response.say("An error occurred. Please try again.");
      response.hangup();
      reply.type("text/xml").send(response.toString());
    }
  });

  app.post("/twilio/status", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const signature = request.headers["x-twilio-signature"] as string;
      const url = buildTwilioValidationUrl(request);

      if (env.TWILIO_AUTH_TOKEN && !twilio.validateRequest(env.TWILIO_AUTH_TOKEN, signature, url, request.body as any)) {
        logger.warn("invalid Twilio signature", { url });
        reply.status(403).send({ error: "invalid_signature" });
        return;
      }

      const body = request.body as Record<string, string>;
      const { CallSid, CallStatus, CallDuration } = body;

      logger.info("received Twilio status webhook", { CallSid, CallStatus, CallDuration });

      // Look up call by Twilio SID
      const call = await callStore.getCallByTwilioSid(CallSid);

      if (!call) {
        logger.warn("no call found for CallSid", { CallSid });
        reply.send({ ok: true });
        return;
      }

      // Log status event
      await callStore.insertEvent({
        callId: call.callId,
        orgId: call.orgId,
        eventType: "carrier_status",
        payload: body as unknown as Record<string, unknown>,
      });

      const terminal = mapTwilioTerminalStatus(CallStatus, body);
      if (!terminal) {
        // Non-terminal status updates.
        if ((CallStatus === "ringing" || CallStatus === "in-progress") && !isFinalizedByRealtime(call)) {
          await callStore.upsertCall({
            callId: call.callId,
            orgId: call.orgId,
            phoneNumber: call.phoneNumber,
            callerNumber: call.callerNumber,
            status: CallStatus === "in-progress" ? "in_progress" : "ringing",
            startedAt: call.startedAt,
            twilioCallSid: call.twilioCallSid,
          });
        }
        reply.send({ ok: true });
        return;
      }

      if (isFinalizedByRealtime(call)) {
        // Avoid overwriting richer realtime-core finalization (intent, transcript, outcomes).
        if (!call.failureType && terminal.failureType) {
          await callStore.upsertCall({
            callId: call.callId,
            orgId: call.orgId,
            phoneNumber: call.phoneNumber,
            callerNumber: call.callerNumber,
            status: call.status,
            startedAt: call.startedAt,
            endedAt: call.endedAt,
            outcome: call.outcome,
            endReason: call.endReason,
            failureType: terminal.failureType,
            twilioCallSid: call.twilioCallSid,
          });
        }
        logger.info("skipping Twilio terminal overwrite; call already finalized", {
          callId: call.callId,
          callSid: CallSid,
          callStatus: CallStatus,
          existingStatus: call.status,
          existingOutcome: call.outcome,
        });
        reply.send({ ok: true });
        return;
      }

      await callStore.upsertCall({
        callId: call.callId,
        orgId: call.orgId,
        phoneNumber: call.phoneNumber,
        callerNumber: call.callerNumber,
        status: terminal.status,
        endedAt: new Date().toISOString(),
        endReason: terminal.endReason,
        outcome: terminal.outcome,
        failureType: terminal.failureType,
        durationSec: CallDuration ? parseInt(CallDuration, 10) : undefined,
        startedAt: call.startedAt,
        twilioCallSid: call.twilioCallSid,
      });
      logger.info("call ended", {
        callId: call.callId,
        callSid: CallSid,
        status: terminal.status,
        outcome: terminal.outcome,
        failureType: terminal.failureType,
      });

      reply.send({ ok: true });
    } catch (err) {
      logger.error("status webhook error", { error: (err as Error).message });
      reply.status(500).send({ error: "internal_error" });
    }
  });
}
