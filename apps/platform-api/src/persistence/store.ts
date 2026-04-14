/**
 * PersistenceStore — Direct PostgreSQL persistence
 *
 * Replaces the old file-based + Supabase dual-write store.
 * All operations go straight to Postgres via dbClient.
 */

import { AgentConfigSnapshot, PhoneNumberConfig, PlanSnapshot } from "@rezovo/core-types";
import { createLogger } from "@rezovo/logging";
import { query } from "./dbClient";
import { getRedisClient, isRedisEnabled } from "../redis/client";

type StoredConfig = {
  version: number;
  status: "draft" | "published";
  agentConfig: AgentConfigSnapshot;
  phoneNumbers: PhoneNumberConfig[];
  plan: PlanSnapshot;
  lob: string;
};

type ToolResult = {
  result: unknown;
  storedAt: string;
};

type UsageRecord = {
  orgId: string;
  callId: string;
  usage: unknown;
  callStartedAt: string;
  callEndedAt: string;
};

type AnalyticsRecord = {
  orgId: string;
  callId?: string;
  durationMs: number;
  outcome?: string;
  recordedAt?: string;
};

type ToolUsageRecord = {
  orgId: string;
  toolName: string;
  count: number;
};

export type StoredDocument = {
  orgId: string;
  businessId: string;
  namespace: string;
  docId: string;
  text: string;
  metadata?: Record<string, unknown>;
  ingestedAt: string;
  embeddedChunks?: number;
};

const logger = createLogger({ service: "platform-api", module: "persistence" });

export class PersistenceStore {
  async isReady(): Promise<boolean> {
    try {
      const result = await query("SELECT 1 AS ok");
      return result.rows[0]?.ok === 1;
    } catch {
      return false;
    }
  }

  loadConfigSync(_orgId: string, _lob: string): StoredConfig | null {
    // Config is stored in-memory via ConfigStore; DB is source of truth for
    // agent_configs table but we don't block startup with a sync read.
    return null;
  }

  async saveConfig(_orgId: string, _lob: string, _cfg: StoredConfig): Promise<void> {
    // Config publishing is handled through the agent_configs table directly.
    // This is a no-op for now — will be wired when config management is built out.
  }

  // ─── Tool Results (idempotency) ───

  async loadToolResult(orgId: string, toolName: string, idem: string): Promise<ToolResult | null> {
    try {
      const result = await query(
        `SELECT result, stored_at FROM tool_results
         WHERE org_id = $1 AND tool_name = $2 AND idempotency_key = $3
         AND (expires_at IS NULL OR expires_at > now())`,
        [orgId, toolName, idem]
      );
      if (result.rows.length === 0) return null;
      return { result: result.rows[0].result, storedAt: result.rows[0].stored_at };
    } catch (err) {
      logger.warn("failed to load tool result", { error: (err as Error).message, orgId, toolName, idem });
      return null;
    }
  }

  async saveToolResult(orgId: string, toolName: string, idem: string, result: unknown): Promise<void> {
    try {
      await query(
        `INSERT INTO tool_results (org_id, tool_name, idempotency_key, result, stored_at, expires_at)
         VALUES ($1, $2, $3, $4, now(), now() + interval '7 days')
         ON CONFLICT (org_id, tool_name, idempotency_key) DO UPDATE SET
           result = EXCLUDED.result, stored_at = EXCLUDED.stored_at, expires_at = EXCLUDED.expires_at`,
        [orgId, toolName, idem, JSON.stringify(result)]
      );
    } catch (err) {
      logger.warn("failed to save tool result", { error: (err as Error).message, orgId, toolName, idem });
    }
  }

  // ─── Analytics ───

  async appendAnalytics(record: AnalyticsRecord): Promise<void> {
    // Analytics is now tracked in the calls table directly.
    // This method exists for backward compat with the analytics consumer.
    logger.debug("analytics appended (now tracked in calls table)", { callId: record.callId });
  }

  async loadAnalytics(): Promise<AnalyticsRecord[]> {
    try {
      const result = await query(
        `SELECT org_id, call_id, duration_sec * 1000 AS duration_ms, outcome, started_at AS recorded_at
         FROM calls ORDER BY started_at DESC LIMIT 500`
      );
      return result.rows.map((r: any) => ({
        orgId: r.org_id,
        callId: r.call_id,
        durationMs: r.duration_ms ?? 0,
        outcome: r.outcome,
        recordedAt: r.recorded_at,
      }));
    } catch (err) {
      logger.warn("failed to load analytics", { error: (err as Error).message });
      return [];
    }
  }

  // ─── Tool Usage ───

  async appendToolUsage(record: ToolUsageRecord): Promise<void> {
    // Tool usage is now tracked via call_events.
    logger.debug("tool usage appended (now tracked in call_events)", { toolName: record.toolName });
  }

  async loadToolUsage(): Promise<ToolUsageRecord[]> {
    try {
      const result = await query(
        `SELECT org_id, payload->>'toolName' AS tool_name, COUNT(*) AS count
         FROM call_events WHERE event_type = 'tool_called'
         GROUP BY org_id, payload->>'toolName'`
      );
      return result.rows.map((r: any) => ({
        orgId: r.org_id,
        toolName: r.tool_name,
        count: parseInt(r.count, 10),
      }));
    } catch (err) {
      logger.warn("failed to load tool usage", { error: (err as Error).message });
      return [];
    }
  }

  // ─── KB Documents ───

  async appendDocument(record: StoredDocument): Promise<void> {
    try {
      await query(
        `INSERT INTO kb_documents (org_id, business_id, namespace, doc_id, text, metadata, ingested_at, embedded_chunks, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ingest_requested')
         ON CONFLICT (doc_id) DO UPDATE SET
           text = EXCLUDED.text, metadata = EXCLUDED.metadata, 
           ingested_at = EXCLUDED.ingested_at, status = 'ingest_requested'`,
        [record.orgId, record.businessId, record.namespace, record.docId, record.text, JSON.stringify(record.metadata ?? {}), record.ingestedAt, record.embeddedChunks ?? 0]
      );
    } catch (err) {
      logger.warn("failed to append document", { error: (err as Error).message, docId: record.docId });
    }
  }

  async markDocumentEmbedded(orgId: string, docId: string, chunks: number): Promise<void> {
    try {
      await query(
        `UPDATE kb_documents
         SET embedded_chunks = $1, status = 'embedded', updated_at = now()
         WHERE org_id = $2 AND doc_id = $3`,
        [chunks, orgId, docId]
      );
    } catch (err) {
      logger.warn("markDocumentEmbedded failed", { error: (err as Error).message, orgId, docId });
    }
  }

  async markDocumentFailed(orgId: string, docId: string): Promise<void> {
    try {
      await query(
        `UPDATE kb_documents
         SET status = 'failed', updated_at = now()
         WHERE org_id = $1 AND doc_id = $2`,
        [orgId, docId]
      );
    } catch (err) {
      logger.warn("markDocumentFailed failed", { error: (err as Error).message, orgId, docId });
    }
  }

  async loadDocuments(filter: { orgId: string; namespace?: string }): Promise<StoredDocument[]> {
    try {
      let sql = "SELECT * FROM kb_documents WHERE org_id = $1";
      const params: any[] = [filter.orgId];
      if (filter.namespace) {
        sql += " AND namespace = $2";
        params.push(filter.namespace);
      }
      const result = await query(sql, params);
      return result.rows.map((row: any) => ({
        orgId: row.org_id,
        businessId: row.business_id,
        namespace: row.namespace,
        docId: row.doc_id,
        text: row.text,
        metadata: row.metadata,
        ingestedAt: row.ingested_at,
        embeddedChunks: row.embedded_chunks,
      }));
    } catch (err) {
      logger.warn("failed to load documents", { error: (err as Error).message });
      return [];
    }
  }

  // ─── Rate Limiting (Redis-backed, no file fallback) ───

  async consumeRateLimit(key: string, windowMs: number, limit: number): Promise<{ allowed: boolean; remaining: number }> {
    if (isRedisEnabled) {
      try {
        const redis = getRedisClient();
        const ttlSeconds = Math.ceil(windowMs / 1000);
        const script = `
          local current = redis.call("INCR", KEYS[1])
          if current == 1 then
            redis.call("EXPIRE", KEYS[1], ARGV[1])
          end
          return current
        `;
        const current = await redis.eval(script, 1, key, ttlSeconds);
        const count = Number(current);
        if (count > limit) {
          return { allowed: false, remaining: 0 };
        }
        return { allowed: true, remaining: limit - count };
      } catch (err) {
        logger.warn("redis rate limit failed", { error: (err as Error).message });
      }
    }
    // Without Redis, allow all requests (dev mode)
    return { allowed: true, remaining: limit };
  }

  // ─── Credentials ───

  async saveCredentials(record: { orgId: string; provider: string; data: Record<string, string> }): Promise<void> {
    try {
      await query(
        `INSERT INTO credentials (org_id, provider, credentials, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (org_id, provider) DO UPDATE SET
           credentials = EXCLUDED.credentials, updated_at = EXCLUDED.updated_at`,
        [record.orgId, record.provider, JSON.stringify(record.data)]
      );
    } catch (err) {
      logger.warn("failed to save credentials", { error: (err as Error).message, orgId: record.orgId, provider: record.provider });
    }
  }

  async loadCredentials(orgId: string, provider: string): Promise<Record<string, string> | null> {
    try {
      const result = await query(
        "SELECT credentials FROM credentials WHERE org_id = $1 AND provider = $2",
        [orgId, provider]
      );
      if (result.rows.length === 0) return null;
      return result.rows[0].credentials;
    } catch (err) {
      logger.warn("failed to load credentials", { error: (err as Error).message, orgId, provider });
      return null;
    }
  }

  // ─── Usage ───

  async appendUsage(record: UsageRecord): Promise<void> {
    // Usage is now tracked in the calls table via callStore.upsertCall.
    // This method exists for backward compat with billingQuota.
    logger.debug("usage appended (tracked in calls table)", { callId: record.callId });
  }

  // ─── Webhooks ───

  async appendWebhook(record: { type: string; payload: unknown; receivedAt: string; orgId?: string }): Promise<void> {
    // Webhooks are logged but not persisted to DB in the new schema.
    // Use structured logging instead.
    logger.debug("webhook received", { type: record.type, orgId: record.orgId });
  }
}
