import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import twilio from "twilio";
import { createLogger } from "@rezovo/logging";
import { env } from "../env";
import { callStore, PhoneNumberRecord } from "../persistence/callStore";
import { randomUUID } from "crypto";

const logger = createLogger({ service: "platform-api", module: "twilioRoutes" });

export function registerTwilioRoutes(app: FastifyInstance): void {
  app.post("/twilio/voice", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as Record<string, string>;
      const { CallSid, From, To, CallStatus, Direction } = body;

      logger.info("received Twilio voice webhook", { CallSid, From, To, CallStatus, Direction });

      // Look up tenant by phone number
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
        tenantId: voiceNumber.tenantId,
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
        tenantId: voiceNumber.tenantId,
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
            tenantId: voiceNumber.tenantId,
            lob: voiceNumber.lob || "default",
            callerNumber: From,
          }),
        });
        if (!notifyResponse.ok) {
          logger.warn("failed to notify realtime-core", { status: notifyResponse.status, callId });
        } else {
          logger.info("notified realtime-core of inbound call", { callId, tenantId: voiceNumber.tenantId });
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
      logger.info("call routed to Media Stream", { callId, callSid: CallSid, tenantId: voiceNumber.tenantId, streamUrl });
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
      const url = `${request.protocol}://${request.hostname}${request.url}`;

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
        tenantId: call.tenantId,
        eventType: "carrier_status",
        payload: body as unknown as Record<string, unknown>,
      });

      // Update call status if completed/failed
      if (["completed", "failed", "busy", "no-answer"].includes(CallStatus)) {
        await callStore.upsertCall({
          callId: call.callId,
          tenantId: call.tenantId,
          phoneNumber: call.phoneNumber,
          callerNumber: call.callerNumber,
          status: CallStatus,
          endedAt: new Date().toISOString(),
          endReason: CallStatus,
          durationSec: CallDuration ? parseInt(CallDuration, 10) : undefined,
          startedAt: call.startedAt,
        });
        logger.info("call ended", { callId: call.callId, callSid: CallSid, status: CallStatus });
      }

      reply.send({ ok: true });
    } catch (err) {
      logger.error("status webhook error", { error: (err as Error).message });
      reply.status(500).send({ error: "internal_error" });
    }
  });
}
