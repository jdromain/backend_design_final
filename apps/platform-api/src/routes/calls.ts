/**
 * routes/calls.ts
 *
 * Internal REST endpoints for call lifecycle persistence.
 * Called by realtime-core at call-start and call-end to write into the
 * `calls`, `call_transcript`, and `call_events` tables.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { createLogger } from "@rezovo/logging";
import { callStore, CallRecord, TranscriptEntry, CallEvent } from "../persistence/callStore";

const logger = createLogger({ service: "platform-api", module: "callRoutes" });

export function registerCallRoutes(app: FastifyInstance) {
  /**
   * POST /calls/start — Create or update a call record at the start of a call
   */
  app.post("/calls/start", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Partial<CallRecord>;
    if (!body.callId || !body.tenantId || !body.phoneNumber || !body.callerNumber) {
      return reply.status(400).send({ error: "missing required fields: callId, tenantId, phoneNumber, callerNumber" });
    }

    const record: CallRecord = {
      callId: body.callId,
      tenantId: body.tenantId,
      phoneNumber: body.phoneNumber,
      callerNumber: body.callerNumber,
      twilioCallSid: body.twilioCallSid,
      direction: body.direction ?? "inbound",
      agentConfigId: body.agentConfigId,
      agentConfigVer: body.agentConfigVer,
      status: "in_progress",
      startedAt: body.startedAt ?? new Date().toISOString(),
      answeredAt: body.answeredAt,
    };

    await callStore.upsertCall(record);

    // Log the start event
    await callStore.insertEvent({
      callId: record.callId,
      tenantId: record.tenantId,
      eventType: "call_started",
      payload: {
        phoneNumber: record.phoneNumber,
        callerNumber: record.callerNumber,
        agentConfigId: record.agentConfigId,
      },
    });

    logger.info("call record created", { callId: record.callId, tenantId: record.tenantId });
    return reply.status(201).send({ ok: true, callId: record.callId });
  });

  /**
   * POST /calls/end — Finalize a call record with outcomes, transcript, and usage
   */
  app.post("/calls/end", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      callId: string;
      tenantId: string;
      endReason?: string;
      outcome?: string;
      durationSec?: number;
      classifiedIntent?: string;
      intentConfidence?: number;
      finalIntent?: string;
      slotsCollected?: Record<string, unknown>;
      turnCount?: number;
      llmTokensIn?: number;
      llmTokensOut?: number;
      ttsChars?: number;
      sttSeconds?: number;
      transcript?: Array<{
        sequence: number;
        speaker: "user" | "agent";
        text: string;
        confidence?: number;
        spokenAt: string;
        durationMs?: number;
      }>;
    };

    if (!body.callId || !body.tenantId) {
      return reply.status(400).send({ error: "missing required fields: callId, tenantId" });
    }

    // Update the call record with final data
    const update: CallRecord = {
      callId: body.callId,
      tenantId: body.tenantId,
      phoneNumber: "", // Will be filled from existing record
      callerNumber: "", // Will be filled from existing record
      status: body.outcome === "transferred" ? "transferred"
            : body.outcome === "abandoned" ? "abandoned"
            : body.outcome === "failed" ? "failed"
            : "completed",
      startedAt: "", // Preserved from original
      endedAt: new Date().toISOString(),
      durationSec: body.durationSec,
      endReason: body.endReason,
      outcome: body.outcome,
      classifiedIntent: body.classifiedIntent,
      intentConfidence: body.intentConfidence,
      finalIntent: body.finalIntent,
      slotsCollected: body.slotsCollected,
      turnCount: body.turnCount,
      llmTokensIn: body.llmTokensIn,
      llmTokensOut: body.llmTokensOut,
      ttsChars: body.ttsChars,
      sttSeconds: body.sttSeconds,
    };

    // Get existing record to preserve start fields
    const existing = await callStore.getCall(body.callId);
    if (existing) {
      update.phoneNumber = existing.phoneNumber;
      update.callerNumber = existing.callerNumber;
      update.startedAt = existing.startedAt;
      update.twilioCallSid = existing.twilioCallSid;
      update.agentConfigId = existing.agentConfigId ?? update.agentConfigId;
      update.agentConfigVer = existing.agentConfigVer ?? update.agentConfigVer;
      update.direction = existing.direction;
    }

    await callStore.upsertCall(update);

    // Insert transcript if provided
    if (body.transcript && body.transcript.length > 0) {
      const entries: TranscriptEntry[] = body.transcript.map(t => ({
        callId: body.callId,
        tenantId: body.tenantId,
        sequence: t.sequence,
        speaker: t.speaker,
        text: t.text,
        confidence: t.confidence,
        spokenAt: t.spokenAt,
        durationMs: t.durationMs,
      }));
      await callStore.insertTranscriptBatch(entries);
    }

    // Log the end event
    await callStore.insertEvent({
      callId: body.callId,
      tenantId: body.tenantId,
      eventType: "call_ended",
      payload: {
        endReason: body.endReason,
        outcome: body.outcome,
        durationSec: body.durationSec,
        classifiedIntent: body.classifiedIntent,
        turnCount: body.turnCount,
      },
    });

    logger.info("call record finalized", {
      callId: body.callId,
      outcome: body.outcome,
      durationSec: body.durationSec,
      intent: body.classifiedIntent,
      turns: body.turnCount,
      transcriptLines: body.transcript?.length ?? 0,
    });

    return reply.send({ ok: true });
  });

  /**
   * POST /calls/event — Log a mid-call event (intent classified, tool called, etc.)
   */
  app.post("/calls/event", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as CallEvent;
    if (!body.callId || !body.tenantId || !body.eventType) {
      return reply.status(400).send({ error: "missing required fields: callId, tenantId, eventType" });
    }
    await callStore.insertEvent(body);
    return reply.send({ ok: true });
  });

  /**
   * GET /calls/:callId — Get a call record with its transcript
   */
  app.get("/calls/:callId", async (request: FastifyRequest, reply: FastifyReply) => {
    const { callId } = request.params as { callId: string };
    const call = await callStore.getCall(callId);
    if (!call) {
      return reply.status(404).send({ error: "call not found" });
    }
    const transcript = await callStore.getTranscript(callId);
    return { call, transcript };
  });

  /**
   * GET /calls?tenantId=... — List calls for a tenant
   */
  app.get("/calls", async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId } = request.query as { tenantId?: string };
    if (!tenantId) {
      return reply.status(400).send({ error: "tenantId query parameter required" });
    }
    const calls = await callStore.getCallsByTenant(tenantId);
    return { calls, count: calls.length };
  });

  /**
   * GET /phone-numbers — List all phone numbers (optionally filtered by tenant)
   */
  app.get("/phone-numbers", async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId } = request.query as { tenantId?: string };
    const numbers = tenantId
      ? await callStore.getPhoneNumbersByTenant(tenantId)
      : await callStore.getAllPhoneNumbers();
    return { phoneNumbers: numbers, count: numbers.length };
  });
}
