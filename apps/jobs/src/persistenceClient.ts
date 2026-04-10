/**
 * persistenceClient.ts — Direct Postgres persistence for jobs.
 * Replaces the old Supabase REST + file-based dual client.
 */

import { Pool } from "pg";
import { createLogger } from "@rezovo/logging";

type StoredDocument = {
  orgId: string;
  businessId: string;
  namespace: string;
  docId: string;
  text: string;
  metadata?: Record<string, unknown>;
  ingestedAt: string;
  embeddedChunks?: number;
};

const logger = createLogger({ service: "jobs", module: "persistenceClient" });

// Lazy-init pool (shares the same DATABASE_URL as platform-api)
let pool: Pool | null = null;

function getPool(): Pool {
  if (pool) return pool;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("[persistenceClient] DATABASE_URL is not set");
  }

  pool = new Pool({
    connectionString: databaseUrl,
    max: 3,
    idleTimeoutMillis: 30_000,
  });

  pool.on("error", (err: Error) => {
    logger.error("pool error", { error: err.message });
  });

  return pool;
}

export const persistenceClient = {
  async loadDocument(orgId: string, docId: string): Promise<StoredDocument | null> {
    try {
      const result = await getPool().query(
        "SELECT * FROM kb_documents WHERE org_id = $1 AND doc_id = $2 LIMIT 1",
        [orgId, docId]
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        orgId: row.org_id,
        businessId: row.business_id,
        namespace: row.namespace,
        docId: row.doc_id,
        text: row.text,
        metadata: row.metadata ?? undefined,
        ingestedAt: row.ingested_at,
        embeddedChunks: row.embedded_chunks ?? undefined,
      };
    } catch (err) {
      logger.error("loadDocument failed", { error: (err as Error).message, orgId, docId });
      return null;
    }
  },

  async markDocumentEmbedded(orgId: string, docId: string, chunks: number): Promise<void> {
    try {
      await getPool().query(
        `UPDATE kb_documents
         SET embedded_chunks = $1, status = 'embedded', updated_at = now()
         WHERE org_id = $2 AND doc_id = $3`,
        [chunks, orgId, docId]
      );
    } catch (err) {
      logger.warn("markDocumentEmbedded failed", { error: (err as Error).message, orgId, docId });
    }
  },
};
