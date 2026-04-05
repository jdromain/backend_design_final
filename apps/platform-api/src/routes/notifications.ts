import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { query } from "../persistence/dbClient";
import { sendData, sendError } from "../lib/responses";
import { authHook, resolvedAuthHook } from "../auth/jwt";
import { requireTenantForRequest } from "../auth/tenantScope";


export function registerNotificationRoutes(app: FastifyInstance) {
  app.get("/notifications", {
    preHandler: resolvedAuthHook(["admin", "editor", "viewer"]),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = requireTenantForRequest(request, reply, (request.query as any).tenantId);
    if (!tenantId) return;

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
