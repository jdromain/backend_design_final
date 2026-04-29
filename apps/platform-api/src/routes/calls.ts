import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Type } from "@sinclair/typebox";
import { createLogger } from "@rezovo/logging";
import { callStore, CallRecord, TranscriptEntry, CallEvent } from "../persistence/callStore";
import { query } from "../persistence/dbClient";
import { sendData, sendError } from "../lib/responses";
import { resolvedAuthHook, resolvedAuthOrInternalHook } from "../auth/jwt";
import { requireOrgForRequest } from "../auth/orgScope";
import { CallsListEnvelopeSchema } from "../contracts/httpSchemas";
import {
  isDefaultCompletionReason,
  mapOutcomeToUiResult,
  normalizeEndReasonKey,
  normalizeEndReasonLabel,
  uiResultToOutcome,
} from "../lib/callTaxonomy";

const logger = createLogger({ service: "platform-api", module: "callRoutes" });
const DEFAULT_CALLS_PAGE_LIMIT = 100;
const MAX_CALLS_PAGE_LIMIT = 500;
const DEFAULT_STALE_LIVE_THRESHOLD_MINUTES = 15;
const LIVE_STATUSES = ["initiated", "ringing", "in_progress"] as const;
const LIVE_OR_HANDOFF_STATUSES = ["initiated", "ringing", "in_progress", "transferred"] as const;
const TERMINAL_STATUSES = new Set(["completed", "failed", "abandoned", "transferred"]);
const TERMINAL_OUTCOMES = new Set(["handled", "failed", "abandoned", "transferred"]);

type TimelineUiType =
  | "call_started"
  | "agent_spoke"
  | "caller_spoke"
  | "tool_called"
  | "call_ended"
  | "transfer"
  | "error";

function capitalizeFirst(s: string | undefined | null): string | undefined {
  if (!s) return undefined;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function parseDateOrNull(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parsePositiveInt(value: unknown, fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function parseResultFilter(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) =>
      entry === "completed" ||
      entry === "handoff" ||
      entry === "dropped" ||
      entry === "systemFailed" ||
      entry === "pending");
}

function expandEndReasonFilterKeys(normalizedReason: string): string[] {
  switch (normalizedReason) {
    case "normal_completion":
      return ["normal_completion", "agent_end"];
    case "customer_requested_human":
      return ["customer_requested_human", "human_handoff", "transfer"];
    case "api_error":
      return ["api_error", "error"];
    case "system_error":
      return ["system_error", "error"];
    default:
      return [normalizedReason];
  }
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

function mapTimelineType(rawType: string, payload: Record<string, unknown> | undefined): TimelineUiType {
  switch (rawType) {
    case "call_started":
    case "carrier_voice":
      return "call_started";
    case "agent_spoke":
      return "agent_spoke";
    case "caller_spoke":
    case "user_spoke":
      return "caller_spoke";
    case "tool_called":
      return "tool_called";
    case "call_ended":
      return "call_ended";
    case "transfer":
    case "handoff_requested":
      return "transfer";
    case "carrier_status": {
      const callStatus = typeof payload?.CallStatus === "string" ? payload.CallStatus : "";
      if (["failed", "busy", "no-answer", "canceled"].includes(callStatus)) return "error";
      if (callStatus === "completed") return "call_ended";
      return "call_started";
    }
    default:
      return "error";
  }
}

function mapTimelineEvent(e: any) {
  const rawType = String(e.event_type ?? "unknown");
  const payload = (e.payload ?? {}) as Record<string, unknown>;
  const mappedType = mapTimelineType(rawType, payload);
  const rawDetail = mappedType !== rawType ? `raw event: ${rawType}` : undefined;
  const description = rawType.replace(/_/g, " ");
  const details = [payload?.description, rawDetail]
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .join(" • ");

  return {
    id: e.id,
    type: mappedType,
    timestamp: e.occurred_at,
    description,
    details: details.length > 0 ? details : undefined,
  };
}

function isTerminalCallState(call: {
  status?: string | null;
  outcome?: string | null;
  endedAt?: string | null;
}): boolean {
  if (call.endedAt) return true;
  if (call.status && TERMINAL_STATUSES.has(call.status)) return true;
  if (call.outcome && TERMINAL_OUTCOMES.has(call.outcome)) return true;
  return false;
}

export function registerCallRoutes(app: FastifyInstance) {
  // ----------------------------------------------------------------
  // Internal write routes (realtime-core contract, unchanged)
  // ----------------------------------------------------------------

  app.post("/calls/start", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Partial<CallRecord>;
    if (!body.callId || !body.orgId || !body.phoneNumber || !body.callerNumber) {
      return reply.status(400).send({ error: "missing required fields: callId, orgId, phoneNumber, callerNumber" });
    }

    const record: CallRecord = {
      callId: body.callId,
      orgId: body.orgId,
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

    const startPersisted = await callStore.upsertCall(record);
    if (!startPersisted) {
      return sendError(reply, 500, "persist_failed", "Failed to persist call start");
    }

    await callStore.insertEvent({
      callId: record.callId,
      orgId: record.orgId,
      eventType: "call_started",
      payload: {
        phoneNumber: record.phoneNumber,
        callerNumber: record.callerNumber,
        agentConfigId: record.agentConfigId,
      },
    });

    logger.info("call record created", { callId: record.callId, orgId: record.orgId });
    return reply.status(201).send({ ok: true, callId: record.callId });
  });

  app.post("/calls/end", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      callId: string;
      orgId: string;
      endReason?: string;
      outcome?: string;
      durationSec?: number;
      classifiedIntent?: string;
      intentConfidence?: number;
      finalIntent?: string;
      failureType?: string;
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

    if (!body.callId || !body.orgId) {
      return reply.status(400).send({ error: "missing required fields: callId, orgId" });
    }
    const resolvedEndReason =
      typeof body.endReason === "string" && body.endReason.trim().length > 0
        ? body.endReason.trim()
        : body.outcome === "handled"
          ? "normal_completion"
          : undefined;

    const existing = await callStore.getCall(body.callId);
    const update: CallRecord = {
      callId: body.callId,
      orgId: body.orgId,
      phoneNumber: existing?.phoneNumber ?? "",
      callerNumber: existing?.callerNumber ?? "",
      status: body.outcome === "transferred" ? "transferred"
            : body.outcome === "abandoned" ? "abandoned"
            : body.outcome === "failed" ? "failed"
            : "completed",
      startedAt: existing?.startedAt ?? "",
      endedAt: new Date().toISOString(),
      durationSec: body.durationSec,
      endReason: resolvedEndReason,
      outcome: body.outcome,
      failureType: body.failureType ?? (body.outcome === "failed" ? resolvedEndReason : undefined),
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

    if (existing) {
      update.twilioCallSid = existing.twilioCallSid;
      update.agentConfigId = existing.agentConfigId ?? update.agentConfigId;
      update.agentConfigVer = existing.agentConfigVer ?? update.agentConfigVer;
      update.direction = existing.direction;

      const incomingDefaultCompletion = isDefaultCompletionReason(resolvedEndReason);
      const existingExplicitReason =
        !!existing.endReason && !isDefaultCompletionReason(existing.endReason);
      const preserveExistingTerminal =
        incomingDefaultCompletion &&
        isTerminalCallState(existing) &&
        (existingExplicitReason ||
          existing.outcome === "abandoned" ||
          existing.outcome === "failed" ||
          existing.outcome === "transferred" ||
          existing.status === "abandoned" ||
          existing.status === "failed" ||
          existing.status === "transferred");

      if (preserveExistingTerminal) {
        update.status = existing.status;
        update.outcome = existing.outcome;
        update.endReason = existing.endReason;
        update.failureType = existing.failureType ?? update.failureType;
        update.endedAt = existing.endedAt ?? update.endedAt;
        update.durationSec = existing.durationSec ?? update.durationSec;
      } else if (incomingDefaultCompletion && existing.endedAt) {
        // Preserve earlier terminal timestamp when realtime delivers a delayed default completion.
        update.endedAt = existing.endedAt;
        update.durationSec = existing.durationSec ?? update.durationSec;
      }
    }

    const endPersisted = await callStore.upsertCall(update);
    if (!endPersisted) {
      return sendError(reply, 500, "persist_failed", "Failed to persist call end");
    }

    if (body.transcript && body.transcript.length > 0) {
      const entries: TranscriptEntry[] = body.transcript.map((t) => ({
        callId: body.callId,
        orgId: body.orgId,
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
      orgId: body.orgId,
      eventType: "call_ended",
      payload: {
        endReason: update.endReason,
        outcome: update.outcome,
        durationSec: update.durationSec,
        classifiedIntent: body.classifiedIntent,
        turnCount: body.turnCount,
        source: "realtime_core",
      },
    });

    logger.info("call record finalized", {
      callId: body.callId,
      outcome: update.outcome,
      durationSec: update.durationSec,
    });

    return reply.send({ ok: true });
  });

  app.post("/calls/event", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as CallEvent;
    if (!body.callId || !body.orgId || !body.eventType) {
      return reply.status(400).send({ error: "missing required fields: callId, orgId, eventType" });
    }
    await callStore.insertEvent(body);
    return reply.send({ ok: true });
  });

  // ----------------------------------------------------------------
  // UI read routes (auth'd, { data } envelope)
  // ----------------------------------------------------------------

  app.get("/calls", {
    preHandler: resolvedAuthHook(["admin", "editor", "viewer"]),
    schema: {
      querystring: Type.Object({
        orgId: Type.Optional(Type.String()),
        from: Type.Optional(Type.String()),
        to: Type.Optional(Type.String()),
        result: Type.Optional(Type.String()),
        intent: Type.Optional(Type.String()),
        endReason: Type.Optional(Type.String()),
        phoneLine: Type.Optional(Type.String()),
        toolUsed: Type.Optional(Type.String()),
        toolErrorsOnly: Type.Optional(Type.Union([Type.Boolean(), Type.String()])),
        direction: Type.Optional(Type.String()),
        search: Type.Optional(Type.String()),
        page: Type.Optional(Type.Union([Type.String(), Type.Number()])),
        limit: Type.Optional(Type.Union([Type.String(), Type.Number()])),
      }),
      response: { 200: CallsListEnvelopeSchema },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const queryInput = (request.query ?? {}) as {
      orgId?: string;
      from?: string;
      to?: string;
      result?: string;
      intent?: string;
      endReason?: string;
      phoneLine?: string;
      toolUsed?: string;
      toolErrorsOnly?: string | boolean;
      direction?: string;
      search?: string;
      page?: string | number;
      limit?: string | number;
    };
    const orgId = requireOrgForRequest(request, reply, queryInput.orgId);
    if (!orgId) return;

    const filters: string[] = ["c.org_id = $1"];
    const values: Array<string | number | string[]> = [orgId];
    let valueIndex = 2;

    const fromDate = parseDateOrNull(queryInput.from);
    const toDate = parseDateOrNull(queryInput.to);
    if (fromDate) {
      filters.push(`c.started_at >= $${valueIndex}::timestamptz`);
      values.push(fromDate.toISOString());
      valueIndex += 1;
    }
    if (toDate) {
      filters.push(`c.started_at <= $${valueIndex}::timestamptz`);
      values.push(toDate.toISOString());
      valueIndex += 1;
    }

    const resultFilters = parseResultFilter(queryInput.result);
    if (resultFilters.length > 0) {
      const resultClauses = resultFilters
        .map((result) => {
          if (result === "pending") {
            return `(c.outcome IS NULL AND c.status = ANY('{initiated,ringing,in_progress}'::text[]))`;
          }
          const outcome = uiResultToOutcome(result);
          if (!outcome) return null;
          if (result === "completed") {
            return `(c.outcome = 'handled' OR (c.outcome IS NULL AND c.status = 'completed'))`;
          }
          if (result === "handoff") {
            return `(c.outcome = 'transferred' OR c.status = 'transferred')`;
          }
          if (result === "dropped") {
            return `(c.outcome = 'abandoned' OR c.status = 'abandoned')`;
          }
          return `(c.outcome = 'failed' OR c.status = 'failed')`;
        })
        .filter(Boolean) as string[];
      if (resultClauses.length > 0) {
        filters.push(`(${resultClauses.join(" OR ")})`);
      }
    }

    if (typeof queryInput.intent === "string" && queryInput.intent.trim() && queryInput.intent !== "all") {
      filters.push(`LOWER(c.classified_intent) = LOWER($${valueIndex})`);
      values.push(queryInput.intent.trim());
      valueIndex += 1;
    }

    if (typeof queryInput.endReason === "string" && queryInput.endReason.trim() && queryInput.endReason !== "all") {
      const normalizedReason = normalizeEndReasonKey(queryInput.endReason);
      if (normalizedReason) {
        filters.push(`regexp_replace(lower(COALESCE(c.end_reason, '')), '[\\s-]+', '_', 'g') = ANY($${valueIndex}::text[])`);
        values.push(expandEndReasonFilterKeys(normalizedReason));
        valueIndex += 1;
      }
    }

    if (queryInput.direction === "inbound" || queryInput.direction === "outbound") {
      filters.push(`c.direction = $${valueIndex}`);
      values.push(queryInput.direction);
      valueIndex += 1;
    }

    if (typeof queryInput.phoneLine === "string" && queryInput.phoneLine.trim() && queryInput.phoneLine !== "all") {
      filters.push(`c.phone_number = $${valueIndex}`);
      values.push(queryInput.phoneLine.trim());
      valueIndex += 1;
    }

    if (typeof queryInput.toolUsed === "string" && queryInput.toolUsed.trim() && queryInput.toolUsed !== "all") {
      filters.push(
        `EXISTS (
          SELECT 1
          FROM call_events ce
          WHERE ce.call_id = c.call_id
            AND ce.org_id = c.org_id
            AND ce.event_type = 'tool_called'
            AND COALESCE(ce.payload->>'toolName', ce.payload->>'tool_name') = $${valueIndex}
        )`,
      );
      values.push(queryInput.toolUsed.trim());
      valueIndex += 1;
    }

    if (parseBoolean(queryInput.toolErrorsOnly, false)) {
      filters.push(
        `EXISTS (
          SELECT 1
          FROM call_events ce
          WHERE ce.call_id = c.call_id
            AND ce.org_id = c.org_id
            AND ce.event_type = 'tool_called'
            AND COALESCE(ce.payload->>'result', '') IN ('error', 'failed')
        )`,
      );
    }

    if (typeof queryInput.search === "string" && queryInput.search.trim().length > 0) {
      filters.push(
        `(c.call_id ILIKE $${valueIndex}
          OR c.caller_number ILIKE $${valueIndex}
          OR c.phone_number ILIKE $${valueIndex}
          OR COALESCE(c.classified_intent, '') ILIKE $${valueIndex})`,
      );
      values.push(`%${queryInput.search.trim()}%`);
      valueIndex += 1;
    }

    const limit = parsePositiveInt(
      queryInput.limit,
      DEFAULT_CALLS_PAGE_LIMIT,
      1,
      MAX_CALLS_PAGE_LIMIT,
    );
    const page = parsePositiveInt(queryInput.page, 1, 1, 10_000);
    const offset = (page - 1) * limit;
    const whereSql = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

    const callsResult = await query(
      `SELECT c.*
       FROM calls c
       ${whereSql}
       ORDER BY c.started_at DESC
       LIMIT $${valueIndex} OFFSET $${valueIndex + 1}`,
      [...values, limit, offset],
    );
    const calls = callsResult.rows.map((row: any) => ({
      callId: row.call_id,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      callerNumber: row.caller_number,
      phoneNumber: row.phone_number,
      agentConfigId: row.agent_config_id,
      classifiedIntent: row.classified_intent,
      direction: row.direction,
      durationSec: row.duration_sec,
      outcome: row.outcome,
      status: row.status,
      endReason: row.end_reason,
      failureType: row.failure_type,
      turnCount: row.turn_count,
    }));

    const callIds = calls.map((c) => c.callId);
    const toolEventRows = callIds.length > 0
      ? (await query(
          `SELECT call_id, payload FROM call_events
           WHERE org_id = $1 AND event_type = 'tool_called' AND call_id = ANY($2::text[])`,
          [orgId, callIds]
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
        result: mapOutcomeToUiResult(c.outcome, c.status),
        endReason: normalizeEndReasonLabel(c.endReason, c.outcome),
        failureType: c.failureType,
        turnCount: c.turnCount,
        toolsUsed: tools,
        toolErrors: tools.filter((t) => !t.success).length,
      };
    });

    sendData(reply, mapped);
  });

  app.get("/calls/facets", {
    preHandler: resolvedAuthHook(["admin", "editor", "viewer"]),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const queryInput = (request.query ?? {}) as { orgId?: string; from?: string; to?: string };
    const orgId = requireOrgForRequest(request, reply, queryInput.orgId);
    if (!orgId) return;

    const filters: string[] = ["c.org_id = $1"];
    const values: string[] = [orgId];
    let index = 2;

    const fromDate = parseDateOrNull(queryInput.from);
    const toDate = parseDateOrNull(queryInput.to);
    if (fromDate) {
      filters.push(`c.started_at >= $${index}::timestamptz`);
      values.push(fromDate.toISOString());
      index += 1;
    }
    if (toDate) {
      filters.push(`c.started_at <= $${index}::timestamptz`);
      values.push(toDate.toISOString());
      index += 1;
    }
    const whereSql = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

    const [intentRows, reasonRows, directionRows, phoneRows, toolRows] = await Promise.all([
      query(
        `SELECT DISTINCT c.classified_intent AS intent
         FROM calls c
         ${whereSql}
         AND c.classified_intent IS NOT NULL
         ORDER BY c.classified_intent ASC`,
        values,
      ),
      query(
        `SELECT DISTINCT c.end_reason, c.outcome
         FROM calls c
         ${whereSql}
         AND c.end_reason IS NOT NULL`,
        values,
      ),
      query(
        `SELECT DISTINCT c.direction
         FROM calls c
         ${whereSql}
         AND c.direction IS NOT NULL
         ORDER BY c.direction ASC`,
        values,
      ),
      query(
        `SELECT DISTINCT c.phone_number
         FROM calls c
         ${whereSql}
         AND c.phone_number IS NOT NULL
         ORDER BY c.phone_number ASC`,
        values,
      ),
      query(
        `SELECT DISTINCT COALESCE(payload->>'toolName', payload->>'tool_name') AS tool_name
         FROM call_events
         WHERE org_id = $1
           AND event_type = 'tool_called'
           AND COALESCE(payload->>'toolName', payload->>'tool_name') IS NOT NULL
         ORDER BY tool_name ASC`,
        [orgId],
      ),
    ]);

    const reasonSet = new Set<string>();
    for (const row of reasonRows.rows as Array<{ end_reason?: string | null; outcome?: string | null }>) {
      const label = normalizeEndReasonLabel(row.end_reason, row.outcome);
      if (label) reasonSet.add(label);
    }

    sendData(reply, {
      intents: (intentRows.rows as Array<{ intent?: string | null }>)
        .map((row) => capitalizeFirst(row.intent))
        .filter((value): value is string => typeof value === "string" && value.length > 0),
      endReasons: Array.from(reasonSet).sort((a, b) => a.localeCompare(b)),
      directions: (directionRows.rows as Array<{ direction?: string | null }>)
        .map((row) => row.direction)
        .filter((value): value is string => value === "inbound" || value === "outbound"),
      phoneLines: (phoneRows.rows as Array<{ phone_number?: string | null }>)
        .map((row) => row.phone_number?.trim())
        .filter((value): value is string => !!value)
        .map((number) => ({ id: number, number, name: number })),
      tools: (toolRows.rows as Array<{ tool_name?: string | null }>)
        .map((row) => row.tool_name?.trim())
        .filter((value): value is string => !!value),
      results: ["completed", "handoff", "dropped", "systemFailed", "pending"],
    });
  });

  app.get("/calls/live", {
    preHandler: resolvedAuthHook(["admin", "editor", "viewer"]),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const queryInput = (request.query ?? {}) as {
      orgId?: string;
      includeStale?: string | boolean;
      excludeStale?: string | boolean;
      staleAfterMinutes?: string | number;
    };
    const orgId = requireOrgForRequest(request, reply, queryInput.orgId);
    if (!orgId) return;

    const includeStale = parseBoolean(queryInput.includeStale, false);
    const excludeStale = includeStale ? false : parseBoolean(queryInput.excludeStale, true);
    const staleAfterMinutes = parsePositiveInt(
      queryInput.staleAfterMinutes,
      DEFAULT_STALE_LIVE_THRESHOLD_MINUTES,
      1,
      24 * 60,
    );
    const whereSql = excludeStale
      ? `AND started_at >= now() - ($3::int * interval '1 minute')`
      : "";
    const result = await query(
      `SELECT * FROM calls WHERE org_id = $1 AND status = ANY($2::text[])
       AND ended_at IS NULL
       ${whereSql}
       ORDER BY started_at DESC`,
      excludeStale
        ? [orgId, Array.from(LIVE_OR_HANDOFF_STATUSES), staleAfterMinutes]
        : [orgId, Array.from(LIVE_OR_HANDOFF_STATUSES)],
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
        let tags = new Set<string>();
        for (const event of eventRows) {
          const payload = event.payload ?? {};
          if (event.event_type === "call_tagged" && typeof payload.tag === "string") {
            tags.add(payload.tag);
          } else if (event.event_type === "call_tags_updated" && Array.isArray(payload.tags)) {
            tags = new Set<string>();
            for (const tag of payload.tags) {
              if (typeof tag === "string" && tag.trim().length > 0) {
                tags.add(tag.trim());
              }
            }
          } else if (event.event_type === "call_flagged") {
            tags.add("flagged");
          }
        }

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
          timeline: eventRows.map(mapTimelineEvent),
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
          tags: Array.from(tags),
        };
      })
    );

    sendData(reply, liveCalls);
  });

  app.post("/calls/reconcile-stale", {
    preHandler: resolvedAuthOrInternalHook(["admin", "editor"]),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as { orgId?: string; thresholdMinutes?: number };
    const queryInput = (request.query ?? {}) as { orgId?: string; thresholdMinutes?: string | number };

    let orgId: string | null = null;
    if (request.internalServiceAuth) {
      orgId = body.orgId ?? queryInput.orgId ?? null;
    } else {
      orgId = requireOrgForRequest(request, reply, queryInput.orgId);
      if (!orgId) return;
    }

    const thresholdMinutes = parsePositiveInt(
      body.thresholdMinutes ?? queryInput.thresholdMinutes,
      DEFAULT_STALE_LIVE_THRESHOLD_MINUTES,
      1,
      24 * 60,
    );

    const closedResult = orgId
      ? await query(
          `UPDATE calls
           SET status = 'abandoned',
               outcome = 'abandoned',
               end_reason = 'timeout',
               failure_type = COALESCE(failure_type, 'stale_live_timeout'),
               ended_at = COALESCE(ended_at, now()),
               duration_sec = COALESCE(
                 duration_sec,
                 GREATEST(0, EXTRACT(EPOCH FROM (now() - started_at))::int)
               )
           WHERE org_id = $1
             AND status = ANY($2::text[])
             AND ended_at IS NULL
             AND started_at < now() - ($3::int * interval '1 minute')
           RETURNING call_id, org_id`,
          [orgId, Array.from(LIVE_STATUSES), thresholdMinutes],
        )
      : await query(
          `UPDATE calls
           SET status = 'abandoned',
               outcome = 'abandoned',
               end_reason = 'timeout',
               failure_type = COALESCE(failure_type, 'stale_live_timeout'),
               ended_at = COALESCE(ended_at, now()),
               duration_sec = COALESCE(
                 duration_sec,
                 GREATEST(0, EXTRACT(EPOCH FROM (now() - started_at))::int)
               )
           WHERE status = ANY($1::text[])
             AND ended_at IS NULL
             AND started_at < now() - ($2::int * interval '1 minute')
           RETURNING call_id, org_id`,
          [Array.from(LIVE_STATUSES), thresholdMinutes],
        );

    for (const row of closedResult.rows as Array<{ call_id: string; org_id: string }>) {
      await callStore.insertEvent({
        callId: row.call_id,
        orgId: row.org_id,
        eventType: "call_ended",
        payload: {
          source: "stale_reconciler",
          outcome: "abandoned",
          endReason: "timeout",
          thresholdMinutes,
        },
      });
    }

    sendData(reply, {
      closedCount: closedResult.rowCount ?? 0,
      callIds: (closedResult.rows as Array<{ call_id: string }>).map((row) => row.call_id),
      scope: orgId ?? "all_orgs",
      thresholdMinutes,
    });
  });

  app.post("/calls/bulk-delete", {
    preHandler: resolvedAuthHook(["admin", "editor"]),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;
    const body = (request.body ?? {}) as { callIds?: string[] };
    const callIds = Array.isArray(body.callIds) ? body.callIds.filter((id) => typeof id === "string" && id.trim().length > 0) : [];
    if (callIds.length === 0) {
      return reply.status(400).send({ error: "callIds required" });
    }

    const result = await query(
      `DELETE FROM calls
       WHERE org_id = $1 AND call_id = ANY($2::text[])
       RETURNING call_id`,
      [orgId, callIds],
    );
    sendData(reply, { deletedCount: result.rowCount ?? 0, deletedIds: result.rows.map((r: any) => r.call_id) });
  });

  app.post("/calls/bulk-tag", {
    preHandler: resolvedAuthHook(["admin", "editor"]),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;
    const body = (request.body ?? {}) as { callIds?: string[]; tag?: string };
    const callIds = Array.isArray(body.callIds) ? body.callIds.filter((id) => typeof id === "string" && id.trim().length > 0) : [];
    const tag = typeof body.tag === "string" ? body.tag.trim() : "";
    if (callIds.length === 0 || !tag) {
      return reply.status(400).send({ error: "callIds and tag required" });
    }

    const existing = await query(
      `SELECT call_id FROM calls WHERE org_id = $1 AND call_id = ANY($2::text[])`,
      [orgId, callIds],
    );
    const validIds = existing.rows.map((r: any) => r.call_id);
    for (const callId of validIds) {
      await callStore.insertEvent({
        callId,
        orgId,
        eventType: "call_tagged",
        payload: { tag },
      });
    }

    sendData(reply, { taggedCount: validIds.length, tag });
  });

  app.post("/calls/:id/end", {
    preHandler: resolvedAuthHook(["admin", "editor"]),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;
    const { id } = request.params as { id: string };

    const current = await callStore.getCall(id);
    if (!current || current.orgId !== orgId) {
      return sendError(reply, 404, "not_found", "Call not found");
    }

    const nowIso = new Date().toISOString();
    const durationSec =
      current.durationSec ??
      Math.max(0, Math.floor((Date.now() - new Date(current.startedAt).getTime()) / 1000));
    const updateOk = await callStore.upsertCall({
      ...current,
      status: "completed",
      outcome: "handled",
      endReason: "agent_end",
      endedAt: current.endedAt ?? nowIso,
      durationSec,
    });
    if (!updateOk) {
      return sendError(reply, 500, "persist_failed", "Failed to end call");
    }
    await callStore.insertEvent({
      callId: id,
      orgId,
      eventType: "call_ended",
      payload: {
        source: "dashboard_action",
        outcome: "handled",
        endReason: "agent_end",
      },
    });

    sendData(reply, { ok: true });
  });

  app.post("/calls/:id/handoff", {
    preHandler: resolvedAuthHook(["admin", "editor"]),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { target?: string | null; createFollowUp?: boolean };

    const current = await callStore.getCall(id);
    if (!current || current.orgId !== orgId) {
      return sendError(reply, 404, "not_found", "Call not found");
    }

    const nowIso = new Date().toISOString();
    const durationSec =
      current.durationSec ??
      Math.max(0, Math.floor((Date.now() - new Date(current.startedAt).getTime()) / 1000));
    const updateOk = await callStore.upsertCall({
      ...current,
      status: "transferred",
      outcome: "transferred",
      endReason: "transfer",
      endedAt: current.endedAt ?? nowIso,
      durationSec,
    });
    if (!updateOk) {
      return sendError(reply, 500, "persist_failed", "Failed to handoff call");
    }
    await callStore.insertEvent({
      callId: id,
      orgId,
      eventType: "transfer",
      payload: {
        source: "dashboard_action",
        target: body.target ?? null,
        createFollowUp: !!body.createFollowUp,
      },
    });
    await callStore.insertEvent({
      callId: id,
      orgId,
      eventType: "call_ended",
      payload: {
        source: "dashboard_action",
        outcome: "transferred",
        endReason: "transfer",
        target: body.target ?? null,
      },
    });

    sendData(reply, { ok: true });
  });

  app.post("/calls/:id/flag", {
    preHandler: resolvedAuthHook(["admin", "editor"]),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { reason?: string; detail?: string };

    const current = await callStore.getCall(id);
    if (!current || current.orgId !== orgId) {
      return sendError(reply, 404, "not_found", "Call not found");
    }

    await callStore.insertEvent({
      callId: id,
      orgId,
      eventType: "call_flagged",
      payload: {
        reason: body.reason ?? "manual_review",
        detail: body.detail ?? null,
        tag: "flagged",
      },
    });

    sendData(reply, { ok: true });
  });

  app.post("/calls/:id/notes", {
    preHandler: resolvedAuthHook(["admin", "editor"]),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { note?: string };
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (!note) {
      return sendError(reply, 400, "bad_request", "note is required");
    }

    const current = await callStore.getCall(id);
    if (!current || current.orgId !== orgId) {
      return sendError(reply, 404, "not_found", "Call not found");
    }

    await callStore.insertEvent({
      callId: id,
      orgId,
      eventType: "call_note",
      payload: { note },
    });
    sendData(reply, { ok: true });
  });

  app.post("/calls/:id/tags", {
    preHandler: resolvedAuthHook(["admin", "editor"]),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { tags?: string[] };
    const tags = Array.isArray(body.tags)
      ? Array.from(
          new Set(
            body.tags
              .filter((tag): tag is string => typeof tag === "string")
              .map((tag) => tag.trim())
              .filter((tag) => tag.length > 0),
          ),
        )
      : [];
    if (tags.length === 0) {
      return sendError(reply, 400, "bad_request", "tags is required");
    }

    const current = await callStore.getCall(id);
    if (!current || current.orgId !== orgId) {
      return sendError(reply, 404, "not_found", "Call not found");
    }

    await callStore.insertEvent({
      callId: id,
      orgId,
      eventType: "call_tags_updated",
      payload: { tags },
    });
    sendData(reply, { ok: true, tags });
  });

  app.get("/calls/:id/timeline", {
    preHandler: resolvedAuthHook(["admin", "editor", "viewer"]),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const eventRows = (await query(
      "SELECT * FROM call_events WHERE call_id = $1 ORDER BY occurred_at",
      [id]
    )).rows;

    const timeline = eventRows.map(mapTimelineEvent);

    sendData(reply, timeline);
  });

  app.get("/calls/:id/transcript", {
    preHandler: resolvedAuthHook(["admin", "editor", "viewer"]),
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
    preHandler: resolvedAuthHook(["admin", "editor", "viewer"]),
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

}
