import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { query } from "../persistence/dbClient";
import { sendData, sendError } from "../lib/responses";
import { authHook } from "../auth/jwt";

const isProduction = (process.env.NODE_ENV ?? "development") === "production";
const devNoOp = undefined;

export function registerDeveloperRoutes(app: FastifyInstance) {
  app.get("/developer/api-keys", {
    preHandler: isProduction ? authHook(["admin"]) : devNoOp,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.auth?.tenant_id ?? (request.query as any).tenantId;
    if (!tenantId) return sendError(reply, 400, "missing_tenant", "tenantId required");

    const result = await query(
      "SELECT id, name, prefix, status, created_at, last_used_at FROM api_keys WHERE tenant_id = $1 ORDER BY created_at DESC",
      [tenantId]
    );

    sendData(reply, result.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      prefix: r.prefix,
      created: r.created_at,
      lastUsed: r.last_used_at ?? r.created_at,
      status: r.status,
    })));
  });
}
