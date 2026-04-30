import type { Pool } from "pg";
import { chunkText } from "./chunkKbText";

/**
 * How API maps sync/async vs bus implementation (see apps/platform-api/src/kb.ts).
 * - User sync=true → inline
 * - In-memory bus → inline (dev)
 * - Redis + async → background worker
 */
export function kbIngestTransportMode(
  sync: boolean,
  bus: "redis" | "memory"
): "inline" | "async" {
  if (sync) return "inline";
  if (bus === "memory") return "inline";
  return "async";
}

export async function markKbDocumentProcessing(
  pool: Pool,
  orgId: string,
  docId: string
): Promise<void> {
  await pool.query(
    `UPDATE kb_documents SET status = 'processing', updated_at = now()
     WHERE org_id = $1 AND doc_id = $2`,
    [orgId, docId]
  );
}

type PipelineVectorStore = {
  upsertChunks(params: {
    docId: string;
    orgId: string;
    namespace: string;
    chunks: Array<{ index: number; text: string; metadata?: Record<string, unknown> }>;
  }): Promise<number>;
};

export async function runKbIngestPipeline(params: {
  pool: Pool;
  vectorStore: PipelineVectorStore;
  orgId: string;
  docId: string;
  namespace: string;
  businessId: string;
  text: string;
  metadata?: Record<string, unknown>;
}): Promise<number> {
  const { pool, vectorStore, orgId, docId, namespace, businessId, text, metadata } = params;

  const chunks = chunkText(text, { targetSize: 1600, overlap: 200 });
  if (chunks.length === 0) {
    await pool.query(
      `UPDATE kb_documents
       SET embedded_chunks = 0, status = 'embedded', updated_at = now()
       WHERE org_id = $1 AND doc_id = $2`,
      [orgId, docId]
    );
    return 0;
  }

  const inserted = await vectorStore.upsertChunks({
    docId,
    orgId,
    namespace,
    chunks: chunks.map((c) => ({
      index: c.index,
      text: c.text,
      metadata: { business_id: businessId, doc_id: docId, ...metadata },
    })),
  });

  await pool.query(
    `UPDATE kb_documents
     SET embedded_chunks = $1, status = 'embedded', updated_at = now()
     WHERE org_id = $2 AND doc_id = $3`,
    [inserted, orgId, docId]
  );

  return inserted;
}
