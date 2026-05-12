/**
 * callStore.ts — Direct Postgres persistence for calls, transcripts, events, phone numbers.
 * Replaces the old Supabase REST-based callStore.
 */

import { createLogger } from "@rezovo/logging";
import {
  deriveCanonicalActionClass,
  deriveCanonicalFailureCategory,
  isCanonicalTerminalStatus,
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
} from "@rezovo/core-types";
import { query, withTransaction } from "./dbClient";

const logger = createLogger({ service: "platform-api", module: "callStore" });

/**
 * Product rule: non-terminal calls with `started_at` older than this window are not "active"
 * (dashboard `activeNow`, concurrent quota). See `docs/plans/plan-b-api-ui-db-accuracy-usage-integrity.md` §11.
 */
export const STALE_IN_PROGRESS_CUTOFF_HOURS = 6;

// ─── Types ───

export interface CallRecord {
  callId: string;
  orgId: string;
  phoneNumber: string;
  callerNumber: string;
  twilioCallSid?: string;
  direction?: "inbound" | "outbound";
  classifiedIntent?: string;
  intentConfidence?: number;
  finalIntent?: string;
  agentConfigId?: string;
  agentConfigVer?: number;
  status: CanonicalCallStatus | string;
  startedAt: string;
  answeredAt?: string;
  endedAt?: string;
  durationSec?: number;
  endReason?: CanonicalEndReason | string;
  outcome?: CanonicalOutcome | string;
  terminalStatusSource?: "realtime" | "carrier" | "system" | "unknown";
  failureType?: string;
  failureCategory?: CanonicalFailureCategory | string;
  actionClass?: CanonicalActionClass | string;
  intentCategory?: CanonicalIntentCategory | string;
  intentSource?: CanonicalIntentSource | string;
  intentConfidenceBand?: CanonicalConfidenceBand | string;
  labelVersion?: number;
  slotsCollected?: Record<string, unknown>;
  summary?: string;
  turnCount?: number;
  llmTokensIn?: number;
  llmTokensOut?: number;
  ttsChars?: number;
  sttSeconds?: number;
}

export interface TranscriptEntry {
  callId: string;
  orgId: string;
  sequence: number;
  speaker: "user" | "agent";
  text: string;
  confidence?: number;
  spokenAt: string;
  durationMs?: number;
}

export interface CallEvent {
  callId: string;
  orgId: string;
  eventType: string;
  payload?: Record<string, unknown>;
  occurredAt?: string;
}

export interface PhoneNumberRecord {
  id?: string;
  orgId: string;
  phoneNumber: string;
  displayName?: string;
  twilioSid?: string;
  agentConfigId?: string;
  routeType: "ai" | "human" | "voicemail";
  lob: string;
  status: "active" | "inactive" | "suspended";
}

const TERMINAL_STATUS_SOURCE_VALUES = new Set(["realtime", "carrier", "system", "unknown"]);
const INTENT_SOURCE_VALUES = new Set(["model_classifier", "agent_inference", "human_override", "unknown"]);
const CONFIDENCE_BAND_VALUES = new Set(["high", "medium", "low", "unknown"]);
const FAILURE_CATEGORY_VALUES = new Set([
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
const ACTION_CLASS_VALUES = new Set([
  "no_action",
  "review_required",
  "followup_required",
  "escalate_human",
  "engineering_investigate",
]);

function normalizeTerminalStatusSource(
  value: string | undefined | null
): "realtime" | "carrier" | "system" | "unknown" {
  if (!value) return "unknown";
  return TERMINAL_STATUS_SOURCE_VALUES.has(value)
    ? (value as "realtime" | "carrier" | "system" | "unknown")
    : "unknown";
}

function normalizeIntentSource(value: string | undefined | null): CanonicalIntentSource {
  if (!value) return "unknown";
  return INTENT_SOURCE_VALUES.has(value) ? (value as CanonicalIntentSource) : "unknown";
}

function normalizeConfidenceBand(
  value: string | undefined | null,
  fallbackConfidence: number | undefined
): CanonicalConfidenceBand {
  if (value && CONFIDENCE_BAND_VALUES.has(value)) {
    return value as CanonicalConfidenceBand;
  }
  return toCanonicalConfidenceBand(fallbackConfidence);
}

function normalizeKnownEndReason(value: string | undefined | null): CanonicalEndReason | undefined {
  if (!value) return undefined;
  if (
    value === "caller_hangup" ||
    value === "agent_end" ||
    value === "transfer" ||
    value === "timeout" ||
    value === "error" ||
    value === "quota_denied" ||
    value === "unknown"
  ) {
    return value;
  }
  return undefined;
}

function inferTerminalEndReason(input: {
  status: CanonicalCallStatus | string;
  outcome?: CanonicalOutcome | string;
  endReason?: CanonicalEndReason | string;
  failureType?: string;
}): CanonicalEndReason | undefined {
  const existingReason = normalizeKnownEndReason(input.endReason ?? null);
  if (existingReason && existingReason !== "unknown") return existingReason;

  const failureToken = String(input.failureType ?? "").toLowerCase();
  const hasTimeoutLikeFailure =
    failureToken.includes("timeout") ||
    failureToken.includes("no-answer") ||
    failureToken.includes("no_answer") ||
    failureToken.includes("silence");

  if (input.status === "completed" || input.outcome === "handled") return "agent_end";
  if (input.status === "transferred" || input.outcome === "transferred") return "transfer";
  if (input.status === "abandoned" || input.outcome === "abandoned") {
    return hasTimeoutLikeFailure ? "timeout" : "caller_hangup";
  }
  if (input.status === "failed" || input.outcome === "failed") {
    if (failureToken.includes("quota")) return "quota_denied";
    if (hasTimeoutLikeFailure) return "timeout";
    return "error";
  }

  return existingReason;
}

export function normalizeCallRecordForPersistence(call: CallRecord): CallRecord {
  const terminalLikeStatus = isCanonicalTerminalStatus(call.status);
  const normalizedTerminalEndReason = terminalLikeStatus
    ? inferTerminalEndReason({
        status: call.status,
        outcome: call.outcome,
        endReason: call.endReason,
        failureType: call.failureType,
      })
    : undefined;
  const derivedFailureCategory = deriveCanonicalFailureCategory({
    outcome: call.outcome,
    failureType: call.failureType,
    endReason: normalizedTerminalEndReason ?? call.endReason,
  });
  const normalized: CallRecord = {
    ...call,
    terminalStatusSource: normalizeTerminalStatusSource(call.terminalStatusSource),
    intentSource: normalizeIntentSource(call.intentSource),
    intentCategory: normalizeCanonicalIntentCategory(call.classifiedIntent),
    intentConfidenceBand: normalizeConfidenceBand(call.intentConfidenceBand, call.intentConfidence),
    labelVersion: call.labelVersion ?? 1,
    failureCategory:
      call.failureCategory && FAILURE_CATEGORY_VALUES.has(call.failureCategory)
        ? (call.failureCategory as CanonicalFailureCategory)
        : terminalLikeStatus
          ? derivedFailureCategory
          : "unknown",
    actionClass:
      call.actionClass && ACTION_CLASS_VALUES.has(call.actionClass)
        ? (call.actionClass as CanonicalActionClass)
        : terminalLikeStatus
          ? deriveCanonicalActionClass({
              outcome:
                call.outcome === "handled" ||
                call.outcome === "failed" ||
                call.outcome === "abandoned" ||
                call.outcome === "transferred" ||
                call.outcome === "unknown"
                  ? call.outcome
                  : "unknown",
              endReason:
                normalizedTerminalEndReason === "caller_hangup" ||
                normalizedTerminalEndReason === "agent_end" ||
                normalizedTerminalEndReason === "transfer" ||
                normalizedTerminalEndReason === "timeout" ||
                normalizedTerminalEndReason === "error" ||
                normalizedTerminalEndReason === "quota_denied" ||
                normalizedTerminalEndReason === "unknown"
                  ? normalizedTerminalEndReason
                  : "unknown",
              failureCategory:
                call.failureCategory && FAILURE_CATEGORY_VALUES.has(call.failureCategory)
                  ? (call.failureCategory as CanonicalFailureCategory)
                  : derivedFailureCategory,
              intentCategory: normalizeCanonicalIntentCategory(call.classifiedIntent),
            })
          : "no_action",
  };

  if (terminalLikeStatus && normalizedTerminalEndReason) {
    normalized.endReason = normalizedTerminalEndReason;
  }

  if (isCanonicalTerminalStatus(normalized.status)) {
    const validated = validateCanonicalTerminalTuple({
      status: normalized.status,
      outcome: normalized.outcome,
      endReason: normalized.endReason,
    });
    if (!validated.valid) {
      throw new Error(validated.reason ?? "invalid terminal tuple");
    }
    normalized.status = validated.normalized.status;
    normalized.outcome = validated.normalized.outcome;
    normalized.endReason = validated.normalized.endReason;
    return normalized;
  }

  if (normalized.outcome || normalized.endReason) {
    throw new Error(
      `invalid non-terminal tuple: status=${String(normalized.status)} outcome=${String(
        normalized.outcome
      )} endReason=${String(normalized.endReason)}`
    );
  }

  return normalized;
}

// ─── Store ───

export class CallStore {
  // ─── Calls ───

  async upsertCall(call: CallRecord): Promise<boolean> {
    const normalized = normalizeCallRecordForPersistence(call);

    const runUpsertFlow = async (record: CallRecord): Promise<void> => {
      const baseParams = [
        record.callId, record.orgId, record.phoneNumber, record.callerNumber,
        record.twilioCallSid ?? null, record.direction ?? "inbound",
        record.classifiedIntent ?? null, record.intentConfidence ?? null,
        record.finalIntent ?? null, record.agentConfigId ?? null,
        record.agentConfigVer ?? null, record.status,
        record.startedAt, record.answeredAt ?? null,
        record.endedAt ?? null, record.durationSec ?? null,
        record.endReason ?? null, record.outcome ?? null,
        record.failureType ?? null,
        JSON.stringify(record.slotsCollected ?? {}),
        record.summary ?? null, record.turnCount ?? 0,
        record.llmTokensIn ?? 0, record.llmTokensOut ?? 0, record.ttsChars ?? 0, record.sttSeconds ?? 0,
        record.terminalStatusSource ?? "unknown",
        record.intentSource ?? "unknown",
        record.intentConfidenceBand ?? "unknown",
        record.labelVersion ?? 1,
      ];

      const upsertWithClassificationSql = `INSERT INTO calls (
        call_id, org_id, phone_number, caller_number, twilio_call_sid,
        direction, classified_intent, intent_confidence, final_intent,
        agent_config_id, agent_config_ver, status, started_at, answered_at,
        ended_at, duration_sec, end_reason, outcome, failure_type, slots_collected,
        summary, turn_count, llm_tokens_in, llm_tokens_out, tts_chars, stt_seconds,
        terminal_status_source, intent_source, intent_confidence_band, label_version,
        failure_category, action_class
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)
      ON CONFLICT (call_id) DO UPDATE SET
        status = EXCLUDED.status,
        classified_intent = COALESCE(EXCLUDED.classified_intent, calls.classified_intent),
        intent_confidence = COALESCE(EXCLUDED.intent_confidence, calls.intent_confidence),
        final_intent = COALESCE(EXCLUDED.final_intent, calls.final_intent),
        agent_config_id = COALESCE(EXCLUDED.agent_config_id, calls.agent_config_id),
        agent_config_ver = COALESCE(EXCLUDED.agent_config_ver, calls.agent_config_ver),
        answered_at = COALESCE(EXCLUDED.answered_at, calls.answered_at),
        ended_at = COALESCE(EXCLUDED.ended_at, calls.ended_at),
        duration_sec = COALESCE(EXCLUDED.duration_sec, calls.duration_sec),
        end_reason = COALESCE(EXCLUDED.end_reason, calls.end_reason),
        outcome = COALESCE(EXCLUDED.outcome, calls.outcome),
        failure_type = COALESCE(EXCLUDED.failure_type, calls.failure_type),
        slots_collected = COALESCE(EXCLUDED.slots_collected, calls.slots_collected),
        summary = COALESCE(EXCLUDED.summary, calls.summary),
        turn_count = COALESCE(EXCLUDED.turn_count, calls.turn_count),
        llm_tokens_in = COALESCE(EXCLUDED.llm_tokens_in, calls.llm_tokens_in),
        llm_tokens_out = COALESCE(EXCLUDED.llm_tokens_out, calls.llm_tokens_out),
        tts_chars = COALESCE(EXCLUDED.tts_chars, calls.tts_chars),
        stt_seconds = COALESCE(EXCLUDED.stt_seconds, calls.stt_seconds),
        terminal_status_source = COALESCE(EXCLUDED.terminal_status_source, calls.terminal_status_source),
        intent_source = COALESCE(EXCLUDED.intent_source, calls.intent_source),
        intent_confidence_band = COALESCE(EXCLUDED.intent_confidence_band, calls.intent_confidence_band),
        label_version = COALESCE(EXCLUDED.label_version, calls.label_version),
        failure_category = COALESCE(EXCLUDED.failure_category, calls.failure_category),
        action_class = COALESCE(EXCLUDED.action_class, calls.action_class)`;

      const upsertLegacySql = `INSERT INTO calls (
        call_id, org_id, phone_number, caller_number, twilio_call_sid,
        direction, classified_intent, intent_confidence, final_intent,
        agent_config_id, agent_config_ver, status, started_at, answered_at,
        ended_at, duration_sec, end_reason, outcome, failure_type, slots_collected,
        summary, turn_count, llm_tokens_in, llm_tokens_out, tts_chars, stt_seconds,
        terminal_status_source, intent_source, intent_confidence_band, label_version
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)
      ON CONFLICT (call_id) DO UPDATE SET
        status = EXCLUDED.status,
        classified_intent = COALESCE(EXCLUDED.classified_intent, calls.classified_intent),
        intent_confidence = COALESCE(EXCLUDED.intent_confidence, calls.intent_confidence),
        final_intent = COALESCE(EXCLUDED.final_intent, calls.final_intent),
        agent_config_id = COALESCE(EXCLUDED.agent_config_id, calls.agent_config_id),
        agent_config_ver = COALESCE(EXCLUDED.agent_config_ver, calls.agent_config_ver),
        answered_at = COALESCE(EXCLUDED.answered_at, calls.answered_at),
        ended_at = COALESCE(EXCLUDED.ended_at, calls.ended_at),
        duration_sec = COALESCE(EXCLUDED.duration_sec, calls.duration_sec),
        end_reason = COALESCE(EXCLUDED.end_reason, calls.end_reason),
        outcome = COALESCE(EXCLUDED.outcome, calls.outcome),
        failure_type = COALESCE(EXCLUDED.failure_type, calls.failure_type),
        slots_collected = COALESCE(EXCLUDED.slots_collected, calls.slots_collected),
        summary = COALESCE(EXCLUDED.summary, calls.summary),
        turn_count = COALESCE(EXCLUDED.turn_count, calls.turn_count),
        llm_tokens_in = COALESCE(EXCLUDED.llm_tokens_in, calls.llm_tokens_in),
        llm_tokens_out = COALESCE(EXCLUDED.llm_tokens_out, calls.llm_tokens_out),
        tts_chars = COALESCE(EXCLUDED.tts_chars, calls.tts_chars),
        stt_seconds = COALESCE(EXCLUDED.stt_seconds, calls.stt_seconds),
        terminal_status_source = COALESCE(EXCLUDED.terminal_status_source, calls.terminal_status_source),
        intent_source = COALESCE(EXCLUDED.intent_source, calls.intent_source),
        intent_confidence_band = COALESCE(EXCLUDED.intent_confidence_band, calls.intent_confidence_band),
        label_version = COALESCE(EXCLUDED.label_version, calls.label_version)`;

      const upsertVeryLegacySql = `INSERT INTO calls (
        call_id, org_id, phone_number, caller_number, twilio_call_sid,
        direction, classified_intent, intent_confidence, final_intent,
        agent_config_id, agent_config_ver, status, started_at, answered_at,
        ended_at, duration_sec, end_reason, outcome, failure_type, slots_collected,
        summary, turn_count, llm_tokens_in, llm_tokens_out, tts_chars, stt_seconds
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
      ON CONFLICT (call_id) DO UPDATE SET
        status = EXCLUDED.status,
        classified_intent = COALESCE(EXCLUDED.classified_intent, calls.classified_intent),
        intent_confidence = COALESCE(EXCLUDED.intent_confidence, calls.intent_confidence),
        final_intent = COALESCE(EXCLUDED.final_intent, calls.final_intent),
        agent_config_id = COALESCE(EXCLUDED.agent_config_id, calls.agent_config_id),
        agent_config_ver = COALESCE(EXCLUDED.agent_config_ver, calls.agent_config_ver),
        answered_at = COALESCE(EXCLUDED.answered_at, calls.answered_at),
        ended_at = COALESCE(EXCLUDED.ended_at, calls.ended_at),
        duration_sec = COALESCE(EXCLUDED.duration_sec, calls.duration_sec),
        end_reason = COALESCE(EXCLUDED.end_reason, calls.end_reason),
        outcome = COALESCE(EXCLUDED.outcome, calls.outcome),
        failure_type = COALESCE(EXCLUDED.failure_type, calls.failure_type),
        slots_collected = COALESCE(EXCLUDED.slots_collected, calls.slots_collected),
        summary = COALESCE(EXCLUDED.summary, calls.summary),
        turn_count = COALESCE(EXCLUDED.turn_count, calls.turn_count),
        llm_tokens_in = COALESCE(EXCLUDED.llm_tokens_in, calls.llm_tokens_in),
        llm_tokens_out = COALESCE(EXCLUDED.llm_tokens_out, calls.llm_tokens_out),
        tts_chars = COALESCE(EXCLUDED.tts_chars, calls.tts_chars),
        stt_seconds = COALESCE(EXCLUDED.stt_seconds, calls.stt_seconds)`;

      try {
        await query(upsertWithClassificationSql, [
          ...baseParams,
          record.failureCategory ?? "unknown",
          record.actionClass ?? "no_action",
        ]);
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code === "42703") {
          logger.warn("classification columns missing; falling back to legacy call upsert", {
            callId: record.callId,
            orgId: record.orgId,
          });
          try {
            await query(upsertLegacySql, baseParams);
          } catch (legacyErr) {
            const legacyCode = (legacyErr as { code?: string })?.code;
            if (legacyCode !== "42703") throw legacyErr;
            logger.warn("canonical columns missing; falling back to very-legacy call upsert", {
              callId: record.callId,
              orgId: record.orgId,
            });
            await query(upsertVeryLegacySql, baseParams.slice(0, 26));
          }
          return;
        }
        throw err;
      }
    };

    try {
      await runUpsertFlow(normalized);
      return true;
    } catch (err) {
      const pgError = err as { code?: string; message?: string };
      if (pgError.code === "23514" && normalized.endReason === "normal_completion") {
        logger.warn("calls.end_reason constraint missing normal_completion; falling back to agent_end", {
          callId: normalized.callId,
          orgId: normalized.orgId,
        });
        try {
          await runUpsertFlow({ ...normalized, endReason: "agent_end" });
          return true;
        } catch (fallbackErr) {
          logger.warn("fallback call upsert failed", {
            error: (fallbackErr as Error).message,
            callId: normalized.callId,
            orgId: normalized.orgId,
          });
          logger.warn("failed to upsert call record", {
            error: (fallbackErr as Error).message,
            callId: normalized.callId,
            orgId: normalized.orgId,
          });
          throw fallbackErr;
        }
      }

      logger.warn("failed to upsert call record", {
        error: (err as Error).message,
        callId: normalized.callId,
        orgId: normalized.orgId,
      });
      throw err;
    }
  }

  async getCall(callId: string): Promise<CallRecord | null> {
    try {
      const result = await query("SELECT * FROM calls WHERE call_id = $1", [callId]);
      if (result.rows.length === 0) return null;
      return this.mapCallRow(result.rows[0]);
    } catch (err) {
      logger.warn("failed to get call", { error: (err as Error).message, callId });
      return null;
    }
  }

  async getCallByTwilioSid(callSid: string): Promise<CallRecord | null> {
    try {
      const result = await query("SELECT * FROM calls WHERE twilio_call_sid = $1 LIMIT 1", [callSid]);
      if (result.rows.length === 0) return null;
      return this.mapCallRow(result.rows[0]);
    } catch (err) {
      logger.warn("failed to get call by twilio sid", { error: (err as Error).message, callSid });
      return null;
    }
  }

  /**
   * Recent calls for list UIs. **Capped at 100 rows** (newest by `started_at` first).
   * Do not use `length` of this list for org-wide totals — use `GET /analytics/summary` instead.
   */
  async getCallsByOrganization(
    orgId: string,
    range?: { start: Date; end: Date }
  ): Promise<CallRecord[]> {
    try {
      const result = range
        ? await query(
            `SELECT * FROM calls
             WHERE org_id = $1 AND started_at >= $2 AND started_at <= $3
             ORDER BY started_at DESC LIMIT 100`,
            [orgId, range.start, range.end]
          )
        : await query(
            "SELECT * FROM calls WHERE org_id = $1 ORDER BY started_at DESC LIMIT 100",
            [orgId]
          );
      return result.rows.map(this.mapCallRow);
    } catch (err) {
      logger.warn("failed to get calls for organization", { error: (err as Error).message, orgId });
      return [];
    }
  }

  // ─── Transcript ───

  async insertTranscriptBatch(entries: TranscriptEntry[]): Promise<void> {
    if (entries.length === 0) return;
    try {
      await withTransaction(async (client) => {
        for (const e of entries) {
          await client.query(
            `INSERT INTO call_transcript (call_id, org_id, sequence, speaker, text, confidence, spoken_at, duration_ms)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (call_id, sequence) DO NOTHING`,
            [e.callId, e.orgId, e.sequence, e.speaker, e.text, e.confidence ?? null, e.spokenAt, e.durationMs ?? null]
          );
        }
      });
    } catch (err) {
      logger.warn("failed to insert transcript batch", {
        error: (err as Error).message,
        callId: entries[0]?.callId,
        count: entries.length,
      });
    }
  }

  /**
   * Live (non-stale) in-progress and ringing calls; used for dashboards and concurrent quota.
   */
  async countActiveLiveCalls(orgId: string): Promise<number> {
    try {
      const result = await query<{ c: string }>(
        `SELECT COUNT(*)::int AS c
         FROM calls
         WHERE org_id = $1
           AND status IN ('initiated', 'ringing', 'in_progress')
           AND started_at > now() - ($2::int * interval '1 hour')`,
        [orgId, STALE_IN_PROGRESS_CUTOFF_HOURS]
      );
      return Number(result.rows[0]?.c) || 0;
    } catch (err) {
      logger.warn("countActiveLiveCalls failed", { error: (err as Error).message, orgId });
      return 0;
    }
  }

  async getTranscript(callId: string, orgId: string): Promise<TranscriptEntry[]> {
    try {
      const result = await query(
        "SELECT * FROM call_transcript WHERE call_id = $1 AND org_id = $2 ORDER BY sequence",
        [callId, orgId]
      );
      return result.rows.map((row: any) => ({
        callId: row.call_id,
        orgId: row.org_id,
        sequence: row.sequence,
        speaker: row.speaker,
        text: row.text,
        confidence: row.confidence,
        spokenAt: row.spoken_at,
        durationMs: row.duration_ms,
      }));
    } catch (err) {
      logger.warn("failed to get transcript", { error: (err as Error).message, callId });
      return [];
    }
  }

  // ─── Call Events ───

  async insertEvent(event: CallEvent): Promise<void> {
    try {
      await query(
        `INSERT INTO call_events (call_id, org_id, event_type, payload, occurred_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [event.callId, event.orgId, event.eventType, JSON.stringify(event.payload ?? {}), event.occurredAt ?? new Date().toISOString()]
      );
    } catch (err) {
      logger.warn("failed to insert call event", {
        error: (err as Error).message,
        callId: event.callId,
        eventType: event.eventType,
      });
    }
  }

  // ─── Phone Numbers ───

  async getAllPhoneNumbers(): Promise<PhoneNumberRecord[]> {
    try {
      const result = await query("SELECT * FROM phone_numbers ORDER BY created_at");
      return result.rows.map(this.mapPhoneRow);
    } catch (err) {
      logger.warn("failed to get all phone numbers", { error: (err as Error).message });
      return [];
    }
  }

  async getPhoneNumbersByOrganization(orgId: string): Promise<PhoneNumberRecord[]> {
    try {
      const result = await query("SELECT * FROM phone_numbers WHERE org_id = $1", [orgId]);
      return result.rows.map(this.mapPhoneRow);
    } catch (err) {
      logger.warn("failed to get phone numbers for organization", { error: (err as Error).message, orgId });
      return [];
    }
  }

  async getPhoneNumber(phoneNumber: string): Promise<PhoneNumberRecord | null> {
    try {
      const result = await query("SELECT * FROM phone_numbers WHERE phone_number = $1", [phoneNumber]);
      if (result.rows.length === 0) return null;
      return this.mapPhoneRow(result.rows[0]);
    } catch (err) {
      logger.warn("failed to get phone number", { error: (err as Error).message, phoneNumber });
      return null;
    }
  }

  // ─── Row Mappers ───

  private mapCallRow(row: any): CallRecord {
    return {
      callId: row.call_id,
      orgId: row.org_id,
      phoneNumber: row.phone_number,
      callerNumber: row.caller_number,
      twilioCallSid: row.twilio_call_sid,
      direction: row.direction,
      classifiedIntent: row.classified_intent,
      intentConfidence: row.intent_confidence,
      finalIntent: row.final_intent,
      agentConfigId: row.agent_config_id,
      agentConfigVer: row.agent_config_ver,
      status: row.status,
      startedAt: row.started_at,
      answeredAt: row.answered_at,
      endedAt: row.ended_at,
      durationSec: row.duration_sec,
      endReason: row.end_reason,
      outcome: row.outcome,
      terminalStatusSource: row.terminal_status_source,
      failureType: row.failure_type,
      failureCategory: row.failure_category,
      actionClass: row.action_class,
      intentSource: row.intent_source,
      intentConfidenceBand: row.intent_confidence_band,
      labelVersion: row.label_version,
      slotsCollected: row.slots_collected,
      summary: row.summary,
      turnCount: row.turn_count,
      llmTokensIn: row.llm_tokens_in,
      llmTokensOut: row.llm_tokens_out,
      ttsChars: row.tts_chars,
      sttSeconds: row.stt_seconds,
    };
  }

  private mapPhoneRow(row: any): PhoneNumberRecord {
    return {
      id: row.id,
      orgId: row.org_id,
      phoneNumber: row.phone_number,
      displayName: row.display_name,
      twilioSid: row.twilio_sid,
      agentConfigId: row.agent_config_id,
      routeType: row.route_type,
      lob: row.lob,
      status: row.status,
    };
  }
}

/** Singleton */
export const callStore = new CallStore();
