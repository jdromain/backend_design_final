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
    tenantId: string;
    namespace: string;
    chunkIndex: number;
    text: string;
    embedding: number[];
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const { docId, tenantId, namespace, chunkIndex, text, embedding, metadata } = params;
    const embeddingStr = `[${embedding.join(",")}]`;

    await this.pool.query(
      `INSERT INTO kb_chunks (doc_id, tenant_id, namespace, chunk_index, text, embedding, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::vector, $7)
       ON CONFLICT (doc_id, chunk_index) DO UPDATE SET
         text = EXCLUDED.text,
         embedding = EXCLUDED.embedding,
         metadata = EXCLUDED.metadata`,
      [docId, tenantId, namespace, chunkIndex, text, embeddingStr, metadata ?? {}]
    );
  }

  /**
   * Batch upsert chunks with embeddings.
   * Embeds all texts in a single API call for efficiency.
   */
  async upsertChunks(params: {
    docId: string;
    tenantId: string;
    namespace: string;
    chunks: Array<{ index: number; text: string; metadata?: Record<string, unknown> }>;
  }): Promise<number> {
    const { docId, tenantId, namespace, chunks } = params;
    if (chunks.length === 0) return 0;

    // Batch embed all chunk texts
    const texts = chunks.map((c) => c.text);
    const embeddings = await this.embedder.embed(texts);

    // Insert in a transaction
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Delete existing chunks for this doc to handle re-ingestion
      await client.query("DELETE FROM kb_chunks WHERE doc_id = $1", [docId]);

      for (let i = 0; i < chunks.length; i++) {
        const embeddingStr = `[${embeddings[i].join(",")}]`;
        await client.query(
          `INSERT INTO kb_chunks (doc_id, tenant_id, namespace, chunk_index, text, embedding, metadata)
           VALUES ($1, $2, $3, $4, $5, $6::vector, $7)`,
          [docId, tenantId, namespace, chunks[i].index, chunks[i].text, embeddingStr, chunks[i].metadata ?? {}]
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
    tenantId: string;
    namespace: string;
    queryText: string;
    topK?: number;
    threshold?: number;
  }): Promise<Passage[]> {
    const { tenantId, namespace, queryText, topK = 5, threshold = 0.5 } = params;

    // Embed the query
    const [queryEmbedding] = await this.embedder.embed([queryText]);
    const embeddingStr = `[${queryEmbedding.join(",")}]`;

    // Use the match_kb_chunks function
    const result = await this.pool.query(
      `SELECT id, doc_id, chunk_index, text, metadata, similarity
       FROM match_kb_chunks($1::vector, $2, $3, $4, $5)`,
      [embeddingStr, tenantId, namespace, topK, threshold]
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
