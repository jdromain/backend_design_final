import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { query } from "../persistence/dbClient";
import { sendData } from "../lib/responses";
import { authHook, resolvedAuthHook } from "../auth/jwt";
import { requireTenantForRequest } from "../auth/tenantScope";


export function registerActivityRoutes(app: FastifyInstance) {
  app.get("/activity", {
    preHandler: resolvedAuthHook(["admin", "editor", "viewer"]),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = requireTenantForRequest(request, reply, (request.query as any).tenantId);
    if (!tenantId) return;

    const events = await query(
      `SELECT id, event_type AS type, payload, occurred_at AS timestamp
       FROM call_events
       WHERE tenant_id = $1
       ORDER BY occurred_at DESC LIMIT 30`,
      [tenantId]
    );

    const notifications = await query(
      `SELECT id, type, title AS message, timestamp
       FROM notifications
       WHERE tenant_id = $1
       ORDER BY timestamp DESC LIMIT 20`,
      [tenantId]
    );

    const feed = [
      ...events.rows.map((e: any) => ({
        id: e.id,
        severity: "info",
        type: e.type,
        message: e.type.replace(/_/g, " "),
        timestamp: e.timestamp,
      })),
      ...notifications.rows.map((n: any) => ({
        id: n.id,
        severity: n.type === "error" ? "error" : n.type === "warning" ? "warning" : "info",
        type: "notification",
        message: n.message,
        timestamp: n.timestamp,
      })),
    ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
     .slice(0, 50);

    sendData(reply, feed);
  });
}
