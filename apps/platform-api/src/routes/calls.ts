import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Type } from "@sinclair/typebox";
import { createLogger } from "@rezovo/logging";
import { callStore, CallRecord, TranscriptEntry, CallEvent } from "../persistence/callStore";
import { query } from "../persistence/dbClient";
import { sendData, sendError } from "../lib/responses";
import { authHook, optionalAuthHook } from "../auth/jwt";
import { CallsListEnvelopeSchema } from "../contracts/httpSchemas";

const logger = createLogger({ service: "platform-api", module: "callRoutes" });

const isProduction = (process.env.NODE_ENV ?? "development") === "production";

function mapOutcome(outcome: string | undefined | null): "completed" | "handoff" | "dropped" | "systemFailed" | "pending" {
  switch (outcome) {
    case "handled": return "completed";
    case "transferred": return "handoff";
    case "abandoned": return "dropped";
    case "failed": return "systemFailed";
    default: return "pending";
  }
}

function capitalizeFirst(s: string | undefined | null): string | undefined {
  if (!s) return undefined;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function mapLiveState(status: string): "ringing" | "active" | "at_risk" | "handoff_requested" | "error" {
  switch (status) {
    case "ringing":
    case "initiated":
      return "ringing";
    case "in_progress":
      return "active";
    case "transferred":
      return "handoff_requested";
    case "failed":
      return "error";
    default:
      return "active";
  }
}

export function registerCallRoutes(app: FastifyInstance) {
  // ----------------------------------------------------------------
  // Internal write routes (realtime-core contract, unchanged)
  // ----------------------------------------------------------------

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

    const update: CallRecord = {
      callId: body.callId,
      tenantId: body.tenantId,
      phoneNumber: "",
      callerNumber: "",
      status: body.outcome === "transferred" ? "transferred"
            : body.outcome === "abandoned" ? "abandoned"
            : body.outcome === "failed" ? "failed"
            : "completed",
      startedAt: "",
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

    if (body.transcript && body.transcript.length > 0) {
      const entries: TranscriptEntry[] = body.transcript.map((t) => ({
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
    });

    return reply.send({ ok: true });
  });

  app.post("/calls/event", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as CallEvent;
    if (!body.callId || !body.tenantId || !body.eventType) {
      return reply.status(400).send({ error: "missing required fields: callId, tenantId, eventType" });
    }
    await callStore.insertEvent(body);
    return reply.send({ ok: true });
  });

  // ----------------------------------------------------------------
  // UI read routes (auth'd, { data } envelope)
  // ----------------------------------------------------------------

  app.get("/calls", {
    preHandler: isProduction ? authHook(["admin", "editor", "viewer"]) : optionalAuthHook(),
    schema: {
      querystring: Type.Object({ tenantId: Type.Optional(Type.String()) }),
      response: { 200: CallsListEnvelopeSchema },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.auth?.tenant_id ?? (request.query as any).tenantId;
    if (!tenantId) {
      return sendError(reply, 400, "missing_tenant", "tenantId required");
    }

    const calls = await callStore.getCallsByTenant(tenantId);

    const toolEventRows = calls.length > 0
      ? (await query(
          `SELECT call_id, payload FROM call_events
           WHERE tenant_id = $1 AND event_type = 'tool_called'`,
          [tenantId]
        )).rows
      : [];

    const toolsByCall = new Map<string, { name: string; success: boolean }[]>();
    for (const row of toolEventRows) {
      const tools = toolsByCall.get(row.call_id) ?? [];
      const p = row.payload ?? {};
      tools.push({
        name: p.toolName ?? p.tool_name ?? "unknown",
        success: p.result !== "error" && p.result !== "failed",
      });
      toolsByCall.set(row.call_id, tools);
    }

    const mapped = calls.map((c) => {
      const tools = toolsByCall.get(c.callId) ?? [];
      return {
        callId: c.callId,
        startedAt: c.startedAt,
        endedAt: c.endedAt,
        callerNumber: c.callerNumber,
        phoneLineId: c.phoneNumber,
        phoneLineNumber: c.phoneNumber,
        agentId: c.agentConfigId ?? "default",
        agentName: c.agentConfigId ?? "Rezovo Agent",
        intent: capitalizeFirst(c.classifiedIntent) as any,
        direction: c.direction ?? "inbound",
        durationMs: (c.durationSec ?? 0) * 1000,
        result: mapOutcome(c.outcome),
        endReason: c.endReason,
        turnCount: c.turnCount,
        toolsUsed: tools,
        toolErrors: tools.filter((t) => !t.success).length,
      };
    });

    sendData(reply, mapped);
  });

  app.get("/calls/live", {
    preHandler: isProduction ? authHook(["admin", "editor", "viewer"]) : optionalAuthHook(),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.auth?.tenant_id ?? (request.query as any).tenantId;
    if (!tenantId) {
      return sendError(reply, 400, "missing_tenant", "tenantId required");
    }

    const result = await query(
      `SELECT * FROM calls WHERE tenant_id = $1 AND status IN ('initiated','ringing','in_progress')
       ORDER BY started_at DESC`,
      [tenantId]
    );

    const liveCalls = await Promise.all(
      result.rows.map(async (row: any) => {
        const callId = row.call_id;

        const transcriptRows = (await query(
          "SELECT * FROM call_transcript WHERE call_id = $1 ORDER BY sequence",
          [callId]
        )).rows;

        const eventRows = (await query(
          "SELECT * FROM call_events WHERE call_id = $1 ORDER BY occurred_at",
          [callId]
        )).rows;

        const nowMs = Date.now();
        const startMs = new Date(row.started_at).getTime();

        return {
          callId,
          callerNumber: row.caller_number,
          agentName: row.agent_config_id ?? "Rezovo Agent",
          agentVersion: String(row.agent_config_ver ?? 1),
          intent: capitalizeFirst(row.classified_intent) as any,
          state: mapLiveState(row.status),
          direction: row.direction ?? "inbound",
          startedAt: row.started_at,
          durationSeconds: Math.floor((nowMs - startMs) / 1000),
          lastEvent: eventRows.length > 0 ? eventRows[eventRows.length - 1].event_type : "call_started",
          riskFlags: [] as string[],
          timeline: eventRows.map((e: any) => ({
            id: e.id,
            type: e.event_type,
            timestamp: e.occurred_at,
            description: e.event_type.replace(/_/g, " "),
            details: e.payload?.description ?? undefined,
          })),
          transcript: transcriptRows.map((t: any) => ({
            id: t.id,
            role: t.speaker === "user" ? "caller" : "agent",
            text: t.text,
            timestamp: t.spoken_at,
          })),
          tools: eventRows
            .filter((e: any) => e.event_type === "tool_called")
            .map((e: any) => ({
              id: e.id,
              name: e.payload?.toolName ?? "unknown",
              status: e.payload?.result === "error" ? "failed" : "success",
              latency: e.payload?.latencyMs,
              timestamp: e.occurred_at,
            })),
          tags: [] as string[],
        };
      })
    );

    sendData(reply, liveCalls);
  });

  app.get("/calls/:id/timeline", {
    preHandler: isProduction ? authHook(["admin", "editor", "viewer"]) : optionalAuthHook(),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const eventRows = (await query(
      "SELECT * FROM call_events WHERE call_id = $1 ORDER BY occurred_at",
      [id]
    )).rows;

    const timeline = eventRows.map((e: any) => ({
      id: e.id,
      type: e.event_type,
      timestamp: e.occurred_at,
      description: e.event_type.replace(/_/g, " "),
      details: e.payload?.description ?? undefined,
    }));

    sendData(reply, timeline);
  });

  app.get("/calls/:id/transcript", {
    preHandler: isProduction ? authHook(["admin", "editor", "viewer"]) : optionalAuthHook(),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const entries = await callStore.getTranscript(id);

    const transcript = entries.map((t, idx) => ({
      id: `${t.callId}-${idx}`,
      role: t.speaker === "user" ? "caller" : "agent",
      text: t.text,
      timestamp: t.spokenAt,
    }));

    sendData(reply, transcript);
  });

  app.get("/calls/:id/tools", {
    preHandler: isProduction ? authHook(["admin", "editor", "viewer"]) : optionalAuthHook(),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const eventRows = (await query(
      "SELECT * FROM call_events WHERE call_id = $1 AND event_type = 'tool_called' ORDER BY occurred_at",
      [id]
    )).rows;

    const tools = eventRows.map((e: any) => ({
      id: e.id,
      name: e.payload?.toolName ?? e.payload?.tool_name ?? "unknown",
      status: e.payload?.result === "error" || e.payload?.result === "failed" ? "failed" : "success",
      latency: e.payload?.latencyMs,
      timestamp: e.occurred_at,
      input: e.payload?.input,
      output: e.payload?.output,
      error: e.payload?.error,
    }));

    sendData(reply, tools);
  });

  // Keep existing phone-numbers route (internal, backward compat)
  app.get("/phone-numbers", async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId } = request.query as { tenantId?: string };
    const numbers = tenantId
      ? await callStore.getPhoneNumbersByTenant(tenantId)
      : await callStore.getAllPhoneNumbers();
    return { phoneNumbers: numbers, count: numbers.length };
  });
}
