/**
 * kb.ts — Knowledge Base retrieval + ingestion via pgvector
 *
 * Supports both synchronous (inline chunk+embed) and async (event-driven)
 * ingestion. Pass ?sync=true or set KAFKA_ENABLED=false for inline mode.
 */

import { FastifyReply, FastifyRequest } from "fastify";
import { v4 as uuidv4 } from "uuid";
import { createLogger } from "@rezovo/logging";
import { createEventEnvelope, EventBusClient } from "@rezovo/event-bus";
import { PgVectorStore, OpenAIEmbedder } from "@rezovo/vector-store";
import { getPool } from "./persistence/dbClient";
import { PersistenceStore } from "./persistence/store";
import { env } from "./env";

const logger = createLogger({ service: "platform-api", module: "kb" });
const persistence = new PersistenceStore();

// Lazy-init singleton — pool is only available after env is loaded
let vectorStore: PgVectorStore | null = null;

function getVectorStore(): PgVectorStore {
  if (vectorStore) return vectorStore;

  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for KB vector search");
  }

  const embedder = new OpenAIEmbedder(apiKey, "text-embedding-3-small");
  vectorStore = new PgVectorStore({ pool: getPool(), embedder });
  return vectorStore;
}

// ─── Types ───

type KbRetrieveBody = {
  org_id: string;
  business_id: string;
  namespace: string;
  query: string;
  topK?: number;
};

type KbDocsBody = {
  org_id: string;
  business_id: string;
  namespace: string;
  doc_id?: string;
  text: string;
  metadata?: Record<string, unknown>;
  sync?: boolean;
};

type KbStatusQuery = {
  orgId: string;
  docId: string;
};

// ─── Text Chunker (inline for sync ingestion) ───

function chunkTextInline(text: string, targetSize = 1600, overlap = 200): Array<{ index: number; text: string }> {
  if (!text || text.trim().length === 0) return [];
  if (text.length <= targetSize) return [{ index: 0, text: text.trim() }];

  const normalized = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  const sentences = normalized.split(/(?<=[.!?])\s+|(?:\n\s*\n)/).map(s => s.trim()).filter(s => s.length > 0);
  if (sentences.length === 0) return [{ index: 0, text: text.trim() }];

  const chunks: Array<{ index: number; text: string }> = [];
  let current: string[] = [];
  let currentLen = 0;
  let si = 0;

  while (si < sentences.length) {
    const s = sentences[si];
    if (currentLen + s.length > targetSize && current.length > 0) {
      chunks.push({ index: chunks.length, text: current.join(" ").trim() });
      const overlapSentences: string[] = [];
      let oLen = 0;
      for (let i = current.length - 1; i >= 0 && oLen < overlap; i--) {
        overlapSentences.unshift(current[i]);
        oLen += current[i].length + 1;
      }
      current = overlapSentences;
      currentLen = oLen;
      continue;
    }
    current.push(s);
    currentLen += s.length + 1;
    si++;
  }

  if (current.length > 0) {
    const t = current.join(" ").trim();
    if (t.length >= 100) {
      chunks.push({ index: chunks.length, text: t });
    } else if (chunks.length > 0) {
      chunks[chunks.length - 1].text += " " + t;
    } else {
      chunks.push({ index: 0, text: t });
    }
  }

  return chunks;
}

// ─── Handlers ───

export async function kbRetrieveHandler(
  request: FastifyRequest<{ Body: KbRetrieveBody }>,
  reply: FastifyReply
): Promise<unknown> {
  const { org_id, business_id, namespace, query, topK } = request.body ?? {};
  if (!org_id || !business_id || !namespace || !query) {
    reply.status(400);
    return { ok: false, error: "org_id, business_id, namespace, query required" };
  }

  logger.info("kb retrieve", { org_id, business_id, namespace, topK: topK ?? 5 });

  try {
    const store = getVectorStore();
    const passages = await store.query({
      orgId: org_id,
      namespace,
      queryText: query,
      topK: topK ?? 5,
      threshold: 0.3, // Generous threshold — let the model decide relevance
    });

    logger.info("kb retrieve results", { org_id, namespace, matchCount: passages.length });
    return { passages };
  } catch (err) {
    logger.error("kb retrieve failed", { error: (err as Error).message, org_id, namespace });
    // Return empty results rather than crashing — agent can still function without KB
    return { passages: [] };
  }
}

export async function kbIngestHandler(
  eventBus: EventBusClient,
  request: FastifyRequest<{ Body: KbDocsBody }>,
  reply: FastifyReply
): Promise<unknown> {
  const { org_id, business_id, namespace, text, metadata, doc_id } = request.body ?? {};
  if (!org_id || !business_id || !namespace || !text) {
    reply.status(400);
    return { ok: false, error: "org_id, business_id, namespace, text required" };
  }

  const id = doc_id ?? uuidv4();
  const docRecord = {
    orgId: org_id,
    businessId: business_id,
    namespace,
    docId: id,
    text,
    metadata,
    ingestedAt: new Date().toISOString(),
  };

  await persistence.appendDocument(docRecord);

  const useSync = request.body?.sync === true || !env.KAFKA_ENABLED;

  if (useSync) {
    logger.info("kb doc ingested, embedding inline (sync mode)", { org_id, namespace, doc_id: id, textLen: text.length });

    try {
      const store = getVectorStore();
      const chunks = chunkTextInline(text);

      if (chunks.length === 0) {
        return { ok: true, doc_id: id, chunks: 0, mode: "sync" };
      }

      const insertedCount = await store.upsertChunks({
        docId: id,
        orgId: org_id,
        namespace,
        chunks: chunks.map(c => ({
          index: c.index,
          text: c.text,
          metadata: { business_id, doc_id: id, ...metadata },
        })),
      });

      logger.info("kb sync embed complete", { doc_id: id, chunks: insertedCount, namespace });
      return { ok: true, doc_id: id, chunks: insertedCount, mode: "sync" };
    } catch (err) {
      logger.error("kb sync embed failed", { doc_id: id, error: (err as Error).message });
      reply.status(500);
      return { ok: false, error: "Embedding failed: " + (err as Error).message };
    }
  }

  logger.info("kb doc ingested, queuing embed job (async mode)", { org_id, business_id, namespace, doc_id: id });
  const envelope = createEventEnvelope({
    eventType: "DocIngestRequested",
    orgId: org_id,
    payload: { doc_id: id, namespace },
  });
  await eventBus.publish(envelope);

  return { ok: true, doc_id: id, mode: "async" };
}

export async function kbStatusHandler(
  request: FastifyRequest<{ Querystring: KbStatusQuery }>,
  reply: FastifyReply
): Promise<unknown> {
  const { orgId, docId } = request.query ?? {};
  if (!orgId || !docId) {
    reply.status(400);
    return { ok: false, error: "orgId and docId required" };
  }

  const docs = await persistence.loadDocuments({ orgId });
  const doc = docs.find((d) => d.docId === docId);
  if (!doc) {
    reply.status(404);
    return { ok: false, error: "not_found" };
  }

  // Also check actual chunk count in the vector store
  let chunkCount = doc.embeddedChunks ?? 0;
  try {
    const store = getVectorStore();
    chunkCount = await store.getChunkCount(docId);
  } catch {
    // Fall back to stored count
  }

  return {
    ok: true,
    docId: doc.docId,
    namespace: doc.namespace,
    ingestedAt: doc.ingestedAt,
    embeddedChunks: chunkCount,
  };
}
