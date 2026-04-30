/**
 * PgVectorStore — Real vector similarity search via pgvector
 *
 * Uses:
 * - OpenAI text-embedding-3-small (1536 dims, $0.02/1M tokens)
 * - pgvector HNSW index for fast approximate nearest neighbor
 * - Direct pg queries (no Supabase REST)
 *
 * Designed for both local Postgres + pgvector and AWS Aurora PostgreSQL.
 */

import { Pool } from "pg";

// ─── Types ───

export type Passage = {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
  similarity?: number;
};

export type EmbeddingProvider = {
  embed(texts: string[]): Promise<number[][]>;
};

export type PgVectorStoreConfig = {
  pool: Pool;
  embedder: EmbeddingProvider;
};

// ─── OpenAI Embedding Provider ───

export class OpenAIEmbedder implements EmbeddingProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = "text-embedding-3-small") {
    this.apiKey = apiKey;
    this.model = model;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: texts,
        model: this.model,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI embeddings failed: ${response.status} ${errText}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
      usage: { prompt_tokens: number; total_tokens: number };
    };

    // Sort by index to maintain input order
    return data.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }
}

// ─── PgVector Store ───

export class PgVectorStore {
  private pool: Pool;
  private embedder: EmbeddingProvider;

  constructor(config: PgVectorStoreConfig) {
    this.pool = config.pool;
    this.embedder = config.embedder;
  }

  /**
   * Upsert a chunk with its embedding into kb_chunks.
   * Used by the ingestion pipeline.
   */
  async upsertChunk(params: {
    docId: string;
    orgId: string;
    namespace: string;
    chunkIndex: number;
    text: string;
    embedding: number[];
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const { docId, orgId, namespace, chunkIndex, text, embedding, metadata } = params;
    const embeddingStr = `[${embedding.join(",")}]`;

    await this.pool.query(
      `INSERT INTO kb_chunks (doc_id, org_id, namespace, chunk_index, text, embedding, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::vector, $7)
       ON CONFLICT (doc_id, chunk_index) DO UPDATE SET
         text = EXCLUDED.text,
         embedding = EXCLUDED.embedding,
         metadata = EXCLUDED.metadata`,
      [docId, orgId, namespace, chunkIndex, text, embeddingStr, metadata ?? {}]
    );
  }

  /**
   * Batch upsert chunks with embeddings.
   * Embeds all texts in a single API call for efficiency.
   */
  async upsertChunks(params: {
    docId: string;
    orgId: string;
    namespace: string;
    chunks: Array<{ index: number; text: string; metadata?: Record<string, unknown> }>;
  }): Promise<number> {
    const { docId, orgId, namespace, chunks } = params;
    if (chunks.length === 0) return 0;

    const EMBED_BATCH = 32;

    const rowsToInsert: Array<{ index: number; text: string; embeddingStr: string; metadata: Record<string, unknown> }> = [];
    for (let offset = 0; offset < chunks.length; offset += EMBED_BATCH) {
      const batch = chunks.slice(offset, offset + EMBED_BATCH);
      const texts = batch.map((c) => c.text);
      const embeddings = await this.embedder.embed(texts);
      for (let i = 0; i < batch.length; i++) {
        rowsToInsert.push({
          index: batch[i]!.index,
          text: batch[i]!.text,
          embeddingStr: `[${embeddings[i]!.join(",")}]`,
          metadata: batch[i]!.metadata ?? {},
        });
      }
    }

    // Insert in a transaction
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Delete existing chunks for this doc to handle re-ingestion
      await client.query("DELETE FROM kb_chunks WHERE doc_id = $1", [docId]);

      for (const row of rowsToInsert) {
        await client.query(
          `INSERT INTO kb_chunks (doc_id, org_id, namespace, chunk_index, text, embedding, metadata)
           VALUES ($1, $2, $3, $4, $5, $6::vector, $7)`,
          [docId, orgId, namespace, row.index, row.text, row.embeddingStr, row.metadata]
        );
      }

      await client.query("COMMIT");
      return chunks.length;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Query for similar passages using cosine similarity.
   * Uses the match_kb_chunks SQL function with HNSW index.
   */
  async query(params: {
    orgId: string;
    namespace: string;
    queryText: string;
    topK?: number;
    threshold?: number;
  }): Promise<Passage[]> {
    const { orgId, namespace, queryText, topK = 5, threshold = 0.5 } = params;

    // Embed the query
    const [queryEmbedding] = await this.embedder.embed([queryText]);
    const embeddingStr = `[${queryEmbedding.join(",")}]`;

    // Use the match_kb_chunks function
    const result = await this.pool.query(
      `SELECT id, doc_id, chunk_index, text, metadata, similarity
       FROM match_kb_chunks($1::vector, $2, $3, $4, $5)`,
      [embeddingStr, orgId, namespace, topK, threshold]
    );

    return result.rows.map((row) => ({
      id: `${row.doc_id}::${row.chunk_index}`,
      text: row.text,
      metadata: row.metadata,
      similarity: row.similarity,
    }));
  }

  /**
   * Delete all chunks for a document.
   */
  async deleteChunks(docId: string): Promise<void> {
    await this.pool.query("DELETE FROM kb_chunks WHERE doc_id = $1", [docId]);
  }

  /**
   * Get chunk count for a document.
   */
  async getChunkCount(docId: string): Promise<number> {
    const result = await this.pool.query(
      "SELECT COUNT(*) AS count FROM kb_chunks WHERE doc_id = $1",
      [docId]
    );
    return parseInt(result.rows[0]?.count ?? "0", 10);
  }
}

// ─── Legacy compatibility export (for code that still references InMemoryVectorStore) ───

export { PgVectorStore as InMemoryVectorStore };

export { chunkText } from "./chunkKbText";
export {
  kbIngestTransportMode,
  markKbDocumentProcessing,
  runKbIngestPipeline,
} from "./kbIngestPipeline";
