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
      "SELECT * FROM kb_documents WHERE org_id = $1 ORDER BY created_at DESC",
      [orgId]
    );

    const documents = result.rows.map((r: any) => {
      const meta = r.metadata ?? {};
      return {
        id: r.id,
        namespace: r.namespace,
        name: meta.name ?? meta.filename ?? r.doc_id,
        type: meta.type ?? "txt",
        sizeBytes: meta.sizeBytes ?? 0,
        status: mapKbStatus(r.status) === "ready" ? "ready"
              : mapKbStatus(r.status) === "failed" ? "failed" : "chunking",
        chunks: r.embedded_chunks ?? 0,
        ingestedAt: r.ingested_at ?? r.created_at,
        updatedAt: r.updated_at ?? r.created_at,
      };
    });
    sendData(reply, { documents });
  });
}
