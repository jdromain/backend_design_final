import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { query } from "../persistence/dbClient";
import { sendData, sendError } from "../lib/responses";
import { authHook } from "../auth/jwt";

const isProduction = (process.env.NODE_ENV ?? "development") === "production";
const devNoOp = undefined;

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
    preHandler: isProduction ? authHook(["admin", "editor", "viewer"]) : devNoOp,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.auth?.tenant_id ?? (request.query as any).tenantId;
    if (!tenantId) return sendError(reply, 400, "missing_tenant", "tenantId required");

    const result = await query(
      "SELECT * FROM kb_documents WHERE tenant_id = $1 ORDER BY created_at DESC",
      [tenantId]
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
