import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { query } from "../persistence/dbClient";
import { sendData, sendError } from "../lib/responses";
import { authHook, optionalAuthHook } from "../auth/jwt";

const isProduction = (process.env.NODE_ENV ?? "development") === "production";

export function registerTeamRoutes(app: FastifyInstance) {
  app.get("/team", {
    preHandler: isProduction ? authHook(["admin", "editor", "viewer"]) : optionalAuthHook(),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.auth?.tenant_id ?? (request.query as any).tenantId;
    if (!tenantId) return sendError(reply, 400, "missing_tenant", "tenantId required");

    const result = await query(
      "SELECT * FROM users WHERE tenant_id = $1 ORDER BY created_at",
      [tenantId]
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
