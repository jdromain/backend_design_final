import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { createLogger } from "@rezovo/logging";
import { query } from "../persistence/dbClient";
import { sendData, sendError } from "../lib/responses";
import { resolvedAuthHook } from "../auth/jwt";
import { requireOrgForRequest } from "../auth/orgScope";
import { getVectorStore, chunkTextInline } from "../kb";
import { PersistenceStore } from "../persistence/store";

const logger = createLogger({ service: "platform-api", module: "knowledgeRoutes" });

function mapKbStatus(status: string): "ready" | "processing" | "failed" | "uploading" {
  switch (status) {
    case "embedded": return "ready";
    case "processing": return "processing";
    case "failed": return "failed";
    case "ingest_requested": return "uploading";
    default: return "processing";
  }
}

function resolveActive(metadata: Record<string, unknown>): boolean {
  if (metadata.active === false) return false;
  return true;
}

export function registerKnowledgeRoutes(app: FastifyInstance) {
  const persistence = new PersistenceStore();
  const deleteDocumentHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;

    const { docId } = request.params as { docId: string };
    const deleteResult = await persistence.deleteDocument(orgId, docId);
    if (!deleteResult.ok) {
      if (deleteResult.failureCategory === "not_found" || deleteResult.failureCategory === "org_mismatch") {
        logger.info("knowledge delete not found", {
          orgId,
          docId,
          rows_deleted_docs: deleteResult.rowsDeletedDocs,
          rows_deleted_chunks: deleteResult.rowsDeletedChunks,
          durationMs: deleteResult.durationMs,
          failure_category: deleteResult.failureCategory,
        });
        if (deleteResult.failureCategory === "org_mismatch") {
          return sendError(reply, 403, "org_mismatch", "Document exists but is scoped to a different organization");
        }
        return sendError(reply, 404, "not_found", "Document not found for this organization");
      }
      logger.warn("knowledge delete db error", {
        orgId,
        docId,
        rows_deleted_docs: deleteResult.rowsDeletedDocs,
        rows_deleted_chunks: deleteResult.rowsDeletedChunks,
        durationMs: deleteResult.durationMs,
        error: deleteResult.errorMessage,
      });
      return sendError(reply, 500, "delete_failed", "Failed to delete knowledge document");
    }

    if (deleteResult.rowsDeletedDocs <= 0) {
      return sendError(reply, 404, "not_found", "Document not found");
    }

    sendData(reply, {
      ok: true,
      diagnostics: {
        docId,
        orgId,
        rows_deleted_docs: deleteResult.rowsDeletedDocs,
        rows_deleted_chunks: deleteResult.rowsDeletedChunks,
        duration_ms: deleteResult.durationMs,
      },
    });
  };

  app.get("/knowledge/documents", {
    preHandler: resolvedAuthHook(["admin", "editor", "viewer"]),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;

    const result = await query(
      `SELECT d.*, COALESCE(c.chunk_count, 0)::int AS actual_chunks
       FROM kb_documents d
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS chunk_count
         FROM kb_chunks kc
         WHERE kc.doc_id = d.doc_id
       ) c ON true
       WHERE d.org_id = $1
       ORDER BY d.created_at DESC`,
      [orgId]
    );

    const documents = result.rows.map((r: any) => {
      const meta = r.metadata ?? {};
      const actualChunks = Number(r.actual_chunks ?? 0);
      const storedChunks = Number(r.embedded_chunks ?? 0);
      const resolvedChunks = Math.max(actualChunks, storedChunks);
      const resolvedStatus = resolvedChunks > 0 ? "embedded" : r.status;

      if (actualChunks > 0 && !["embedded", "failed"].includes(r.status)) {
        query(
          `UPDATE kb_documents
           SET embedded_chunks = $1, status = 'embedded', updated_at = now()
           WHERE doc_id = $2 AND org_id = $3`,
          [actualChunks, r.doc_id, orgId]
        ).catch(() => {
          // best-effort status healing only
        });
      }

      const lastErrRaw = r.last_error;
      const lastErr =
        lastErrRaw != null && String(lastErrRaw).trim() !== ""
          ? String(lastErrRaw).trim()
          : undefined;

      return {
        id: r.doc_id,
        namespace: r.namespace,
        name: meta.name ?? meta.filename ?? r.doc_id,
        type: meta.type ?? "txt",
        sizeBytes: meta.sizeBytes ?? 0,
        status: mapKbStatus(resolvedStatus) === "ready"
          ? "ready"
          : mapKbStatus(resolvedStatus) === "failed"
            ? "failed"
            : r.status === "ingest_requested" || mapKbStatus(resolvedStatus) === "uploading"
              ? "ingest_requested"
              : "chunking",
        chunks: resolvedChunks,
        active: resolveActive(meta),
        ingestedAt: r.ingested_at ?? r.created_at,
        updatedAt: r.updated_at ?? r.created_at,
        ...(lastErr ? { errorMessage: lastErr, last_error: lastErr } : {}),
      };
    });
    sendData(reply, { documents });
  });

  app.patch("/knowledge/documents/:docId", {
    preHandler: resolvedAuthHook(["admin", "editor"]),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;

    const { docId } = request.params as { docId: string };
    const body = (request.body ?? {}) as Partial<{
      namespace: string;
      active: boolean;
      name: string;
    }>;

    const namespace =
      typeof body.namespace === "string" && body.namespace.trim().length > 0
        ? body.namespace.trim()
        : undefined;

    const metadataPatch: Record<string, unknown> = {};
    if (typeof body.active === "boolean") {
      metadataPatch.active = body.active;
    }
    if (typeof body.name === "string" && body.name.trim().length > 0) {
      metadataPatch.name = body.name.trim();
    }

    if (!namespace && Object.keys(metadataPatch).length === 0) {
      return sendError(reply, 400, "bad_request", "namespace, active, or name is required");
    }

    const ok = await persistence.updateDocument({
      orgId,
      docId,
      namespace,
      metadataPatch: Object.keys(metadataPatch).length > 0 ? metadataPatch : undefined,
    });
    if (!ok) {
      return sendError(reply, 404, "not_found", "Document not found");
    }

    sendData(reply, { ok: true });
  });

  app.delete("/knowledge/documents/:docId", {
    preHandler: resolvedAuthHook(["admin", "editor"]),
  }, deleteDocumentHandler);

  // Compatibility alias for clients that cannot reliably send DELETE bodies/headers.
  app.post("/knowledge/documents/:docId/delete", {
    preHandler: resolvedAuthHook(["admin", "editor"]),
  }, deleteDocumentHandler);

  app.post<{
    Params: { docId: string };
  }>("/knowledge/documents/:docId/reingest", {
    preHandler: resolvedAuthHook(["admin", "editor"]),
  }, async (request, reply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as { orgId?: string }).orgId);
    if (!orgId) return;

    const docId = (request.params as { docId: string }).docId?.trim();
    if (!docId) {
      return sendError(reply, 400, "bad_request", "docId required");
    }

    const docResult = await query(
      "SELECT doc_id, namespace, text, metadata FROM kb_documents WHERE org_id = $1 AND doc_id = $2",
      [orgId, docId]
    );

    if (docResult.rows.length === 0) {
      return sendError(reply, 404, "not_found", "Document not found");
    }

    const doc = docResult.rows[0] as {
      doc_id: string;
      namespace: string;
      text: string;
      metadata: Record<string, unknown>;
    };

    if (!doc.text?.trim()) {
      return sendError(
        reply,
        400,
        "no_text",
        "No text stored for this document. Please re-upload the file."
      );
    }

    await query(
      `UPDATE kb_documents
       SET status = 'ingest_requested', embedded_chunks = 0, updated_at = now()
       WHERE org_id = $1 AND doc_id = $2`,
      [orgId, docId]
    );

    try {
      const store = getVectorStore();
      const chunks = chunkTextInline(doc.text);

      if (chunks.length === 0) {
        await query(
          `UPDATE kb_documents
           SET embedded_chunks = 0, status = 'embedded', updated_at = now()
           WHERE org_id = $1 AND doc_id = $2`,
          [orgId, docId]
        );
        return sendData(reply, { ok: true, docId: doc.doc_id, chunks: 0 });
      }

      await query("DELETE FROM kb_chunks WHERE doc_id = $1 AND org_id = $2", [docId, orgId]);

      const insertedCount = await store.upsertChunks({
        docId: doc.doc_id,
        orgId,
        namespace: doc.namespace,
        chunks: chunks.map((c) => ({
          index: c.index,
          text: c.text,
          metadata: { doc_id: doc.doc_id, ...doc.metadata },
        })),
      });

      await query(
        `UPDATE kb_documents
         SET embedded_chunks = $1, status = 'embedded', updated_at = now()
         WHERE org_id = $2 AND doc_id = $3`,
        [insertedCount, orgId, docId]
      );

      sendData(reply, { ok: true, docId: doc.doc_id, chunks: insertedCount });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await persistence.markDocumentFailed(orgId, docId, message).catch(() => {});
      return sendError(reply, 500, "embed_failed", `Embedding failed: ${message}`);
    }
  });
}
