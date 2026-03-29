import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { query } from "../persistence/dbClient";
import { sendData, sendError } from "../lib/responses";
import { authHook, optionalAuthHook } from "../auth/jwt";
import { getContacts, getFollowUps, getWorkflows, getTemplates } from "../persistence/actionsStore";

const isProduction = (process.env.NODE_ENV ?? "development") === "production";

export function registerActionsRoutes(app: FastifyInstance) {
  const preHandler = isProduction ? authHook(["admin", "editor", "viewer"]) : optionalAuthHook();

  app.get("/contacts", { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.auth?.tenant_id ?? (request.query as any).tenantId;
    if (!tenantId) return sendError(reply, 400, "missing_tenant", "tenantId required");
    sendData(reply, await getContacts(tenantId));
  });

  app.get("/actions/calls", { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.auth?.tenant_id ?? (request.query as any).tenantId;
    if (!tenantId) return sendError(reply, 400, "missing_tenant", "tenantId required");

    const result = await query(
      `SELECT * FROM calls WHERE tenant_id = $1 ORDER BY started_at DESC LIMIT 50`,
      [tenantId]
    );

    const mapped = result.rows.map((row: any) => ({
      id: row.call_id,
      contactId: row.caller_number,
      time: row.started_at,
      agentId: row.agent_config_id ?? "default",
      lineId: row.phone_number,
      direction: row.direction ?? "inbound",
      outcome: row.outcome ?? "pending",
      endReason: row.end_reason,
      durationSec: row.duration_sec ?? 0,
      summary: row.summary,
      intent: row.classified_intent,
      sentiment: null,
      extractedFields: row.slots_collected ?? {},
      transcriptStatus: row.status === "completed" ? "available" : "processing",
    }));

    sendData(reply, mapped);
  });

  app.get("/follow-ups", { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.auth?.tenant_id ?? (request.query as any).tenantId;
    if (!tenantId) return sendError(reply, 400, "missing_tenant", "tenantId required");
    sendData(reply, await getFollowUps(tenantId));
  });

  app.get("/workflows", { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.auth?.tenant_id ?? (request.query as any).tenantId;
    if (!tenantId) return sendError(reply, 400, "missing_tenant", "tenantId required");
    sendData(reply, await getWorkflows(tenantId));
  });

  app.get("/templates", { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.auth?.tenant_id ?? (request.query as any).tenantId;
    if (!tenantId) return sendError(reply, 400, "missing_tenant", "tenantId required");
    sendData(reply, await getTemplates(tenantId));
  });
}
