/**
 * kbReembedWorker.ts — Listens for DocIngestRequested events,
 * chunks the document, generates embeddings via OpenAI, and
 * stores them in pgvector via PgVectorStore.
 */

import { EventBusClient } from "@rezovo/event-bus";
import { createLogger } from "@rezovo/logging";
import { DocIngestRequestedPayload, TypedEventEnvelope } from "@rezovo/core-types";
import { PgVectorStore, OpenAIEmbedder } from "@rezovo/vector-store";
import { Pool } from "pg";

import { persistenceClient } from "./persistenceClient";
import { chunkText } from "./textChunker";

const logger = createLogger({ service: "jobs", module: "kbReembedWorker" });

// Lazy-init: pool and vector store are created once on first use
let vectorStore: PgVectorStore | null = null;

function getVectorStore(): PgVectorStore {
  if (vectorStore) return vectorStore;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for embedding generation");
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for vector storage");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 3, // Small pool — embeddings are not high-concurrency
    idleTimeoutMillis: 30_000,
  });

  const embedder = new OpenAIEmbedder(apiKey, "text-embedding-3-small");
  vectorStore = new PgVectorStore({ pool, embedder });
  return vectorStore;
}

export async function registerKbReembedWorker(bus: EventBusClient): Promise<() => Promise<void>> {
  return bus.subscribe("DocIngestRequested", async (event: TypedEventEnvelope<"DocIngestRequested">) => {
    const payload = event.payload as DocIngestRequestedPayload;
    const tenantId = event.tenant_id;
    const docId = payload.doc_id;
    const namespace = payload.namespace;

    logger.info("kb ingest requested", { tenantId, docId, namespace });

    if (!process.env.OPENAI_API_KEY?.trim()) {
      logger.warn("skipping DocIngestRequested — OPENAI_API_KEY not set (idle local worker)");
      return;
    }

    const document = await persistenceClient.loadDocument(tenantId, docId);
    if (!document) {
      logger.warn("document not found for ingest", { docId });
      return;
    }

    try {
      const store = getVectorStore();

      // Chunk the document text with sentence-aware splitting + overlap
      const chunks = chunkText(document.text, {
        targetSize: 1600, // ~400 tokens for text-embedding-3-small
        overlap: 200,     // ~50 token overlap for context continuity
      });

      if (chunks.length === 0) {
        logger.warn("no chunks produced from document", { docId, textLength: document.text.length });
        return;
      }

      // Batch upsert: embeds all chunks in a single OpenAI call, inserts in a transaction
      const insertedCount = await store.upsertChunks({
        docId,
        tenantId,
        namespace,
        chunks: chunks.map(c => ({
          index: c.index,
          text: c.text,
          metadata: {
            business_id: document.businessId,
            doc_id: docId,
          },
        })),
      });

      // Mark document as embedded in kb_documents table
      await persistenceClient.markDocumentEmbedded(tenantId, docId, insertedCount);

      logger.info("kb ingest completed", {
        docId,
        namespace,
        tenantId,
        chunks: insertedCount,
        textLength: document.text.length,
      });
    } catch (err) {
      logger.error("kb ingest failed", {
        docId,
        namespace,
        tenantId,
        error: (err as Error).message,
      });
    }
  });
}
