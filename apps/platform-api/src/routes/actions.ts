import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { query } from "../persistence/dbClient";
import { sendData, sendError } from "../lib/responses";
import { authHook, resolvedAuthHook } from "../auth/jwt";
import { requireOrgForRequest } from "../auth/orgScope";
import { getContacts, getFollowUps, getWorkflows, getTemplates } from "../persistence/actionsStore";


export function registerActionsRoutes(app: FastifyInstance) {
  const preHandler = resolvedAuthHook(["admin", "editor", "viewer"]);

  app.get("/contacts", { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;
    sendData(reply, await getContacts(orgId));
  });

  app.get("/actions/calls", { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;

    const result = await query(
      `SELECT * FROM calls WHERE org_id = $1 ORDER BY started_at DESC LIMIT 50`,
      [orgId]
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
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;
    sendData(reply, await getFollowUps(orgId));
  });

  app.get("/workflows", { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;
    sendData(reply, await getWorkflows(orgId));
  });

  app.get("/templates", { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;
    sendData(reply, await getTemplates(orgId));
  });
}
