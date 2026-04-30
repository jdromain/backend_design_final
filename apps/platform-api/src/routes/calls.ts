import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Type } from "@sinclair/typebox";
import { createLogger } from "@rezovo/logging";
import {
  deriveCanonicalActionClass,
  deriveCanonicalFailureCategory,
  inferFailureCategoryFromString,
  isCanonicalTerminalStatus,
  mapCanonicalToDisplayLabels,
  normalizeCanonicalIntentCategory,
  toCanonicalConfidenceBand,
  validateCanonicalTerminalTuple,
  type CanonicalActionClass,
  type CanonicalCallStatus,
  type CanonicalConfidenceBand,
  type CanonicalEndReason,
  type CanonicalFailureCategory,
  type CanonicalIntentCategory,
  type CanonicalIntentSource,
  type CanonicalOutcome,
  type CanonicalTerminalTuple,
} from "@rezovo/core-types";
import { callStore, CallRecord, TranscriptEntry, CallEvent } from "../persistence/callStore";
import { PersistenceStore } from "../persistence/store";
import { query } from "../persistence/dbClient";
import { sendData, sendError } from "../lib/responses";
import { resolvedAuthHook, authOrInternalHook } from "../auth/jwt";
import { requireOrgForRequest } from "../auth/orgScope";
import { CallsListEnvelopeSchema } from "../contracts/httpSchemas";
import {
  isDefaultCompletionReason,
  normalizeEndReasonKey,
  uiResultToOutcome,
} from "../lib/callTaxonomy";

const logger = createLogger({ service: "platform-api", module: "callRoutes" });
const resolvedAuthOrInternalHook = authOrInternalHook;
const DEFAULT_CALLS_PAGE_LIMIT = 100;
const MAX_CALLS_PAGE_LIMIT = 500;
const DEFAULT_STALE_LIVE_THRESHOLD_MINUTES = 15;
const LIVE_STATUSES = ["initiated", "ringing", "in_progress"] as const;
const LIVE_OR_HANDOFF_STATUSES = ["initiated", "ringing", "in_progress", "transferred"] as const;
const TERMINAL_STATUSES = new Set(["completed", "failed", "abandoned", "transferred"]);
const TERMINAL_OUTCOMES = new Set(["handled", "failed", "abandoned", "transferred"]);
const persistenceForUsage = new PersistenceStore();

type TimelineUiType =
  | "call_started"
  | "agent_spoke"
  | "caller_spoke"
  | "tool_called"
  | "call_ended"
  | "transfer"
  | "error"
  | "unknown";

type ListUiResult = "completed" | "handoff" | "dropped" | "systemFailed" | "pending" | "unknown";
type LiveUiState = "ringing" | "active" | "at_risk" | "handoff_requested" | "error" | "unknown";

type CallEndRequestBody = {
  callId: string;
  orgId: string;
  status?: string;
  endReason?: string;
  outcome?: string;
  terminalStatusSource?: string;
  durationSec?: number;
  classifiedIntent?: string;
  intentConfidence?: number;
  intentSource?: string;
  intentConfidenceBand?: string;
  labelVersion?: number;
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

type CanonicalCallView = {
  status: CanonicalCallStatus;
  outcome: CanonicalOutcome;
  endReason: CanonicalEndReason;
  terminalStatusSource: "realtime" | "carrier" | "system" | "unknown";
  intentSource: CanonicalIntentSource;
  intentConfidenceBand: CanonicalConfidenceBand;
};

type CanonicalClassificationView = {
  status: CanonicalCallStatus;
  outcome: CanonicalOutcome;
  endReason: CanonicalEndReason;
  failureCategory: CanonicalFailureCategory;
  intentCategory: CanonicalIntentCategory;
  intentConfidenceBand: CanonicalConfidenceBand;
  actionClass: CanonicalActionClass;
  toolSummary: {
    toolsUsedCount: number;
    toolErrorsCount: number;
    primaryFailedTool: string;
    toolFailureClass: CanonicalFailureCategory;
  };
  provenance: {
    terminalStatusSource: "realtime" | "carrier" | "system" | "unknown";
    intentSource: CanonicalIntentSource;
    labelVersion: number;
  };
};

export type DerivedTool = {
  eventId?: string;
  timestamp?: string;
  name: string;
  success: boolean;
  latency?: number;
  error?: string;
};

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

function capitalizeFirst(s: string | undefined | null): string | undefined {
  if (!s) return undefined;
  if (s === "unknown") return "Unknown";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function normalizeTerminalStatusSource(
  source?: string | null
): "realtime" | "carrier" | "system" | "unknown" {
  return source === "realtime" || source === "carrier" || source === "system" || source === "unknown"
    ? source
    : "unknown";
}

function normalizeIntentSource(source?: string | null): CanonicalIntentSource {
  return source === "model_classifier" ||
    source === "agent_inference" ||
    source === "human_override" ||
    source === "unknown"
    ? source
    : "unknown";
}

function normalizeCanonicalCallStatus(status?: string | null): CanonicalCallStatus {
  return status === "initiated" ||
    status === "ringing" ||
    status === "in_progress" ||
    status === "completed" ||
    status === "failed" ||
    status === "abandoned" ||
    status === "transferred" ||
    status === "unknown"
    ? status
    : "unknown";
}

function inferStatusFromOutcome(outcome?: string | null): CanonicalTerminalTuple["status"] | undefined {
  switch (outcome) {
    case "handled":
      return "completed";
    case "transferred":
      return "transferred";
    case "abandoned":
      return "abandoned";
    case "failed":
      return "failed";
    default:
      return undefined;
  }
}

function inferOutcomeFromStatus(status?: string | null): CanonicalTerminalTuple["outcome"] | undefined {
  switch (status) {
    case "completed":
      return "handled";
    case "transferred":
      return "transferred";
    case "abandoned":
      return "abandoned";
    case "failed":
      return "failed";
    default:
      return undefined;
  }
}

export function resolveCanonicalTerminalTuple(input: {
  status?: string | null;
  outcome?: string | null;
  endReason?: string | null;
}): { ok: true; tuple: CanonicalTerminalTuple } | { ok: false; error: string } {
  const status = isCanonicalTerminalStatus(input.status)
    ? input.status
    : inferStatusFromOutcome(input.outcome);
  const outcome = input.outcome === "handled" ||
    input.outcome === "transferred" ||
    input.outcome === "abandoned" ||
    input.outcome === "failed"
    ? input.outcome
    : inferOutcomeFromStatus(input.status);

  if (!status || !outcome) {
    return { ok: false, error: "missing canonical terminal status/outcome" };
  }

  const validated = validateCanonicalTerminalTuple({
    status,
    outcome,
    endReason: input.endReason ?? "unknown",
  });
  if (!validated.valid) {
    return { ok: false, error: validated.reason ?? "invalid terminal tuple" };
  }
  return { ok: true, tuple: validated.normalized };
}

function mapOutcomeToUiResult(canonical: Pick<CanonicalCallView, "status" | "outcome">): ListUiResult {
  switch (canonical.outcome) {
    case "handled":
      return "completed";
    case "transferred":
      return "handoff";
    case "abandoned":
      return "dropped";
    case "failed":
      return "systemFailed";
    case "unknown":
      if (canonical.status === "initiated" || canonical.status === "ringing" || canonical.status === "in_progress") {
        return "pending";
      }
      return "unknown";
    default:
      return "unknown";
  }
}

function mapStatusToLiveState(status: CanonicalCallStatus): LiveUiState {
  switch (status) {
    case "initiated":
    case "ringing":
      return "ringing";
    case "in_progress":
      return "active";
    case "transferred":
      return "handoff_requested";
    case "failed":
      return "error";
    case "unknown":
      return "unknown";
    default:
      return "at_risk";
  }
}

export function deriveToolsFromEventRows(rows: Array<Record<string, any>>): { tools: DerivedTool[]; toolErrors: number } {
  const tools = rows
    .filter((row) => row.event_type === "tool_called")
    .map((row) => {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      const result = String(payload.result ?? "unknown").toLowerCase();
      const success = result !== "error" && result !== "failed";
      return {
        eventId: row.id,
        timestamp: row.occurred_at,
        name: String(payload.toolName ?? payload.tool_name ?? "unknown"),
        success,
        latency: typeof payload.latencyMs === "number" ? payload.latencyMs : undefined,
        error: typeof payload.error === "string" ? payload.error : undefined,
      } satisfies DerivedTool;
    });

  return {
    tools,
    toolErrors: tools.filter((tool) => !tool.success).length,
  };
}

export function deriveFailureType(canonical: CanonicalCallView, callFailureType: string | undefined, tools: DerivedTool[]): string {
  if (callFailureType && callFailureType.trim().length > 0) return callFailureType;
  if (canonical.outcome !== "failed") return "unknown";

  const firstToolError = tools.find((tool) => !tool.success && tool.error);
  if (firstToolError?.error) return firstToolError.error;
  if (canonical.endReason !== "unknown") return canonical.endReason;
  return "unknown";
}

function deriveToolFailureClass(tools: DerivedTool[]): CanonicalFailureCategory {
  const firstToolError = tools.find((tool) => !tool.success);
  if (!firstToolError) return "unknown";
  if (firstToolError.error) {
    const inferred = inferFailureCategoryFromString(firstToolError.error);
    if (inferred !== "unknown") return inferred;
  }
  return "tool_error";
}

function deriveClassification(
  canonical: CanonicalCallView,
  call: Pick<CallRecord, "failureType" | "classifiedIntent" | "labelVersion">,
  tools: DerivedTool[]
): CanonicalClassificationView {
  const toolErrorsCount = tools.filter((tool) => !tool.success).length;
  const primaryFailedTool = tools.find((tool) => !tool.success)?.name ?? "unknown";
  const toolFailureClass = deriveToolFailureClass(tools);

  const failureCategory = deriveCanonicalFailureCategory({
    outcome: canonical.outcome,
    failureType: call.failureType,
    toolErrorsCount,
    endReason: canonical.endReason,
    toolFailureClass,
  });

  const intentCategory = normalizeCanonicalIntentCategory(capitalizeFirst(call.classifiedIntent) ?? "Unknown");
  const ambiguousFailed =
    canonical.outcome === "failed" &&
    failureCategory === "unknown" &&
    canonical.endReason === "unknown" &&
    !call.failureType &&
    toolErrorsCount === 0;

  const effectiveOutcome: CanonicalOutcome = ambiguousFailed ? "unknown" : canonical.outcome;

  const actionClass = deriveCanonicalActionClass({
    outcome: effectiveOutcome,
    endReason: canonical.endReason,
    failureCategory,
    intentCategory,
    toolErrorsCount,
  });

  return {
    status: canonical.status,
    outcome: effectiveOutcome,
    endReason: canonical.endReason,
    failureCategory,
    intentCategory,
    intentConfidenceBand: canonical.intentConfidenceBand,
    actionClass,
    toolSummary: {
      toolsUsedCount: tools.length,
      toolErrorsCount,
      primaryFailedTool,
      toolFailureClass,
    },
    provenance: {
      terminalStatusSource: canonical.terminalStatusSource,
      intentSource: canonical.intentSource,
      labelVersion: call.labelVersion ?? 1,
    },
  };
}

export function deriveCanonicalCallView(call: Pick<
  CallRecord,
  "status" | "outcome" | "endReason" | "terminalStatusSource" | "intentSource" | "intentConfidenceBand" | "intentConfidence"
>): CanonicalCallView {
  const status = normalizeCanonicalCallStatus(call.status);

  if (isCanonicalTerminalStatus(status)) {
    const validated = validateCanonicalTerminalTuple({
      status,
      outcome: call.outcome,
      endReason: call.endReason,
    });

    if (validated.valid) {
      return {
        status: validated.normalized.status,
        outcome: validated.normalized.outcome,
        endReason: validated.normalized.endReason,
        terminalStatusSource: normalizeTerminalStatusSource(call.terminalStatusSource),
        intentSource: normalizeIntentSource(call.intentSource),
        intentConfidenceBand:
          call.intentConfidenceBand === "high" ||
          call.intentConfidenceBand === "medium" ||
          call.intentConfidenceBand === "low" ||
          call.intentConfidenceBand === "unknown"
            ? call.intentConfidenceBand
            : toCanonicalConfidenceBand(call.intentConfidence),
      };
    }
  }

  return {
    status,
    outcome: "unknown",
    endReason: "unknown",
    terminalStatusSource: normalizeTerminalStatusSource(call.terminalStatusSource),
    intentSource: normalizeIntentSource(call.intentSource),
    intentConfidenceBand:
      call.intentConfidenceBand === "high" ||
      call.intentConfidenceBand === "medium" ||
      call.intentConfidenceBand === "low" ||
      call.intentConfidenceBand === "unknown"
        ? call.intentConfidenceBand
        : toCanonicalConfidenceBand(call.intentConfidence),
  };
}

export function mapTimelineType(rawType: string, payload: Record<string, unknown> | undefined): TimelineUiType {
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
      const callStatus = typeof payload?.CallStatus === "string" ? payload.CallStatus.toLowerCase() : "";
      if (["failed", "busy", "no-answer", "canceled", "cancelled"].includes(callStatus)) return "error";
      if (callStatus === "completed") return "call_ended";
      if (["ringing", "in-progress", "queued", "initiated"].includes(callStatus)) return "call_started";
      return "unknown";
    }
    default:
      return "unknown";
  }
}

export function mapTimelineEvent(e: any) {
  const rawType = String(e.event_type ?? "unknown");
  const payload = (e.payload ?? {}) as Record<string, unknown>;
  const mappedType = mapTimelineType(rawType, payload);
  const description = rawType.replace(/_/g, " ");
  const details = [payload?.description]
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .join(" • ");

  return {
    id: e.id,
    type: mappedType,
    timestamp: e.occurred_at,
    description,
    details: details.length > 0 ? details : undefined,
    canonical: {
      rawType,
      mappedType,
    },
    display: {
      typeLabel: mappedType === "unknown" ? "Unknown" : mappedType.replace(/_/g, " "),
    },
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

export function mapCallListItem(c: CallRecord, tools: DerivedTool[]) {
  const canonical = deriveCanonicalCallView(c);
  const classification = deriveClassification(canonical, c, tools);
  const failureType = deriveFailureType(canonical, c.failureType, tools);
  const displayBase = mapCanonicalToDisplayLabels({
    status: classification.status,
    outcome: classification.outcome,
    endReason: classification.endReason,
    intent: classification.intentCategory,
    toolsUsedCount: classification.toolSummary.toolsUsedCount,
    toolErrorCount: classification.toolSummary.toolErrorsCount,
    failureType,
  });

  return {
    callId: c.callId,
    startedAt: c.startedAt,
    endedAt: c.endedAt,
    callerNumber: c.callerNumber,
    phoneLineId: c.phoneNumber,
    phoneLineNumber: c.phoneNumber,
    agentId: c.agentConfigId ?? "default",
    agentName: c.agentConfigId ?? "Rezovo Agent",
    intent: classification.intentCategory,
    direction: c.direction ?? "inbound",
    durationMs: (c.durationSec ?? 0) * 1000,
    result: mapOutcomeToUiResult(classification),
    endReason: classification.endReason,
    failureType: mapOutcomeToUiResult(classification) === "systemFailed" ? failureType : undefined,
    turnCount: c.turnCount,
    toolsUsed: tools.map((tool) => ({ name: tool.name, success: tool.success })),
    toolErrors: classification.toolSummary.toolErrorsCount,
    classification,
    canonical: {
      status: classification.status,
      outcome: classification.outcome,
      endReason: classification.endReason,
      terminalStatusSource: classification.provenance.terminalStatusSource,
      intentSource: classification.provenance.intentSource,
      intentConfidenceBand: classification.intentConfidenceBand,
    },
    display: {
      status: displayBase.statusLabel,
      result: displayBase.resultLabel,
      reason: displayBase.reasonLabel,
      intent: displayBase.intentLabel,
      tools: displayBase.toolsLabel,
      failureType: displayBase.failureTypeLabel,
    },
  };
}

export function mapLiveCallItem(row: any, eventRows: any[], transcriptRows: any[]) {
  const canonical = deriveCanonicalCallView({
    status: row.status,
    outcome: row.outcome,
    endReason: row.end_reason,
    terminalStatusSource: row.terminal_status_source,
    intentSource: row.intent_source,
    intentConfidenceBand: row.intent_confidence_band,
    intentConfidence: row.intent_confidence,
  });

  const { tools } = deriveToolsFromEventRows(eventRows);
  const classification = deriveClassification(
    canonical,
    {
      failureType: row.failure_type,
      classifiedIntent: row.classified_intent,
      labelVersion: row.label_version,
    },
    tools
  );
  const failureType = deriveFailureType(canonical, row.failure_type, tools);
  const displayBase = mapCanonicalToDisplayLabels({
    status: classification.status,
    outcome: classification.outcome,
    endReason: classification.endReason,
    intent: classification.intentCategory,
    toolsUsedCount: classification.toolSummary.toolsUsedCount,
    toolErrorCount: classification.toolSummary.toolErrorsCount,
    failureType,
  });

  const nowMs = Date.now();
  const startMs = new Date(row.started_at).getTime();

  return {
    callId: row.call_id,
    callerNumber: row.caller_number,
    agentName: row.agent_config_id ?? "Rezovo Agent",
    agentVersion: String(row.agent_config_ver ?? 1),
    intent: classification.intentCategory,
    state: mapStatusToLiveState(classification.status),
    direction: row.direction ?? "inbound",
    startedAt: row.started_at,
    durationSeconds: Math.floor((nowMs - startMs) / 1000),
    lastEvent: eventRows.length > 0 ? eventRows[eventRows.length - 1].event_type : "call_started",
    riskFlags:
      classification.actionClass === "engineering_investigate"
        ? ["investigate"]
        : classification.actionClass === "escalate_human"
          ? ["handoff_requested"]
          : classification.actionClass === "followup_required"
            ? ["followup_required"]
            : classification.actionClass === "review_required"
              ? ["review_required"]
              : [],
    timeline: eventRows.map(mapTimelineEvent),
    transcript: transcriptRows.map((t: any) => ({
      id: t.id,
      role: t.speaker === "user" ? "caller" : "agent",
      text: t.text,
      timestamp: t.spoken_at,
    })),
    tools: tools.map((tool) => ({
      id: tool.eventId,
      name: tool.name,
      status: tool.success ? "success" : "failed",
      latency: tool.latency,
      timestamp: tool.timestamp,
      error: tool.error,
    })),
    tags: [] as string[],
    classification,
    canonical: {
      status: classification.status,
      outcome: classification.outcome,
      endReason: classification.endReason,
      terminalStatusSource: classification.provenance.terminalStatusSource,
      intentSource: classification.provenance.intentSource,
      intentConfidenceBand: classification.intentConfidenceBand,
      failureType,
      toolErrors: classification.toolSummary.toolErrorsCount,
    },
    display: {
      status: displayBase.statusLabel,
      result: displayBase.resultLabel,
      reason: displayBase.reasonLabel,
      intent: displayBase.intentLabel,
      tools: displayBase.toolsLabel,
      failureType: displayBase.failureTypeLabel,
    },
  };
}

async function resolveCallOrgId(callId: string): Promise<string | null> {
  const result = await query("SELECT org_id FROM calls WHERE call_id = $1", [callId]);
  return result.rows[0]?.org_id ?? null;
}

export function registerCallRoutes(app: FastifyInstance) {
  // ----------------------------------------------------------------
  // Internal write routes (realtime-core contract, unchanged)
  // ----------------------------------------------------------------

  app.post("/calls/start", {
    preHandler: resolvedAuthOrInternalHook(["admin", "editor"]),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
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
      terminalStatusSource: "unknown",
      intentSource: "unknown",
      intentConfidenceBand: "unknown",
      labelVersion: 1,
    };

    await callStore.upsertCall(record);

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

  app.post("/calls/end", {
    preHandler: resolvedAuthOrInternalHook(["admin", "editor"]),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as CallEndRequestBody;

    if (!body.callId || !body.orgId) {
      return reply.status(400).send({ error: "missing required fields: callId, orgId" });
    }

    const resolvedEndReason =
      typeof body.endReason === "string" && body.endReason.trim().length > 0
        ? body.endReason.trim()
        : body.outcome === "handled"
          ? "normal_completion"
          : undefined;

    const terminal = resolveCanonicalTerminalTuple({
      status: body.status,
      outcome: body.outcome,
      endReason: resolvedEndReason ?? body.endReason ?? "unknown",
    });

    if (!terminal.ok) {
      return reply.status(400).send({ error: terminal.error });
    }

    const existing = await callStore.getCall(body.callId);
    const update: CallRecord = {
      callId: body.callId,
      orgId: body.orgId,
      phoneNumber: existing?.phoneNumber ?? "",
      callerNumber: existing?.callerNumber ?? "",
      status: terminal.tuple.status,
      startedAt: existing?.startedAt ?? "",
      endedAt: new Date().toISOString(),
      durationSec: body.durationSec,
      endReason: terminal.tuple.endReason,
      outcome: terminal.tuple.outcome,
      terminalStatusSource: normalizeTerminalStatusSource(body.terminalStatusSource),
      failureType: body.failureType ?? (terminal.tuple.outcome === "failed" ? terminal.tuple.endReason : undefined),
      classifiedIntent: body.classifiedIntent,
      intentConfidence: body.intentConfidence,
      intentSource: normalizeIntentSource(body.intentSource),
      intentConfidenceBand:
        body.intentConfidenceBand === "high" ||
        body.intentConfidenceBand === "medium" ||
        body.intentConfidenceBand === "low" ||
        body.intentConfidenceBand === "unknown"
          ? body.intentConfidenceBand
          : toCanonicalConfidenceBand(body.intentConfidence),
      labelVersion: body.labelVersion ?? 1,
      finalIntent: body.finalIntent,
      slotsCollected: body.slotsCollected,
      turnCount: body.turnCount,
      llmTokensIn: body.llmTokensIn,
      llmTokensOut: body.llmTokensOut,
      ttsChars: body.ttsChars,
      sttSeconds: body.sttSeconds,
    };

    const inferredIntentCategory = normalizeCanonicalIntentCategory(capitalizeFirst(body.classifiedIntent) ?? "Unknown");
    const inferredFailureCategory = deriveCanonicalFailureCategory({
      outcome: terminal.tuple.outcome,
      failureType: body.failureType,
      endReason: terminal.tuple.endReason,
    });
    const inferredActionClass = deriveCanonicalActionClass({
      outcome: terminal.tuple.outcome,
      endReason: terminal.tuple.endReason,
      failureCategory: inferredFailureCategory,
      intentCategory: inferredIntentCategory,
    });
    update.failureCategory = inferredFailureCategory;
    update.actionClass = inferredActionClass;

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
        update.endedAt = existing.endedAt;
        update.durationSec = existing.durationSec ?? update.durationSec;
      }
    }

    try {
      await callStore.upsertCall(update);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: msg });
    }

    const durationSec = body.durationSec ?? existing?.durationSec ?? 0;
    const phoneForUsage = update.phoneNumber || existing?.phoneNumber || "";
    await persistenceForUsage.mirrorUsageRecordFromCallEnd({
      orgId: body.orgId,
      callId: body.callId,
      phoneNumber: phoneForUsage,
      durationSec,
    });

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
        status: terminal.tuple.status,
        endReason: terminal.tuple.endReason,
        outcome: terminal.tuple.outcome,
        terminalStatusSource: update.terminalStatusSource,
        failureCategory: update.failureCategory,
        actionClass: update.actionClass,
        durationSec: body.durationSec,
        classifiedIntent: body.classifiedIntent,
        turnCount: body.turnCount,
      },
    });

    logger.info("call record finalized", {
      callId: body.callId,
      status: update.status,
      outcome: update.outcome,
      endReason: update.endReason,
      durationSec: update.durationSec,
    });

    return reply.send({ ok: true });
  });

  app.post("/calls/event", {
    preHandler: resolvedAuthOrInternalHook(["admin", "editor"]),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
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
            return `(c.outcome IS NULL AND c.status = ANY('{${LIVE_STATUSES.join(",")}}'::text[]))`;
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
    const toolEventRows =
      callIds.length > 0
        ? (
            await query(
              `SELECT id, call_id, event_type, payload, occurred_at FROM call_events
               WHERE org_id = $1 AND event_type = 'tool_called' AND call_id = ANY($2::text[])`,
              [orgId, callIds]
            )
          ).rows
        : [];

    const toolRowsByCall = new Map<string, Array<Record<string, any>>>();
    for (const row of toolEventRows) {
      const curr = toolRowsByCall.get(row.call_id) ?? [];
      curr.push(row);
      toolRowsByCall.set(row.call_id, curr);
    }

    const mapped = calls.map((call) => {
      const { tools } = deriveToolsFromEventRows(toolRowsByCall.get(call.callId) ?? []);
      return mapCallListItem(call, tools);
    });

    sendData(reply, mapped);
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

        return mapLiveCallItem(row, eventRows, transcriptRows);
      })
    );

    sendData(reply, liveCalls);
  });

  app.get("/calls/:id/timeline", {
    preHandler: resolvedAuthHook(["admin", "editor", "viewer"]),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const callOrgId = await resolveCallOrgId(id);
    if (!callOrgId || callOrgId !== request.auth!.org_id) {
      return sendError(reply, 404, "not_found", "Call not found");
    }

    const eventRows = (await query(
      "SELECT * FROM call_events WHERE call_id = $1 AND org_id = $2 ORDER BY occurred_at",
      [id, callOrgId]
    )).rows;

    const timeline = eventRows.map(mapTimelineEvent);

    sendData(reply, timeline);
  });

  app.get("/calls/:id/transcript", {
    preHandler: resolvedAuthHook(["admin", "editor", "viewer"]),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const callOrgId = await resolveCallOrgId(id);
    if (!callOrgId || callOrgId !== request.auth!.org_id) {
      return sendError(reply, 404, "not_found", "Call not found");
    }

    const entries = await callStore.getTranscript(id, callOrgId);

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

    const callOrgId = await resolveCallOrgId(id);
    if (!callOrgId || callOrgId !== request.auth!.org_id) {
      return sendError(reply, 404, "not_found", "Call not found");
    }

    const eventRows = (await query(
      "SELECT * FROM call_events WHERE call_id = $1 AND org_id = $2 AND event_type = 'tool_called' ORDER BY occurred_at",
      [id, callOrgId]
    )).rows;

    const { tools } = deriveToolsFromEventRows(eventRows);

    const mapped = tools.map((tool) => ({
      id: tool.eventId,
      name: tool.name,
      status: tool.success ? "success" : "failed",
      latency: tool.latency,
      timestamp: tool.timestamp,
      error: tool.error,
    }));

    sendData(reply, mapped);
  });
}
