import { createHash } from "crypto";

import { EventBusClient } from "@rezovo/event-bus";
import {
  normalizeCanonicalIntentCategory,
  type CallIntelligenceTopicSource,
  type CallIntelligenceTopicState,
  type CallIntelligenceWarning,
  type CanonicalActionClass,
  type CanonicalFailureCategory,
  type CanonicalIntentCategory,
  type TypedEventEnvelope,
} from "@rezovo/core-types";
import { createLogger } from "@rezovo/logging";
import { Pool } from "pg";

const logger = createLogger({ service: "jobs", module: "callIntelligenceWorker" });

type CallRow = {
  call_id: string;
  org_id: string;
  direction: string | null;
  status: string | null;
  outcome: string | null;
  end_reason: string | null;
  ended_at: string | null;
  started_at: string | null;
  duration_sec: number | null;
  classified_intent: string | null;
  intent_confidence: number | null;
  intent_confidence_band: string | null;
  failure_category: string | null;
  action_class: string | null;
};

type TranscriptRow = {
  id: string | null;
  sequence: number | null;
  speaker: "user" | "agent";
  text: string;
  spoken_at: string | null;
  created_at: string | null;
};

type EventRow = {
  id: string | null;
  event_type: string;
  payload: Record<string, unknown> | null;
  occurred_at: string | null;
};

type ResolvedTranscript = {
  id: string;
  sequence: number;
  speaker: "user" | "agent";
  text: string;
  timestampMs: number;
  timestampSource: "spoken_at" | "event" | "ingestion";
};

let pool: Pool | null = null;

function getPool(): Pool {
  if (pool) return pool;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for call intelligence worker");
  }
  pool = new Pool({ connectionString: databaseUrl, max: 3, idleTimeoutMillis: 30_000 });
  pool.on("error", (err) => {
    logger.error("pg pool error", { error: err.message });
  });
  return pool;
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function floatFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolFromEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === "true";
}

const DEFAULT_PLATFORM_API_URL = "http://localhost:3001";
const DEFAULT_LOCAL_INTERNAL_TOKEN = "rezovo-local-internal-token";

const TRANSCRIPT_QUIET_MS = intFromEnv("INTEL_TRANSCRIPT_QUIET_MS", 8_000);
const TRANSCRIPT_MAX_WAIT_MS = intFromEnv("INTEL_TRANSCRIPT_MAX_WAIT_MS", 120_000);
const EVENT_GRACE_MS = intFromEnv("EVENT_GRACE_MS", 15_000);
const RETRY_MAX_ATTEMPTS = intFromEnv("INTEL_RETRY_MAX_ATTEMPTS", 6);
const RETRY_BASE_MS = intFromEnv("INTEL_RETRY_BASE_MS", 2_000);
const BACKFILL_LIMIT = intFromEnv("INTEL_BACKFILL_LIMIT", 250);
const BACKFILL_DELAY_MS = intFromEnv("INTEL_BACKFILL_DELAY_MS", 12_000);

const INTENT_REFINE_DELTA = floatFromEnv("INTENT_REFINE_DELTA", 0.10);
const TOPIC_FINAL_CONFIDENCE_MIN = floatFromEnv("INTEL_TOPIC_FINAL_CONFIDENCE_MIN", 0.72);
const TOPIC_PROVISIONAL_CONFIDENCE_MIN = floatFromEnv("INTEL_TOPIC_PROVISIONAL_CONFIDENCE_MIN", 0.60);
const EVIDENCE_STRONG_FLOOR = floatFromEnv("INTEL_EVIDENCE_STRONG_FLOOR", 0.70);
const EVIDENCE_MODERATE_FLOOR = floatFromEnv("INTEL_EVIDENCE_MODERATE_FLOOR", 0.45);

const classifierSchemaVersion = process.env.INTEL_CLASSIFIER_SCHEMA_VERSION ?? "v2";
const promptVersion = process.env.INTEL_PROMPT_VERSION ?? "rules-v1";
const modelVersion = process.env.INTEL_MODEL_VERSION ?? "rules-only";
const contextSchemaVersion = process.env.INTEL_CONTEXT_SCHEMA_VERSION ?? "ctx-v1";
const INTERPRETER_ENABLED = boolFromEnv("INTEL_INTERPRETER_ENABLED", false);
const INTERPRETER_MODE = (process.env.INTEL_INTERPRETER_MODE ?? "shadow").toLowerCase() === "active" ? "active" : "shadow";
const INTERPRETER_MODEL = process.env.INTEL_INTERPRETER_MODEL ?? process.env.LLM_MODEL ?? "gpt-4o-mini";
const INTERPRETER_API_BASE = process.env.INTEL_INTERPRETER_API_BASE ?? "https://api.openai.com/v1";
const INTERPRETER_MAX_TURNS = intFromEnv("INTEL_INTERPRETER_MAX_TURNS", 8);
const BACKFILL_DAYS = intFromEnv("INTEL_BACKFILL_DAYS", 30);

const ENRICHMENT_REVISION = `${classifierSchemaVersion}:${promptVersion}:${modelVersion}:${contextSchemaVersion}`;

const actionSeverity: Record<CanonicalActionClass, number> = {
  no_action: 0,
  review_required: 1,
  followup_required: 2,
  escalate_human: 3,
  engineering_investigate: 4,
};

const HIGH_RISK_FAILURE_CATEGORIES = new Set<CanonicalFailureCategory>([
  "tool_error",
  "config_error",
  "llm_error",
  "stt_error",
  "tts_error",
  "auth_error",
  "quota_error",
]);

type TopicSelection = {
  topic: string;
  source: CallIntelligenceTopicSource;
  state: CallIntelligenceTopicState;
  confidence: number | null;
  summary: string;
  shortReason: string;
  warning?: CallIntelligenceWarning;
};

type EvidenceQuality = {
  score: number;
  grade: "strong" | "moderate" | "weak";
};

type InterpreterOutput = {
  topic?: string;
  topicConfidence?: number | null;
  topicState?: "final" | "provisional" | "pending_analysis" | "insufficient_evidence" | "classification_failed" | "true_unknown";
  resolutionState?: "resolved" | "partially_resolved" | "unresolved" | "unknown";
  failureCategory?: CanonicalFailureCategory;
  actionClass?: CanonicalActionClass;
  riskLevel?: "low" | "medium" | "high";
  followupNeeded?: boolean;
  shortReason?: string;
  summary?: string;
  confidence?: {
    primaryIntent?: number | null;
    resolutionState?: number | null;
    failureCategory?: number | null;
    actionClass?: number | null;
    recommendations?: number | null;
  };
};

const GENERIC_TOPIC_TOKENS = new Set([
  "unknown",
  "support",
  "billing",
  "sales",
  "booking",
  "general inquiry",
  "other",
  "review required",
  "failed call",
  "call ended",
]);

const INTENT_TOPIC_PHRASES: Record<Exclude<CanonicalIntentCategory, "Unknown">, string> = {
  Billing: "Billing Question",
  Support: "Support Request",
  Sales: "Sales Inquiry",
  Booking: "Appointment Booking",
};

const INTENT_KEYWORDS: Record<Exclude<CanonicalIntentCategory, "Unknown">, RegExp[]> = {
  Billing: [
    /\bbill(?:ing)?\b/g,
    /\binvoice\b/g,
    /\bpayment\b/g,
    /\bcharge\b/g,
    /\brefund\b/g,
    /\bsubscription\b/g,
  ],
  Support: [
    /\bsupport\b/g,
    /\bhelp\b/g,
    /\bissue\b/g,
    /\bproblem\b/g,
    /\bnot\s+working\b/g,
    /\berror\b/g,
    /\bbug\b/g,
  ],
  Sales: [
    /\bsales\b/g,
    /\bprice\b/g,
    /\bpricing\b/g,
    /\bquote\b/g,
    /\bdemo\b/g,
    /\btrial\b/g,
    /\bbuy\b/g,
    /\bpurchase\b/g,
  ],
  Booking: [
    /\bbook(?:ing)?\b/g,
    /\bappointment\b/g,
    /\bschedule\b/g,
    /\breschedule\b/g,
    /\bcancel\b/g,
    /\bavailability\b/g,
  ],
};

const failureCategoryValues = new Set<CanonicalFailureCategory>([
  "carrier_error",
  "stt_error",
  "tts_error",
  "llm_error",
  "tool_error",
  "config_error",
  "auth_error",
  "quota_error",
  "unknown",
]);

const actionClassValues = new Set<CanonicalActionClass>([
  "no_action",
  "review_required",
  "followup_required",
  "escalate_human",
  "engineering_investigate",
]);

const pendingTimers = new Map<string, NodeJS.Timeout>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function warning(
  code: CallIntelligenceWarning["code"],
  field: string,
  message: string,
  severity: CallIntelligenceWarning["severity"] = "warn",
  count = 1,
  sampleIds: string[] = [],
): CallIntelligenceWarning {
  return {
    code,
    severity,
    field,
    message,
    count,
    sampleIds,
    detectedAt: new Date().toISOString(),
  };
}

function toFailureCategory(input: string | null): CanonicalFailureCategory {
  if (input && failureCategoryValues.has(input as CanonicalFailureCategory)) {
    return input as CanonicalFailureCategory;
  }
  return "unknown";
}

function toActionClass(input: string | null): CanonicalActionClass {
  if (input && actionClassValues.has(input as CanonicalActionClass)) {
    return input as CanonicalActionClass;
  }
  return "no_action";
}

function toIntentConfidenceProxy(band: string | null): number {
  switch ((band ?? "").toLowerCase()) {
    case "high":
      return 0.85;
    case "medium":
      return 0.65;
    case "low":
      return 0.4;
    default:
      return 0.35;
  }
}

function buildRevision(): string {
  return ENRICHMENT_REVISION;
}

async function loadContext(callId: string, orgId: string): Promise<{
  call: CallRow | null;
  transcripts: TranscriptRow[];
  events: EventRow[];
}> {
  const client = getPool();
  const [callRes, transcriptRes, eventRes] = await Promise.all([
    client.query<CallRow>(
       `SELECT
         call_id,
         org_id,
         direction,
         status,
         outcome,
         end_reason,
         ended_at,
         started_at,
         duration_sec,
         classified_intent,
         intent_confidence,
         intent_confidence_band,
         failure_category,
         action_class
       FROM calls
       WHERE call_id = $1 AND org_id = $2
       LIMIT 1`,
      [callId, orgId],
    ),
    client.query<TranscriptRow>(
      `SELECT id::text, sequence, speaker, text, spoken_at::text, created_at::text
       FROM call_transcript
       WHERE call_id = $1 AND org_id = $2
       ORDER BY sequence ASC`,
      [callId, orgId],
    ),
    client.query<EventRow>(
      `SELECT id::text, event_type, payload, occurred_at::text
       FROM call_events
       WHERE call_id = $1 AND org_id = $2`,
      [callId, orgId],
    ),
  ]);

  return {
    call: callRes.rows[0] ?? null,
    transcripts: transcriptRes.rows,
    events: eventRes.rows,
  };
}

function parseSequenceFromEventPayload(payload: Record<string, unknown> | null): number | null {
  if (!payload) return null;
  const raw = payload.sequence ?? payload.transcriptSequence ?? payload.utteranceSequence;
  const value = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.floor(value));
}

function eventTimestampMs(value: string | null): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function dedupeAndSortEvents(events: EventRow[], warnings: CallIntelligenceWarning[]): Array<EventRow & { occurredAtMs: number }> {
  const nullTimestampEvents = events.filter((event) => eventTimestampMs(event.occurred_at) === null);
  if (nullTimestampEvents.length > 0) {
    warnings.push(
      warning(
        "null_event_timestamp",
        "call_events.occurred_at",
        "excluded events with null/invalid occurred_at from ordered evidence",
        "warn",
        nullTimestampEvents.length,
        nullTimestampEvents.map((event) => event.id ?? "unknown").slice(0, 5),
      ),
    );
  }

  const seen = new Set<string>();
  const deduped: Array<EventRow & { occurredAtMs: number }> = [];

  for (const event of events) {
    const occurredAtMs = eventTimestampMs(event.occurred_at);
    if (occurredAtMs === null) continue;

    const fallbackKey = createHash("sha1")
      .update(
        JSON.stringify({
          eventType: event.event_type,
          payload: event.payload ?? {},
          occurredAt: event.occurred_at,
        }),
      )
      .digest("hex");

    const dedupeKey = event.id ?? fallbackKey;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    deduped.push({ ...event, occurredAtMs });
  }

  deduped.sort((a, b) => {
    if (a.occurredAtMs !== b.occurredAtMs) return a.occurredAtMs - b.occurredAtMs;
    const aId = a.id ?? "";
    const bId = b.id ?? "";
    return aId.localeCompare(bId);
  });

  return deduped;
}

function resolveTranscriptTimestamps(
  transcripts: TranscriptRow[],
  orderedEvents: Array<EventRow & { occurredAtMs: number }>,
  warnings: CallIntelligenceWarning[],
): ResolvedTranscript[] {
  const eventBySequence = new Map<number, number>();
  for (const event of orderedEvents) {
    const seq = parseSequenceFromEventPayload(event.payload);
    if (seq === null) continue;
    if (!eventBySequence.has(seq)) {
      eventBySequence.set(seq, event.occurredAtMs);
    }
  }

  const missingIds: string[] = [];
  const resolved: ResolvedTranscript[] = [];

  for (const row of transcripts) {
    const id = row.id ?? `seq:${row.sequence ?? 0}`;
    const sequence = typeof row.sequence === "number" ? row.sequence : 0;

    const spokenAtMs = eventTimestampMs(row.spoken_at);
    if (spokenAtMs !== null) {
      resolved.push({
        id,
        sequence,
        speaker: row.speaker,
        text: row.text,
        timestampMs: spokenAtMs,
        timestampSource: "spoken_at",
      });
      continue;
    }

    const eventMs = eventBySequence.get(sequence);
    if (typeof eventMs === "number") {
      resolved.push({
        id,
        sequence,
        speaker: row.speaker,
        text: row.text,
        timestampMs: eventMs,
        timestampSource: "event",
      });
      continue;
    }

    const createdAtMs = eventTimestampMs(row.created_at);
    if (createdAtMs !== null) {
      resolved.push({
        id,
        sequence,
        speaker: row.speaker,
        text: row.text,
        timestampMs: createdAtMs,
        timestampSource: "ingestion",
      });
      continue;
    }

    missingIds.push(id);
  }

  if (missingIds.length > 0) {
    warnings.push(
      warning(
        "missing_transcript_timestamp",
        "call_transcript.spoken_at",
        "transcript lines excluded due to missing timestamp source",
        "warn",
        missingIds.length,
        missingIds.slice(0, 5),
      ),
    );
  }

  resolved.sort((a, b) => (a.sequence !== b.sequence ? a.sequence - b.sequence : a.id.localeCompare(b.id)));
  return resolved;
}

function cutoffEvents(
  events: Array<EventRow & { occurredAtMs: number }>,
  endedAt: string | null,
  enrichmentStartMs: number,
): Array<EventRow & { occurredAtMs: number }> {
  if (!endedAt) return [];
  const endedMs = new Date(endedAt).getTime();
  if (!Number.isFinite(endedMs)) return [];

  const cutoffMs = Math.min(enrichmentStartMs, endedMs + EVENT_GRACE_MS);
  return events.filter((event) => event.occurredAtMs <= cutoffMs);
}

function readinessState(args: {
  call: CallRow;
  resolvedTranscripts: ResolvedTranscript[];
  enrichmentStartMs: number;
}): { ready: boolean; reason?: string } {
  const { call, resolvedTranscripts, enrichmentStartMs } = args;
  if (!call.ended_at) {
    return { ready: false, reason: "call has no ended_at" };
  }

  if (!call.status || !call.outcome || !call.end_reason) {
    return { ready: false, reason: "terminal tuple not persisted" };
  }

  const endedMs = new Date(call.ended_at).getTime();
  if (!Number.isFinite(endedMs)) {
    return { ready: false, reason: "invalid ended_at timestamp" };
  }

  const elapsedMs = enrichmentStartMs - endedMs;
  const latestTranscriptMs = resolvedTranscripts.length > 0
    ? resolvedTranscripts[resolvedTranscripts.length - 1].timestampMs
    : null;

  if (latestTranscriptMs === null) {
    if (elapsedMs >= TRANSCRIPT_MAX_WAIT_MS) {
      return { ready: true };
    }
    return { ready: false, reason: "waiting for transcript within max wait window" };
  }

  const quietMs = enrichmentStartMs - latestTranscriptMs;
  if (quietMs >= TRANSCRIPT_QUIET_MS || elapsedMs >= TRANSCRIPT_MAX_WAIT_MS) {
    return { ready: true };
  }

  return { ready: false, reason: "waiting for transcript quiet window" };
}

function toResolutionState(outcome: string | null): "resolved" | "partially_resolved" | "unresolved" | "unknown" {
  if (outcome === "handled") return "resolved";
  if (outcome === "transferred") return "partially_resolved";
  if (outcome === "failed" || outcome === "abandoned") return "unresolved";
  return "unknown";
}

function normalizeTopicToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericTopic(text: string): boolean {
  const token = normalizeTopicToken(text);
  return token.length === 0 || GENERIC_TOPIC_TOKENS.has(token);
}

function countRegexMatches(text: string, regex: RegExp): number {
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

function scoreIntentSignals(transcriptText: string): Array<{ intent: Exclude<CanonicalIntentCategory, "Unknown">; score: number }> {
  const lower = transcriptText.toLowerCase();
  return (Object.entries(INTENT_KEYWORDS) as Array<[Exclude<CanonicalIntentCategory, "Unknown">, RegExp[]]>).map(
    ([intent, patterns]) => ({
      intent,
      score: patterns.reduce((sum, pattern) => sum + countRegexMatches(lower, pattern), 0),
    }),
  );
}

function inferPrimaryIntentWithScore(
  transcriptText: string,
  fallback: string | null,
): { intent: CanonicalIntentCategory; score: number } {
  const scored = scoreIntentSignals(transcriptText).sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (best && best.score > 0) {
    return { intent: best.intent, score: best.score };
  }
  return { intent: normalizeCanonicalIntentCategory(fallback ?? "Unknown"), score: 0 };
}

function inferSecondaryIntents(transcriptText: string, primary: CanonicalIntentCategory): CanonicalIntentCategory[] {
  return scoreIntentSignals(transcriptText)
    .filter(({ intent, score }) => intent !== primary && score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ intent }) => intent)
    .slice(0, 3);
}

function deriveIntentTopicPhrase(intent: CanonicalIntentCategory): string | null {
  if (intent === "Unknown") return null;
  return INTENT_TOPIC_PHRASES[intent];
}

function deriveSemanticSubtopic(intent: CanonicalIntentCategory, transcriptText: string): string | null {
  const lower = transcriptText.toLowerCase();

  if (intent === "Booking") {
    if (/\breschedule\b|\bmove\b.*\bappointment\b/.test(lower)) return "Appointment Rescheduling";
    if (/\bcancel\b.*\bappointment\b/.test(lower)) return "Appointment Cancellation";
    if (/\bavailability\b|\btime slot\b|\bopenings?\b/.test(lower)) return "Availability Check";
    if (/\bbook(?:ing)?\b|\bschedule\b|\bappointment\b/.test(lower)) return "Appointment Booking";
  }

  if (intent === "Billing") {
    if (/\brefund\b|\bchargeback\b|\bdispute\b/.test(lower)) return "Refund Request";
    if (/\bcard\b|\bpayment\b|\bcharged?\b|\bdeclin(?:ed|e)\b/.test(lower)) return "Payment Issue";
    if (/\binvoice\b|\bbill(?:ing)?\b|\bsubscription\b/.test(lower)) return "Billing Question";
  }

  if (intent === "Support") {
    if (/\blogin\b|\bpassword\b|\baccount\b|\baccess\b/.test(lower)) return "Account Access Support";
    if (/\bintegration\b|\bapi\b|\bwebhook\b|\bsetup\b/.test(lower)) return "Integration Setup Support";
    if (/\bnot\s+working\b|\berror\b|\bbug\b|\bproblem\b/.test(lower)) return "Technical Support Issue";
    if (/\bsupport\b|\bhelp\b|\bissue\b/.test(lower)) return "Support Request";
  }

  if (intent === "Sales") {
    if (/\bprice\b|\bpricing\b|\bquote\b|\bcost\b/.test(lower)) return "Pricing Inquiry";
    if (/\bdemo\b|\btrial\b|\bonboarding\b/.test(lower)) return "Product Demo Request";
    if (/\bbuy\b|\bpurchase\b|\bplan\b/.test(lower)) return "Purchase Inquiry";
    if (/\bsales\b/.test(lower)) return "Sales Inquiry";
  }

  return null;
}

function inferFailureCategoryFromContext(args: {
  existing: CanonicalFailureCategory;
  outcome: string | null;
  endReason: string | null;
  events: Array<EventRow & { occurredAtMs: number }>;
  toolErrorsCount: number;
}): CanonicalFailureCategory {
  if (args.existing !== "unknown") return args.existing;

  const hasEventType = (prefix: string): boolean =>
    args.events.some((eventRow) => eventRow.event_type.toLowerCase().startsWith(prefix));

  if (args.toolErrorsCount > 0) return "tool_error";
  if (args.endReason === "quota_denied") return "quota_error";

  if (args.outcome === "failed") {
    if (hasEventType("carrier_")) return "carrier_error";
    if (hasEventType("stt_")) return "stt_error";
    if (hasEventType("tts_")) return "tts_error";
    if (hasEventType("llm_")) return "llm_error";
    if (hasEventType("auth_")) return "auth_error";
  }

  if (args.endReason === "timeout") return "stt_error";
  if (args.endReason === "error" && args.outcome === "failed") return "config_error";

  if (args.outcome === "failed") {
    return "config_error";
  }

  return "unknown";
}

function inferActionClassFromContext(args: {
  existing: CanonicalActionClass;
  failureCategory: CanonicalFailureCategory;
  outcome: string | null;
  endReason: string | null;
  transferRequested: boolean;
  silenceRisk: boolean;
}): CanonicalActionClass {
  if (args.existing !== "no_action" && args.existing !== "review_required") {
    return args.existing;
  }

  if (args.transferRequested || args.outcome === "transferred" || args.endReason === "transfer") {
    return "escalate_human";
  }
  if (
    args.failureCategory === "tool_error" ||
    args.failureCategory === "config_error" ||
    args.failureCategory === "llm_error" ||
    args.failureCategory === "stt_error" ||
    args.failureCategory === "tts_error"
  ) {
    return "engineering_investigate";
  }
  if (
    args.failureCategory === "carrier_error" ||
    args.failureCategory === "auth_error" ||
    args.failureCategory === "quota_error"
  ) {
    return "review_required";
  }
  if (args.silenceRisk || args.outcome === "abandoned") {
    return "followup_required";
  }
  if (args.outcome === "failed") {
    return "review_required";
  }
  return args.existing;
}

function buildRecommendations(args: {
  actionClass: CanonicalActionClass;
  failureCategory: CanonicalFailureCategory;
  followupNeeded: boolean;
}): Array<{ action: string; reason: string; priority: "low" | "medium" | "high" }> {
  const out: Array<{ action: string; reason: string; priority: "low" | "medium" | "high" }> = [];

  if (args.failureCategory !== "unknown") {
    out.push({
      action: "Review failure path",
      reason: `Failure category detected: ${args.failureCategory}`,
      priority: args.actionClass === "engineering_investigate" ? "high" : "medium",
    });
  }

  if (args.actionClass === "followup_required" || args.followupNeeded) {
    out.push({
      action: "Create follow-up task",
      reason: "Call requires follow-up based on resolution state and action class",
      priority: "high",
    });
  }

  if (args.actionClass === "escalate_human") {
    out.push({
      action: "Escalate to human supervisor",
      reason: "Escalation class indicates immediate human attention",
      priority: "high",
    });
  }

  if (out.length === 0) {
    out.push({
      action: "No immediate action",
      reason: "Operational and semantic signals indicate stable completion",
      priority: "low",
    });
  }

  return out;
}

function toHumanLabel(input: string): string {
  return input
    .split("_")
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
    .join(" ");
}

function deriveCallerGoal(transcriptLines: ResolvedTranscript[]): string {
  const userLines = transcriptLines.filter((line) => line.speaker === "user");
  for (const line of userLines) {
    const cleaned = line.text
      .trim()
      .replace(/^(hi|hello|hey|good\s+(morning|afternoon|evening))[\s,!.:-]*/i, "")
      .replace(/^(i\s+(need|want|am|was|have|had|can|could|would)\b)/i, "$1")
      .trim();
    if (cleaned.split(/\s+/).length >= 4) {
      return cleaned.slice(0, 240);
    }
  }
  return userLines[0]?.text.slice(0, 240) ?? "";
}

function topicConfidenceFromSignals(args: {
  transcriptWordCount: number;
  callerUtteranceCount: number;
  intentSignalScore: number;
  hasDeterministicContext: boolean;
  fallbackIntentConfidence: number;
  evidenceScore: number;
}): number {
  let confidence =
    args.intentSignalScore >= 5
      ? 0.88
      : args.intentSignalScore >= 3
        ? 0.78
        : args.intentSignalScore >= 1
          ? 0.68
          : Math.max(0.35, args.fallbackIntentConfidence - 0.10);

  if (args.callerUtteranceCount >= 2) confidence += 0.05;
  if (args.callerUtteranceCount === 0) confidence -= 0.08;
  if (args.hasDeterministicContext) confidence += 0.03;
  if (args.transcriptWordCount < 8) confidence -= 0.1;
  if (args.transcriptWordCount < 4) confidence -= 0.15;

  confidence = confidence * 0.7 + args.evidenceScore * 0.3;
  return Math.max(0, Math.min(1, confidence));
}

function scoreEvidenceQuality(args: {
  transcriptWordCount: number;
  callerUtteranceCount: number;
  resolvedTranscriptCount: number;
  eventCount: number;
  toolEventsCount: number;
  intentSignalScore: number;
}): EvidenceQuality {
  let score = 0;

  if (args.callerUtteranceCount >= 2) score += 0.30;
  else if (args.callerUtteranceCount === 1) score += 0.16;

  if (args.transcriptWordCount >= 24) score += 0.24;
  else if (args.transcriptWordCount >= 12) score += 0.16;
  else if (args.transcriptWordCount >= 6) score += 0.08;

  if (args.eventCount >= 4) score += 0.16;
  else if (args.eventCount >= 2) score += 0.10;
  else if (args.eventCount >= 1) score += 0.05;

  if (args.toolEventsCount > 0) score += 0.08;
  if (args.resolvedTranscriptCount >= 4) score += 0.08;
  if (args.intentSignalScore >= 4) score += 0.10;
  else if (args.intentSignalScore >= 2) score += 0.06;
  else if (args.intentSignalScore >= 1) score += 0.03;

  const normalized = Math.max(0, Math.min(1, score));
  const grade: EvidenceQuality["grade"] =
    normalized >= EVIDENCE_STRONG_FLOOR ? "strong" : normalized >= EVIDENCE_MODERATE_FLOOR ? "moderate" : "weak";
  return { score: normalized, grade };
}

function isCriticalOperationalContext(args: {
  failureCategory: CanonicalFailureCategory;
  actionClass: CanonicalActionClass;
  outcome: string | null;
  endReason: string | null;
  transferRequested: boolean;
}): boolean {
  if (args.failureCategory !== "unknown") return true;
  if (args.transferRequested) return true;
  if (args.actionClass === "engineering_investigate" || args.actionClass === "escalate_human") return true;
  if (args.outcome === "failed" || args.outcome === "abandoned" || args.outcome === "transferred") return true;
  if (args.endReason === "error" || args.endReason === "timeout" || args.endReason === "transfer" || args.endReason === "quota_denied") {
    return true;
  }
  return false;
}

function deriveDeterministicContextTopic(args: {
  intent: CanonicalIntentCategory;
  direction: string | null;
  failureCategory: CanonicalFailureCategory;
  actionClass: CanonicalActionClass;
  outcome: string | null;
  endReason: string | null;
  transferRequested: boolean;
}): string | null {
  const directionWord = args.direction === "outbound" ? "Outbound" : "Inbound";
  const intentPhrase = deriveIntentTopicPhrase(args.intent);
  const baseTopic = intentPhrase ?? `${directionWord} Call`;

  if (args.failureCategory === "tool_error") return `${baseTopic} - Tool Failure`;
  if (args.failureCategory === "auth_error") return `${baseTopic} - Authentication Blocked`;
  if (args.failureCategory === "quota_error" || args.endReason === "quota_denied") {
    return `${baseTopic} - Quota Limit Reached`;
  }
  if (args.failureCategory === "carrier_error") return `${baseTopic} - Carrier Disconnect`;
  if (args.failureCategory === "stt_error") return `${baseTopic} - Speech Recognition Failure`;
  if (args.failureCategory === "tts_error") return `${baseTopic} - Voice Response Failure`;
  if (args.failureCategory === "llm_error") return `${baseTopic} - AI Response Failure`;
  if (args.failureCategory === "config_error") return `${baseTopic} - Configuration Failure`;

  if (args.transferRequested || args.actionClass === "escalate_human" || args.endReason === "transfer") {
    return `${baseTopic} - Transferred to Human`;
  }
  if ((args.outcome === "abandoned" || args.endReason === "caller_hangup") && args.outcome !== "handled") {
    return `${baseTopic} - Caller Disconnected`;
  }
  if (args.outcome === "failed") {
    return `${baseTopic} - Unresolved Failure`;
  }
  if (args.actionClass === "followup_required") {
    return `${baseTopic} - Follow-up Needed`;
  }
  return intentPhrase;
}

function deriveSemanticTopic(args: {
  primaryIntent: CanonicalIntentCategory;
  transcriptText: string;
  callerGoal: string;
  resolutionState: "resolved" | "partially_resolved" | "unresolved" | "unknown";
}): string | null {
  const subtopic = deriveSemanticSubtopic(args.primaryIntent, args.transcriptText);
  const intentPhrase = deriveIntentTopicPhrase(args.primaryIntent);

  if (subtopic) {
    if (subtopic === "Support Request" || subtopic === "Sales Inquiry" || subtopic === "Billing Question") {
      return subtopic;
    }
    return subtopic;
  }

  if (intentPhrase && args.callerGoal.length > 0) {
    const goalLower = args.callerGoal.toLowerCase();
    if (goalLower.includes("reschedule") && args.primaryIntent === "Booking") return "Appointment Rescheduling";
    if (goalLower.includes("cancel") && args.primaryIntent === "Booking") return "Appointment Cancellation";
    if (goalLower.includes("refund") && args.primaryIntent === "Billing") return "Refund Request";
    if (goalLower.includes("price") && args.primaryIntent === "Sales") return "Pricing Inquiry";
    if (goalLower.includes("not working") && args.primaryIntent === "Support") return "Technical Support Issue";
  }

  if (args.resolutionState === "resolved" && intentPhrase) return intentPhrase;
  return intentPhrase;
}

function deriveResolutionLabel(resolutionState: "resolved" | "partially_resolved" | "unresolved" | "unknown"): string {
  if (resolutionState === "resolved") return "Resolved";
  if (resolutionState === "partially_resolved") return "Partially Resolved";
  if (resolutionState === "unresolved") return "Unresolved";
  return "Unknown";
}

function deriveNextStepLabel(actionClass: CanonicalActionClass): string {
  if (actionClass === "engineering_investigate") return "Engineering Investigation";
  if (actionClass === "escalate_human") return "Escalate to Human";
  if (actionClass === "followup_required") return "Follow-up Required";
  if (actionClass === "review_required") return "Manual Review";
  return "No Action";
}

function deriveRiskLabel(riskLevel: "low" | "medium" | "high"): "Low" | "Medium" | "High" {
  if (riskLevel === "high") return "High";
  if (riskLevel === "medium") return "Medium";
  return "Low";
}

function selectTopicForDisplay(args: {
  semanticTopic: string | null;
  semanticConfidence: number;
  deterministicTopic: string | null;
  phase: "final" | "pending_context" | "provisional" | "failed";
  hasInsufficientEvidence: boolean;
  evidenceScore: number;
  evidenceGrade: EvidenceQuality["grade"];
  criticalOperationalContext: boolean;
  resolutionLabel: string;
  nextStepLabel: string;
  riskLabel: "Low" | "Medium" | "High";
  failureCategory: CanonicalFailureCategory;
  actionClass: CanonicalActionClass;
}): TopicSelection {
  if (args.phase === "pending_context") {
    return {
      topic: "Pending Analysis",
      source: "fallback",
      state: "pending_analysis",
      confidence: null,
      summary: "Pending analysis: waiting for transcript and event context.",
      shortReason: "Awaiting final transcript/event context",
    };
  }

  const deterministicUsable = !!args.deterministicTopic && !isGenericTopic(args.deterministicTopic);
  const semanticUsable = !!args.semanticTopic && !isGenericTopic(args.semanticTopic);

  if (args.phase === "failed") {
    if (deterministicUsable) {
      return {
        topic: args.deterministicTopic!,
        source: "deterministic_context",
        state: "classification_failed",
        confidence: null,
        summary: `${args.deterministicTopic}. ${args.resolutionLabel}. ${args.nextStepLabel}.`,
        shortReason: "Classification failed; deterministic topic retained",
      };
    }
    return {
      topic: "Classification Failed",
      source: "fallback",
      state: "classification_failed",
      confidence: null,
      summary: "Classification failed and no trustworthy topic was available.",
      shortReason: "No deterministic topic candidate available",
    };
  }

  if (args.criticalOperationalContext && deterministicUsable) {
    return {
      topic: args.deterministicTopic!,
      source: "deterministic_context",
      state: "final",
      confidence: Math.max(0.72, Math.min(0.92, args.semanticConfidence)),
      summary: `${args.deterministicTopic}. ${args.resolutionLabel}. ${args.nextStepLabel}.`,
      shortReason:
        args.failureCategory !== "unknown"
          ? `Operational context: ${toHumanLabel(args.failureCategory)}`
          : `${args.riskLabel} operational risk`,
    };
  }

  if (
    semanticUsable &&
    args.semanticConfidence >= TOPIC_FINAL_CONFIDENCE_MIN &&
    args.evidenceScore >= EVIDENCE_MODERATE_FLOOR
  ) {
    return {
      topic: args.semanticTopic!,
      source: "semantic_transcript",
      state: "final",
      confidence: args.semanticConfidence,
      summary: `${args.semanticTopic}. ${args.resolutionLabel}. ${args.nextStepLabel}.`,
      shortReason:
        args.failureCategory !== "unknown"
          ? `Impacted by ${toHumanLabel(args.failureCategory)}`
          : args.actionClass !== "no_action"
            ? `${toHumanLabel(args.actionClass)} recommended`
            : `${args.riskLabel} operational risk`,
    };
  }

  if (deterministicUsable) {
    return {
      topic: args.deterministicTopic!,
      source: "deterministic_context",
      state: "final",
      confidence: semanticUsable ? Math.max(0.62, Math.min(0.79, args.semanticConfidence)) : 0.68,
      summary: `${args.deterministicTopic}. ${args.resolutionLabel}. ${args.nextStepLabel}.`,
      shortReason:
        args.failureCategory !== "unknown"
          ? `Derived from ${toHumanLabel(args.failureCategory)} context`
          : args.evidenceGrade === "weak"
            ? "Deterministic topic selected due to weak semantic evidence"
            : `${args.riskLabel} operational risk`,
    };
  }

  const intentLikeUsable =
    semanticUsable &&
    args.semanticConfidence >= TOPIC_PROVISIONAL_CONFIDENCE_MIN &&
    args.evidenceScore >= Math.max(0.30, EVIDENCE_MODERATE_FLOOR - 0.15);
  if (intentLikeUsable) {
    return {
      topic: args.semanticTopic!,
      source: "intent_context",
      state: "provisional",
      confidence: args.semanticConfidence,
      summary: `${args.semanticTopic}. ${args.resolutionLabel}. ${args.nextStepLabel}.`,
      shortReason: "Provisional topic from limited transcript evidence",
    };
  }

  if (args.hasInsufficientEvidence || args.evidenceGrade === "weak") {
    return {
      topic: "Insufficient Evidence",
      source: "fallback",
      state: "insufficient_evidence",
      confidence: null,
      summary: "Insufficient evidence for a trustworthy call topic.",
      shortReason: "Transcript/context evidence was too limited",
      warning: warning(
        "context_incomplete",
        "display.topic",
        `insufficient evidence to derive specific call topic (score=${args.evidenceScore.toFixed(2)})`,
        "warn",
      ),
    };
  }

  return {
    topic: "Unknown",
    source: "fallback",
    state: "true_unknown",
    confidence: null,
    summary: "Call topic could not be determined from available signals.",
    shortReason: "No trustworthy topic candidate was available",
  };
}

function boundedText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const out = value.trim();
  if (!out) return undefined;
  return out.slice(0, max);
}

function boundedConfidence(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return undefined;
  const num = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(num)) return null;
  if (num < 0 || num > 1) return null;
  return num;
}

function toInterpreterOutput(raw: unknown): InterpreterOutput | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const topicState =
    input.topicState === "final" ||
    input.topicState === "provisional" ||
    input.topicState === "pending_analysis" ||
    input.topicState === "insufficient_evidence" ||
    input.topicState === "classification_failed" ||
    input.topicState === "true_unknown"
      ? input.topicState
      : undefined;
  const resolutionState =
    input.resolutionState === "resolved" ||
    input.resolutionState === "partially_resolved" ||
    input.resolutionState === "unresolved" ||
    input.resolutionState === "unknown"
      ? input.resolutionState
      : undefined;
  const failureCategory = toFailureCategory(typeof input.failureCategory === "string" ? input.failureCategory : null);
  const actionClass = toActionClass(typeof input.actionClass === "string" ? input.actionClass : null);
  const riskLevel =
    input.riskLevel === "low" || input.riskLevel === "medium" || input.riskLevel === "high"
      ? input.riskLevel
      : undefined;
  const followupNeeded = typeof input.followupNeeded === "boolean" ? input.followupNeeded : undefined;
  const confidenceRaw = input.confidence && typeof input.confidence === "object"
    ? (input.confidence as Record<string, unknown>)
    : undefined;

  return {
    topic: boundedText(input.topic, 240),
    topicConfidence: boundedConfidence(input.topicConfidence),
    topicState,
    resolutionState,
    failureCategory,
    actionClass,
    riskLevel,
    followupNeeded,
    shortReason: boundedText(input.shortReason, 180),
    summary: boundedText(input.summary, 320),
    confidence: confidenceRaw
      ? {
          primaryIntent: boundedConfidence(confidenceRaw.primaryIntent),
          resolutionState: boundedConfidence(confidenceRaw.resolutionState),
          failureCategory: boundedConfidence(confidenceRaw.failureCategory),
          actionClass: boundedConfidence(confidenceRaw.actionClass),
          recommendations: boundedConfidence(confidenceRaw.recommendations),
        }
      : undefined,
  };
}

async function runInterpreterStage(args: {
  callId: string;
  orgId: string;
  transcriptCombined: string;
  callerGoal: string;
  primaryIntent: CanonicalIntentCategory;
  secondaryIntents: CanonicalIntentCategory[];
  outcome: string | null;
  endReason: string | null;
  failureCategory: CanonicalFailureCategory;
  actionClass: CanonicalActionClass;
  riskLevel: "low" | "medium" | "high";
  followupNeeded: boolean;
  evidence: Array<{ kind: "transcript" | "call_event"; note: string; snippet?: string }>;
  warnings: CallIntelligenceWarning[];
}): Promise<InterpreterOutput | null> {
  if (!INTERPRETER_ENABLED) return null;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    args.warnings.push(
      warning(
        "context_incomplete",
        "interpreter.openai_api_key",
        "INTEL_INTERPRETER_ENABLED=true but OPENAI_API_KEY is missing; using deterministic interpreter output",
        "warn",
      ),
    );
    return null;
  }

  const systemPrompt =
    "You are a strict call-intelligence interpreter. Return only JSON. Never override canonical terminal facts. " +
    "Prefer specific, business-readable call topics. Avoid generic labels like Unknown/Support/Billing/Sales unless evidence is insufficient.";

  const payload = {
    callId: args.callId,
    orgId: args.orgId,
    transcript: args.transcriptCombined.slice(0, 4000),
    callerGoal: args.callerGoal,
    deterministic: {
      primaryIntent: args.primaryIntent,
      secondaryIntents: args.secondaryIntents,
      outcome: args.outcome,
      endReason: args.endReason,
      failureCategory: args.failureCategory,
      actionClass: args.actionClass,
      riskLevel: args.riskLevel,
      followupNeeded: args.followupNeeded,
    },
    evidence: args.evidence.slice(0, INTERPRETER_MAX_TURNS),
  };

  try {
    const response = await fetch(`${INTERPRETER_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: INTERPRETER_MODEL,
        temperature: 0.1,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(payload) },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      args.warnings.push(
        warning(
          "context_incomplete",
          "interpreter.http",
          `interpreter HTTP ${response.status}; deterministic fallback used (${body.slice(0, 140)})`,
          "warn",
        ),
      );
      return null;
    }

    const data = (await response.json()) as Record<string, unknown>;
    const content = ((data.choices as Array<any> | undefined)?.[0]?.message?.content ?? "") as string;
    if (!content || content.trim().length === 0) {
      args.warnings.push(
        warning("context_incomplete", "interpreter.content", "interpreter returned empty content", "warn"),
      );
      return null;
    }
    const parsed = JSON.parse(content) as unknown;
    const normalized = toInterpreterOutput(parsed);
    if (!normalized) {
      args.warnings.push(
        warning("context_incomplete", "interpreter.schema", "interpreter output is not a JSON object", "warn"),
      );
      return null;
    }
    return normalized;
  } catch (error) {
    args.warnings.push(
      warning(
        "context_incomplete",
        "interpreter.exception",
        `interpreter call failed: ${error instanceof Error ? error.message : String(error)}`,
        "warn",
      ),
    );
    return null;
  }
}

async function publishIntelligence(args: {
  callId: string;
  orgId: string;
  source: "rules" | "hybrid_llm";
  phase: "provisional" | "pending_context" | "final" | "failed";
  interpreterMode: "shadow" | "active";
  interpreterEnabled: boolean;
  payload: Record<string, unknown>;
  warnings: CallIntelligenceWarning[];
}): Promise<void> {
  const token =
    process.env.INTERNAL_SERVICE_TOKEN ??
    process.env.PLATFORM_API_INTERNAL_TOKEN ??
    DEFAULT_LOCAL_INTERNAL_TOKEN;
  const platformApiUrl = process.env.PLATFORM_API_URL ?? DEFAULT_PLATFORM_API_URL;

  let lastError: string | null = null;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${platformApiUrl}/calls/intelligence/enrich`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          callId: args.callId,
          orgId: args.orgId,
          source: args.source,
          model: modelVersion,
          author: "jobs.callIntelligenceWorker",
          phase: args.phase,
          interpreterMode: args.interpreterMode,
          interpreterEnabled: args.interpreterEnabled,
          enrichmentRevision: buildRevision(),
          intelligence: args.payload,
          warnings: args.warnings,
        }),
      });

      if (response.ok) return;
      const body = await response.text().catch(() => "");
      lastError = `platform intelligence upsert failed ${response.status}: ${body.slice(0, 300)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (attempt < maxAttempts) {
      await sleep(400 * attempt);
    }
  }

  throw new Error(lastError ?? "platform intelligence upsert failed");
}

async function runEnrichment(
  event: TypedEventEnvelope<"CallEnded">,
  attempt: number,
): Promise<void> {
  const callId = event.call_id;
  if (!callId) return;

  const orgId = event.org_id;
  const enrichmentStartMs = Date.now();
  const warnings: CallIntelligenceWarning[] = [];

  const { call, transcripts, events } = await loadContext(callId, orgId);
  if (!call) {
    logger.warn("call not found for intelligence enrichment", { callId, orgId });
    return;
  }

  const orderedEvents = dedupeAndSortEvents(events, warnings);
  const resolvedTranscripts = resolveTranscriptTimestamps(transcripts, orderedEvents, warnings);
  const relevantEvents = cutoffEvents(orderedEvents, call.ended_at, enrichmentStartMs);

  const readiness = readinessState({
    call,
    resolvedTranscripts,
    enrichmentStartMs,
  });

  if (!readiness.ready) {
    if (attempt >= RETRY_MAX_ATTEMPTS) {
      warnings.push(
        warning(
          "context_incomplete",
          "readiness",
          `context incomplete after ${attempt} retries: ${readiness.reason ?? "unknown"}`,
          "warn",
        ),
      );

      await publishIntelligence({
        callId,
        orgId,
        source: "rules",
        phase: "pending_context",
        interpreterMode: INTERPRETER_MODE,
        interpreterEnabled: INTERPRETER_ENABLED,
        payload: {
          phase: "pending_context",
          decision: {
            primaryIntent: normalizeCanonicalIntentCategory(call.classified_intent ?? "Unknown"),
            secondaryIntents: [],
            callerGoal: "",
            followupNeeded: toActionClass(call.action_class) !== "no_action",
            followupReasonCode: "none",
            followupSlaClass: "low",
            followupRecommendedOwner: "agent",
            resolutionState: toResolutionState(call.outcome),
            failureCategory: toFailureCategory(call.failure_category),
            actionClass: toActionClass(call.action_class),
            riskLevel: "medium",
          },
          explanation: {
            rationale: "Context incomplete within wait window; deferred for review.",
            evidence: [],
          },
          recommendations: [
            {
              action: "Review call intelligence context",
              reason: "Transcript/events were incomplete during enrichment window",
              priority: "medium",
            },
          ],
          signals: {
            toolsUsedCount: relevantEvents.filter((eventRow) => eventRow.event_type === "tool_called").length,
            toolErrorsCount: relevantEvents.filter(
              (eventRow) =>
                eventRow.event_type === "tool_called" &&
                ["error", "failed"].includes(String(eventRow.payload?.result ?? "").toLowerCase()),
            ).length,
            transferRequested: relevantEvents.some((eventRow) =>
              ["transfer", "handoff_requested"].includes(eventRow.event_type),
            ),
            durationSec: call.duration_sec ?? undefined,
          },
          confidence: {
            primaryIntent: null,
            resolutionState: 0.5,
            failureCategory: 0.5,
            actionClass: 0.5,
            recommendations: 0.5,
          },
          display: {
            summary: "Call intelligence deferred (context incomplete)",
            shortReason: "Awaiting final transcript/event context",
            recommendedBadge: "pending_context",
            topic: "Pending Analysis",
            topicSource: "fallback",
            topicState: "pending_analysis",
            topicConfidence: null,
            resolutionLabel: deriveResolutionLabel(toResolutionState(call.outcome)),
            nextStepLabel: deriveNextStepLabel(toActionClass(call.action_class)),
            riskLabel: "Medium",
          },
        },
        warnings,
      });

      logger.warn("intelligence deferred after max retries", {
        callId,
        orgId,
        attempt,
        reason: readiness.reason,
      });
      return;
    }

    const delayMs = Math.min(30_000, RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1));
    const existing = pendingTimers.get(callId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      void runEnrichment(event, attempt + 1).catch((error) => {
        logger.warn("retry enrichment failed", {
          callId,
          orgId,
          attempt: attempt + 1,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, delayMs);
    pendingTimers.set(callId, timer);
    timer.unref?.();

    logger.info("call intelligence retry scheduled", {
      callId,
      orgId,
      attempt,
      delayMs,
      reason: readiness.reason,
    });
    return;
  }

  const transcriptCombined = resolvedTranscripts.map((line) => line.text).join(" ").trim();
  const callerUtterances = resolvedTranscripts
    .filter((line) => line.speaker === "user")
    .map((line) => line.text.trim())
    .filter((text) => text.length > 0);
  const transcriptWordCount = transcriptCombined.length > 0 ? transcriptCombined.split(/\s+/).filter(Boolean).length : 0;

  const intentInference = inferPrimaryIntentWithScore(transcriptCombined, call.classified_intent);
  const primaryIntent = intentInference.intent;
  const secondaryIntents = inferSecondaryIntents(transcriptCombined, primaryIntent);
  const existingFailureCategory = toFailureCategory(call.failure_category);
  const existingActionClass = toActionClass(call.action_class);
  const resolutionState = toResolutionState(call.outcome);

  const toolEvents = relevantEvents.filter((eventRow) => eventRow.event_type === "tool_called");
  const toolErrorsCount = toolEvents.filter(
    (eventRow) => ["error", "failed"].includes(String(eventRow.payload?.result ?? "").toLowerCase()),
  ).length;

  const transferRequested = relevantEvents.some((eventRow) =>
    ["transfer", "handoff_requested"].includes(eventRow.event_type),
  );

  const silenceRisk = relevantEvents.some((eventRow) => {
    const eventType = eventRow.event_type.toLowerCase();
    return eventType.includes("silence") || eventType.includes("timeout");
  });

  const failureCategory = inferFailureCategoryFromContext({
    existing: existingFailureCategory,
    outcome: call.outcome,
    endReason: call.end_reason,
    events: relevantEvents,
    toolErrorsCount,
  });
  const actionClass = inferActionClassFromContext({
    existing: existingActionClass,
    failureCategory,
    outcome: call.outcome,
    endReason: call.end_reason,
    transferRequested,
    silenceRisk,
  });

  const followupNeeded = actionClass !== "no_action" || resolutionState !== "resolved";
  const riskLevel =
    actionClass === "engineering_investigate" ||
    actionClass === "escalate_human" ||
    HIGH_RISK_FAILURE_CATEGORIES.has(failureCategory)
      ? "high"
      : failureCategory !== "unknown" || followupNeeded || toolErrorsCount > 0 || silenceRisk
        ? "medium"
        : "low";

  const callerGoal = deriveCallerGoal(resolvedTranscripts);

  const fallbackIntentConfidence =
    typeof call.intent_confidence === "number" && Number.isFinite(call.intent_confidence)
      ? Math.max(0, Math.min(1, call.intent_confidence))
      : Math.max(0, Math.min(1, toIntentConfidenceProxy(call.intent_confidence_band) + INTENT_REFINE_DELTA));

  const semanticTopic = deriveSemanticTopic({
    primaryIntent,
    transcriptText: transcriptCombined,
    callerGoal,
    resolutionState,
  });
  const deterministicTopic = deriveDeterministicContextTopic({
    intent: primaryIntent,
    direction: call.direction ?? null,
    failureCategory,
    actionClass,
    outcome: call.outcome,
    endReason: call.end_reason,
    transferRequested,
  });
  const evidenceQuality = scoreEvidenceQuality({
    transcriptWordCount,
    callerUtteranceCount: callerUtterances.length,
    resolvedTranscriptCount: resolvedTranscripts.length,
    eventCount: relevantEvents.length,
    toolEventsCount: toolEvents.length,
    intentSignalScore: intentInference.score,
  });
  const semanticConfidence = topicConfidenceFromSignals({
    transcriptWordCount,
    callerUtteranceCount: callerUtterances.length,
    intentSignalScore: intentInference.score,
    hasDeterministicContext: !!deterministicTopic,
    fallbackIntentConfidence,
    evidenceScore: evidenceQuality.score,
  });
  const resolutionLabel = deriveResolutionLabel(resolutionState);
  const nextStepLabel = deriveNextStepLabel(actionClass);
  const riskLabel = deriveRiskLabel(riskLevel);
  const hasInsufficientEvidence =
    evidenceQuality.grade === "weak" &&
    primaryIntent === "Unknown" &&
    deterministicTopic === null;
  const criticalOperationalContext = isCriticalOperationalContext({
    failureCategory,
    actionClass,
    outcome: call.outcome,
    endReason: call.end_reason,
    transferRequested,
  });
  const topicSelection = selectTopicForDisplay({
    semanticTopic,
    semanticConfidence,
    deterministicTopic,
    phase: "final",
    hasInsufficientEvidence,
    evidenceScore: evidenceQuality.score,
    evidenceGrade: evidenceQuality.grade,
    criticalOperationalContext,
    resolutionLabel,
    nextStepLabel,
    riskLabel,
    failureCategory,
    actionClass,
  });
  if (topicSelection.warning) {
    warnings.push(topicSelection.warning);
  }
  if (evidenceQuality.grade === "weak") {
    warnings.push(
      warning(
        "context_incomplete",
        "evidence.quality",
        `weak evidence quality for semantic classification (score=${evidenceQuality.score.toFixed(2)})`,
        "info",
      ),
    );
  }

  const recommendations = buildRecommendations({
    actionClass,
    failureCategory,
    followupNeeded,
  });

  const evidence = [
    ...resolvedTranscripts.slice(0, 4).map((line) => ({
      kind: "transcript" as const,
      note: `${line.speaker}: ${line.text.slice(0, 140)}`,
      snippet: line.text.slice(0, 220),
      timestampMs: line.timestampMs,
      sourceId: line.id,
    })),
    ...relevantEvents.slice(0, 4).map((eventRow) => ({
      kind: "call_event" as const,
      note: eventRow.event_type,
      snippet: JSON.stringify(eventRow.payload ?? {}).slice(0, 220),
      timestampMs: eventRow.occurredAtMs,
      sourceId: eventRow.id ?? undefined,
    })),
  ];

  const interpreterOutput = await runInterpreterStage({
    callId,
    orgId,
    transcriptCombined,
    callerGoal,
    primaryIntent,
    secondaryIntents,
    outcome: call.outcome,
    endReason: call.end_reason,
    failureCategory,
    actionClass,
    riskLevel,
    followupNeeded,
    evidence: evidence.map((entry) => ({
      kind: entry.kind,
      note: entry.note,
      snippet: entry.snippet,
    })),
    warnings,
  });

  const interpreterTopicUsable =
    !!interpreterOutput?.topic &&
    !isGenericTopic(interpreterOutput.topic) &&
    (interpreterOutput.topicState === undefined ||
      interpreterOutput.topicState === "final" ||
      interpreterOutput.topicState === "provisional");
  const interpreterConfidence =
    typeof interpreterOutput?.topicConfidence === "number" ? interpreterOutput.topicConfidence : null;
  const effectiveResolutionState = interpreterOutput?.resolutionState ?? resolutionState;
  const effectiveResolutionLabel = deriveResolutionLabel(effectiveResolutionState);

  const effectiveTopicSelection = (() => {
    if (!interpreterOutput || !interpreterTopicUsable) return topicSelection;
    if (interpreterConfidence !== null && interpreterConfidence < TOPIC_PROVISIONAL_CONFIDENCE_MIN) {
      warnings.push(
        warning(
          "invalid_confidence",
          "interpreter.topicConfidence",
          `interpreter topic confidence below minimum floor (${TOPIC_PROVISIONAL_CONFIDENCE_MIN})`,
          "info",
        ),
      );
      return topicSelection;
    }
    const topicState = interpreterOutput.topicState ?? "final";
    const source: CallIntelligenceTopicSource =
      topicState === "provisional" ? "intent_context" : "semantic_transcript";
    return {
      topic: interpreterOutput.topic!,
      source,
      state: topicState,
      confidence: interpreterConfidence,
      summary:
        interpreterOutput.summary ??
        `${interpreterOutput.topic}. ${effectiveResolutionLabel}. ${nextStepLabel}.`,
      shortReason:
        interpreterOutput.shortReason ??
        `Interpreter-selected topic (${INTERPRETER_MODE === "shadow" ? "shadow" : "active"} mode)`,
    } satisfies TopicSelection;
  })();

  const effectiveFailureCategory = interpreterOutput?.failureCategory ?? failureCategory;
  const effectiveActionClass = interpreterOutput?.actionClass ?? actionClass;
  const effectiveRiskLevel = interpreterOutput?.riskLevel ?? riskLevel;
  const effectiveFollowupNeeded =
    typeof interpreterOutput?.followupNeeded === "boolean" ? interpreterOutput.followupNeeded : followupNeeded;
  const effectiveRecommendations =
    interpreterOutput && interpreterOutput.followupNeeded !== undefined
      ? buildRecommendations({
          actionClass: effectiveActionClass,
          failureCategory: effectiveFailureCategory,
          followupNeeded: effectiveFollowupNeeded,
        })
      : recommendations;
  const effectiveNextStepLabel = deriveNextStepLabel(effectiveActionClass);
  const effectiveRiskLabel = deriveRiskLabel(effectiveRiskLevel);

  const payload: Record<string, unknown> = {
    phase: "final",
    decision: {
      primaryIntent,
      secondaryIntents,
      callerGoal,
      followupNeeded: effectiveFollowupNeeded,
      followupReasonCode:
        effectiveActionClass === "followup_required"
          ? "customer_request"
          : effectiveActionClass === "escalate_human"
            ? "handoff"
            : effectiveFailureCategory !== "unknown"
              ? "failure_recovery"
              : "none",
      followupSlaClass: effectiveRiskLevel === "high" ? "high" : "medium",
      followupRecommendedOwner:
        effectiveActionClass === "engineering_investigate"
          ? "engineering"
          : effectiveActionClass === "escalate_human"
            ? "human_supervisor"
            : "agent",
      resolutionState: effectiveResolutionState,
      failureCategory: effectiveFailureCategory,
      actionClass: effectiveActionClass,
      riskLevel: effectiveRiskLevel,
    },
    explanation: {
      rationale:
        effectiveRiskLevel === "high"
          ? "High-risk signals detected from terminal outcome, failure/action classes, or tool errors."
          : effectiveRiskLevel === "medium"
            ? "Moderate follow-up risk detected from action class, follow-up need, or event signals."
            : "Low-risk completion based on deterministic operational signals.",
      evidence,
    },
    recommendations: effectiveRecommendations,
    signals: {
      toolsUsedCount: toolEvents.length,
      toolErrorsCount,
      transferRequested,
      silenceRisk,
      evidenceScore: Number(evidenceQuality.score.toFixed(3)),
      evidenceGrade: evidenceQuality.grade,
      interpreterMode: INTERPRETER_MODE,
      interpreterEnabled: INTERPRETER_ENABLED,
      interpreterModel: INTERPRETER_ENABLED ? INTERPRETER_MODEL : undefined,
      interpreterTopicCandidate: interpreterOutput?.topic ?? undefined,
      interpreterTopicConfidence: interpreterOutput?.topicConfidence ?? undefined,
      tokenUsage: undefined,
      durationSec: call.duration_sec ?? undefined,
    },
    confidence: {
      primaryIntent:
        effectiveTopicSelection.confidence ??
        interpreterOutput?.confidence?.primaryIntent ??
        fallbackIntentConfidence,
      resolutionState:
        interpreterOutput?.confidence?.resolutionState ??
        (effectiveResolutionState === "unknown" ? 0.4 : 0.8),
      failureCategory:
        interpreterOutput?.confidence?.failureCategory ??
        (effectiveFailureCategory === "unknown" ? 0.5 : 0.85),
      actionClass:
        interpreterOutput?.confidence?.actionClass ??
        (effectiveActionClass === "no_action" ? 0.6 : 0.85),
      recommendations:
        interpreterOutput?.confidence?.recommendations ??
        (effectiveRecommendations.length > 0 ? 0.75 : 0.5),
    },
    display: {
      summary: effectiveTopicSelection.summary,
      shortReason: effectiveTopicSelection.shortReason,
      recommendedBadge: effectiveRiskLevel === "high" ? "review" : effectiveFollowupNeeded ? "followup" : "ok",
      topic: effectiveTopicSelection.topic,
      topicSource: effectiveTopicSelection.source,
      topicState: effectiveTopicSelection.state,
      topicConfidence: effectiveTopicSelection.confidence,
      resolutionLabel: effectiveResolutionLabel,
      nextStepLabel: effectiveNextStepLabel,
      riskLabel: effectiveRiskLabel,
    },
  };

  await publishIntelligence({
    callId,
    orgId,
    source: interpreterOutput ? "hybrid_llm" : "rules",
    phase: "final",
    interpreterMode: INTERPRETER_MODE,
    interpreterEnabled: INTERPRETER_ENABLED,
    payload,
    warnings,
  });

  logger.info("call intelligence enrichment applied", {
    callId,
    orgId,
    revision: ENRICHMENT_REVISION,
    riskLevel,
    warnings: warnings.length,
  });
}

async function runBackfillForMissingIntelligence(): Promise<void> {
  if (BACKFILL_LIMIT <= 0) return;

  const result = await getPool().query<{
    call_id: string;
    org_id: string;
    ended_at: string | null;
  }>(
    `SELECT call_id, org_id, ended_at::text
     FROM calls
     WHERE ended_at IS NOT NULL
       AND classification_v2 IS NULL
       AND ended_at >= now() - ($2::int * interval '1 day')
     ORDER BY ended_at DESC
     LIMIT $1`,
    [BACKFILL_LIMIT, Math.max(1, BACKFILL_DAYS)],
  );

  if (result.rows.length === 0) {
    logger.info("call intelligence backfill skipped", { reason: "no missing rows" });
    return;
  }

  logger.info("call intelligence backfill started", { count: result.rows.length });
  let processed = 0;
  let failed = 0;

  for (const row of result.rows) {
    const pseudoEvent: TypedEventEnvelope<"CallEnded"> = {
      event_id: `backfill:${row.call_id}`,
      event_type: "CallEnded",
      org_id: row.org_id,
      call_id: row.call_id,
      timestamp: row.ended_at ?? new Date().toISOString(),
      payload: {
        did: "",
        businessId: "",
        routeType: "ai",
        startedAt: row.ended_at ?? new Date().toISOString(),
        endedAt: row.ended_at ?? new Date().toISOString(),
        durationMs: 0,
        endReason: "unknown",
        outcome: "unknown",
      },
    };

    try {
      await runEnrichment(pseudoEvent, RETRY_MAX_ATTEMPTS);
      processed += 1;
    } catch (error) {
      failed += 1;
      logger.warn("call intelligence backfill row failed", {
        callId: row.call_id,
        orgId: row.org_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info("call intelligence backfill finished", {
    total: result.rows.length,
    processed,
    failed,
  });
}

export async function registerCallIntelligenceWorker(bus: EventBusClient): Promise<() => Promise<void>> {
  logger.info("registering CallEnded intelligence worker", {
    revision: ENRICHMENT_REVISION,
    transcriptQuietMs: TRANSCRIPT_QUIET_MS,
    transcriptMaxWaitMs: TRANSCRIPT_MAX_WAIT_MS,
    eventGraceMs: EVENT_GRACE_MS,
    interpreterEnabled: INTERPRETER_ENABLED,
    interpreterMode: INTERPRETER_MODE,
    interpreterModel: INTERPRETER_MODEL,
    backfillDays: BACKFILL_DAYS,
  });

  const backfillTimer = setTimeout(() => {
    void runBackfillForMissingIntelligence().catch((error) => {
      logger.warn("call intelligence backfill failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, Math.max(0, BACKFILL_DELAY_MS));
  backfillTimer.unref?.();

  return bus.subscribe("CallEnded", async (event: TypedEventEnvelope<"CallEnded">) => {
    if (!event.call_id) {
      logger.warn("CallEnded event missing call_id");
      return;
    }

    try {
      await runEnrichment(event, 1);
    } catch (error) {
      logger.warn("call intelligence enrichment failed", {
        callId: event.call_id,
        orgId: event.org_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
