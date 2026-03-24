/**
 * voiceStore.ts — Direct Postgres persistence for voice/carrier events.
 * Replaces the old Supabase REST-based voiceStore.
 *
 * Legacy tables (voice_numbers, call_sessions, carrier_events) are
 * still queried here for backward-compat during migration.
 * New code should prefer callStore + phone_numbers table.
 */

import { createLogger } from "@rezovo/logging";
import { query } from "./dbClient";

const logger = createLogger({ service: "platform-api", module: "voiceStore" });

export interface VoiceNumber {
  id?: string;
  tenantId: string;
  phoneNumber: string;
  phoneSid: string;
  sipDomain: string;
  secretId: string;
  webhookToken: string;
  status: "provisioned" | "active" | "suspended" | "released";
  createdAt?: string;
  updatedAt?: string;
}

export interface CarrierEvent {
  id?: string;
  tenantId: string;
  callSid: string;
  direction?: string;
  eventType: string;
  payload: Record<string, unknown>;
  receivedAt?: string;
}

export interface CallSession {
  id?: string;
  tenantId: string;
  callId: string;
  callSid: string;
  phoneNumber: string;
  callerNumber: string;
  status: string;
  startedAt?: string;
  endedAt?: string;
  endReason?: string;
}

export class VoiceStore {
  /**
   * Get ALL voice numbers (not filtered by tenant). Used for startup diagnostics.
   */
  async getAllVoiceNumbers(): Promise<VoiceNumber[]> {
    try {
      const result = await query("SELECT * FROM voice_numbers ORDER BY created_at");
      return result.rows.map(this.mapVoiceRow);
    } catch (error) {
      logger.error("failed to query all voice numbers", { error: (error as Error).message });
      return [];
    }
  }

  async upsertVoiceNumber(record: VoiceNumber): Promise<void> {
    try {
      await query(
        `INSERT INTO voice_numbers (tenant_id, phone_number, phone_sid, sip_domain, secret_id, webhook_token, status, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (phone_number) DO UPDATE SET
           tenant_id = EXCLUDED.tenant_id,
           phone_sid = EXCLUDED.phone_sid,
           sip_domain = EXCLUDED.sip_domain,
           secret_id = EXCLUDED.secret_id,
           webhook_token = EXCLUDED.webhook_token,
           status = EXCLUDED.status,
           updated_at = EXCLUDED.updated_at`,
        [record.tenantId, record.phoneNumber, record.phoneSid, record.sipDomain, record.secretId, record.webhookToken, record.status]
      );
    } catch (error) {
      logger.error("failed to upsert voice number", { error: (error as Error).message, phoneNumber: record.phoneNumber });
      throw error;
    }
  }

  async getVoiceNumberByPhone(phoneNumber: string): Promise<VoiceNumber | null> {
    try {
      const result = await query("SELECT * FROM voice_numbers WHERE phone_number = $1 LIMIT 1", [phoneNumber]);
      if (result.rows.length === 0) return null;
      return this.mapVoiceRow(result.rows[0]);
    } catch (error) {
      logger.error("failed to get voice number", { error: (error as Error).message, phoneNumber });
      throw error;
    }
  }

  async getVoiceNumbersByTenant(tenantId: string): Promise<VoiceNumber[]> {
    try {
      const result = await query("SELECT * FROM voice_numbers WHERE tenant_id = $1", [tenantId]);
      return result.rows.map(this.mapVoiceRow);
    } catch (error) {
      logger.error("failed to get voice numbers for tenant", { error: (error as Error).message, tenantId });
      throw error;
    }
  }

  async logCarrierEvent(event: CarrierEvent): Promise<void> {
    try {
      await query(
        `INSERT INTO carrier_events (tenant_id, call_sid, direction, event_type, payload)
         VALUES ($1, $2, $3, $4, $5)`,
        [event.tenantId, event.callSid, event.direction ?? null, event.eventType, JSON.stringify(event.payload)]
      );
    } catch (error) {
      // Non-critical — log and continue
      logger.warn("failed to log carrier event", { error: (error as Error).message, callSid: event.callSid });
    }
  }

  async upsertCallSession(session: CallSession): Promise<void> {
    try {
      await query(
        `INSERT INTO call_sessions (tenant_id, call_id, call_sid, phone_number, caller_number, status, started_at, ended_at, end_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (call_id) DO UPDATE SET
           status = EXCLUDED.status,
           ended_at = COALESCE(EXCLUDED.ended_at, call_sessions.ended_at),
           end_reason = COALESCE(EXCLUDED.end_reason, call_sessions.end_reason)`,
        [session.tenantId, session.callId, session.callSid, session.phoneNumber, session.callerNumber, session.status, session.startedAt ?? new Date().toISOString(), session.endedAt ?? null, session.endReason ?? null]
      );
    } catch (error) {
      logger.error("failed to upsert call session", { error: (error as Error).message, callId: session.callId });
      throw error;
    }
  }

  async getCallSessionByCallSid(callSid: string): Promise<CallSession | null> {
    try {
      const result = await query("SELECT * FROM call_sessions WHERE call_sid = $1 LIMIT 1", [callSid]);
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        id: row.id,
        tenantId: row.tenant_id,
        callId: row.call_id,
        callSid: row.call_sid,
        phoneNumber: row.phone_number,
        callerNumber: row.caller_number,
        status: row.status,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        endReason: row.end_reason,
      };
    } catch (error) {
      logger.error("failed to get call session", { error: (error as Error).message, callSid });
      throw error;
    }
  }

  private mapVoiceRow(row: any): VoiceNumber {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      phoneNumber: row.phone_number,
      phoneSid: row.phone_sid,
      sipDomain: row.sip_domain,
      secretId: row.secret_id,
      webhookToken: row.webhook_token,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
