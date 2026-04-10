import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { query } from "../persistence/dbClient";
import { sendData, sendError } from "../lib/responses";
import { authHook, resolvedAuthHook } from "../auth/jwt";
import { requireOrgForRequest } from "../auth/orgScope";


export function registerDeveloperRoutes(app: FastifyInstance) {
  app.get("/developer/api-keys", {
    preHandler: resolvedAuthHook(["admin"]),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;

    const result = await query(
      "SELECT id, name, prefix, status, created_at, last_used_at FROM api_keys WHERE org_id = $1 ORDER BY created_at DESC",
      [orgId]
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
