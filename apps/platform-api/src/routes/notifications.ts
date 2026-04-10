import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { query } from "../persistence/dbClient";
import { sendData, sendError } from "../lib/responses";
import { authHook, resolvedAuthHook } from "../auth/jwt";
import { requireOrgForRequest } from "../auth/orgScope";


export function registerNotificationRoutes(app: FastifyInstance) {
  app.get("/notifications", {
    preHandler: resolvedAuthHook(["admin", "editor", "viewer"]),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;

    const result = await query(
      "SELECT * FROM notifications WHERE org_id = $1 ORDER BY timestamp DESC LIMIT 50",
      [orgId]
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
