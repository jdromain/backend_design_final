import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { query } from "../persistence/dbClient";
import { sendData, sendError } from "../lib/responses";
import { authHook, resolvedAuthHook } from "../auth/jwt";
import { requireOrgForRequest } from "../auth/orgScope";


function mapKbStatus(status: string): "ready" | "processing" | "failed" | "uploading" {
  switch (status) {
    case "embedded": return "ready";
    case "processing": return "processing";
    case "failed": return "failed";
    case "ingest_requested": return "uploading";
    default: return "processing";
  }
}

export function registerKnowledgeRoutes(app: FastifyInstance) {
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
      return {
        id: r.doc_id,
        namespace: r.namespace,
        name: meta.name ?? meta.filename ?? r.doc_id,
        type: meta.type ?? "txt",
        sizeBytes: meta.sizeBytes ?? 0,
        status: mapKbStatus(resolvedStatus) === "ready" ? "ready"
              : mapKbStatus(resolvedStatus) === "failed" ? "failed" : "chunking",
        chunks: resolvedChunks,
        ingestedAt: r.ingested_at ?? r.created_at,
        updatedAt: r.updated_at ?? r.created_at,
      };
    });
    sendData(reply, { documents });
  });
}
