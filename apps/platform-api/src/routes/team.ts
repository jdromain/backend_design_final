import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { query } from "../persistence/dbClient";
import { sendData, sendError } from "../lib/responses";
import { authHook, resolvedAuthHook } from "../auth/jwt";
import { requireOrgForRequest } from "../auth/orgScope";


export function registerTeamRoutes(app: FastifyInstance) {
  app.get("/team", {
    preHandler: resolvedAuthHook(["admin", "editor", "viewer"]),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;

    const result = await query(
      "SELECT * FROM users WHERE org_id = $1 ORDER BY created_at",
      [orgId]
    );

    sendData(reply, result.rows.map((r: any) => ({
      id: r.id,
      name: r.name ?? r.email,
      email: r.email,
      role: (r.roles ?? ["viewer"])[0],
      status: r.status ?? "active",
      lastActive: r.updated_at ?? r.created_at,
    })));
  });
}
