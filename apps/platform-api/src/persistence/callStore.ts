/**
 * callStore.ts — Direct Postgres persistence for calls, transcripts, events, phone numbers.
 * Replaces the old Supabase REST-based callStore.
 */

import { createLogger } from "@rezovo/logging";
import { query, withTransaction } from "./dbClient";

const logger = createLogger({ service: "platform-api", module: "callStore" });

// ─── Types ───

export interface CallRecord {
  callId: string;
  tenantId: string;
  phoneNumber: string;
  callerNumber: string;
  twilioCallSid?: string;
  direction?: "inbound" | "outbound";
  classifiedIntent?: string;
  intentConfidence?: number;
  finalIntent?: string;
  agentConfigId?: string;
  agentConfigVer?: number;
  status: string;
  startedAt: string;
  answeredAt?: string;
  endedAt?: string;
  durationSec?: number;
  endReason?: string;
  outcome?: string;
  failureType?: string;
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
  tenantId: string;
  sequence: number;
  speaker: "user" | "agent";
  text: string;
  confidence?: number;
  spokenAt: string;
  durationMs?: number;
}

export interface CallEvent {
  callId: string;
  tenantId: string;
  eventType: string;
  payload?: Record<string, unknown>;
  occurredAt?: string;
}

export interface PhoneNumberRecord {
  id?: string;
  tenantId: string;
  phoneNumber: string;
  displayName?: string;
  twilioSid?: string;
  agentConfigId?: string;
  routeType: "ai" | "human" | "voicemail";
  lob: string;
  status: "active" | "inactive" | "suspended";
}

// ─── Store ───

export class CallStore {
  // ─── Calls ───

  async upsertCall(call: CallRecord): Promise<void> {
    try {
      await query(
        `INSERT INTO calls (
          call_id, tenant_id, phone_number, caller_number, twilio_call_sid,
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
          stt_seconds = COALESCE(EXCLUDED.stt_seconds, calls.stt_seconds)`,
        [
          call.callId, call.tenantId, call.phoneNumber, call.callerNumber,
          call.twilioCallSid ?? null, call.direction ?? "inbound",
          call.classifiedIntent ?? null, call.intentConfidence ?? null,
          call.finalIntent ?? null, call.agentConfigId ?? null,
          call.agentConfigVer ?? null, call.status,
          call.startedAt, call.answeredAt ?? null,
          call.endedAt ?? null, call.durationSec ?? null,
          call.endReason ?? null, call.outcome ?? null,
          call.failureType ?? null,
          JSON.stringify(call.slotsCollected ?? {}),
          call.summary ?? null, call.turnCount ?? 0,
          call.llmTokensIn ?? 0, call.llmTokensOut ?? 0, call.ttsChars ?? 0, call.sttSeconds ?? 0,
        ]
      );
    } catch (err) {
      logger.warn("failed to upsert call record", {
        error: (err as Error).message,
        callId: call.callId,
      });
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

  async getCallsByTenant(tenantId: string): Promise<CallRecord[]> {
    try {
      const result = await query(
        "SELECT * FROM calls WHERE tenant_id = $1 ORDER BY started_at DESC LIMIT 100",
        [tenantId]
      );
      return result.rows.map(this.mapCallRow);
    } catch (err) {
      logger.warn("failed to get calls for tenant", { error: (err as Error).message, tenantId });
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
            `INSERT INTO call_transcript (call_id, tenant_id, sequence, speaker, text, confidence, spoken_at, duration_ms)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (call_id, sequence) DO NOTHING`,
            [e.callId, e.tenantId, e.sequence, e.speaker, e.text, e.confidence ?? null, e.spokenAt, e.durationMs ?? null]
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

  async getTranscript(callId: string): Promise<TranscriptEntry[]> {
    try {
      const result = await query(
        "SELECT * FROM call_transcript WHERE call_id = $1 ORDER BY sequence",
        [callId]
      );
      return result.rows.map((row: any) => ({
        callId: row.call_id,
        tenantId: row.tenant_id,
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
        `INSERT INTO call_events (call_id, tenant_id, event_type, payload, occurred_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [event.callId, event.tenantId, event.eventType, JSON.stringify(event.payload ?? {}), event.occurredAt ?? new Date().toISOString()]
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

  async getPhoneNumbersByTenant(tenantId: string): Promise<PhoneNumberRecord[]> {
    try {
      const result = await query("SELECT * FROM phone_numbers WHERE tenant_id = $1", [tenantId]);
      return result.rows.map(this.mapPhoneRow);
    } catch (err) {
      logger.warn("failed to get phone numbers for tenant", { error: (err as Error).message, tenantId });
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
      tenantId: row.tenant_id,
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
      failureType: row.failure_type,
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
      tenantId: row.tenant_id,
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
