import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { query } from "../persistence/dbClient";
import { sendData, sendError } from "../lib/responses";
import { authHook, optionalAuthHook } from "../auth/jwt";

const isProduction = (process.env.NODE_ENV ?? "development") === "production";

export function registerNotificationRoutes(app: FastifyInstance) {
  app.get("/notifications", {
    preHandler: isProduction ? authHook(["admin", "editor", "viewer"]) : optionalAuthHook(),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.auth?.tenant_id ?? (request.query as any).tenantId;
    if (!tenantId) return sendError(reply, 400, "missing_tenant", "tenantId required");

    const result = await query(
      "SELECT * FROM notifications WHERE tenant_id = $1 ORDER BY timestamp DESC LIMIT 50",
      [tenantId]
    );

    sendData(reply, result.rows.map((r: any) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      message: r.message,
      read: r.read,
      timestamp: r.timestamp,
      actionUrl: r.action_url,
    })));
  });
}
