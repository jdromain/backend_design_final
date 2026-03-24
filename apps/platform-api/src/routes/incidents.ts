import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { query } from "../persistence/dbClient";
import { sendData, sendError } from "../lib/responses";
import { authHook } from "../auth/jwt";

const isProduction = (process.env.NODE_ENV ?? "development") === "production";
const devNoOp = undefined;

export function registerIncidentRoutes(app: FastifyInstance) {
  app.get("/incidents", {
    preHandler: isProduction ? authHook(["admin", "editor", "viewer"]) : devNoOp,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.auth?.tenant_id ?? (request.query as any).tenantId;
    if (!tenantId) return sendError(reply, 400, "missing_tenant", "tenantId required");

    const incidents: any[] = [];

    const recentFailures = (await query(
      `SELECT COUNT(*)::int AS count FROM calls
       WHERE tenant_id = $1 AND outcome = 'failed' AND started_at > now() - interval '1 hour'`,
      [tenantId]
    )).rows[0];

    if (recentFailures.count > 0) {
      incidents.push({
        id: "inc-failures",
        severity: recentFailures.count >= 5 ? "critical" : "warning",
        title: `${recentFailures.count} failed call(s) in the last hour`,
        description: "Calls are failing -- check agent config and external services.",
        detectedAt: new Date().toISOString(),
        status: "active",
      });
    }

    const recentTotal = (await query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE outcome = 'transferred')::int AS handoffs
       FROM calls
       WHERE tenant_id = $1 AND started_at > now() - interval '1 hour'`,
      [tenantId]
    )).rows[0];

    if (recentTotal.total > 5 && recentTotal.handoffs / recentTotal.total > 0.5) {
      incidents.push({
        id: "inc-handoff-rate",
        severity: "warning",
        title: "Elevated handoff rate (>50%)",
        description: `${recentTotal.handoffs} of ${recentTotal.total} calls escalated in the last hour.`,
        detectedAt: new Date().toISOString(),
        status: "active",
      });
    }

    const toolTimeouts = (await query(
      `SELECT COUNT(*)::int AS count FROM call_events
       WHERE tenant_id = $1 AND event_type = 'tool_called'
       AND (payload->>'result' = 'error' OR payload->>'result' = 'failed')
       AND occurred_at > now() - interval '1 hour'`,
      [tenantId]
    )).rows[0];

    if (toolTimeouts.count > 3) {
      incidents.push({
        id: "inc-tool-errors",
        severity: "warning",
        title: `${toolTimeouts.count} tool errors in the last hour`,
        description: "External tool integrations are failing. Check credentials and connectivity.",
        detectedAt: new Date().toISOString(),
        status: "active",
      });
    }

    sendData(reply, incidents);
  });
}
