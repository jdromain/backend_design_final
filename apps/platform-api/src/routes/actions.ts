import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { randomUUID } from "crypto";
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

  app.post("/follow-ups", { preHandler: resolvedAuthHook(["admin", "editor"]) }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;
    const body = (request.body ?? {}) as {
      callId?: string;
      contactId?: string | null;
      type?: string;
      priority?: number;
      dueAt?: string;
      notes?: string;
      ownerId?: string | null;
    };
    const callId = typeof body.callId === "string" ? body.callId : "";
    const type = typeof body.type === "string" ? body.type : "general";
    if (!callId) return sendError(reply, 400, "bad_request", "callId is required");

    const allowedTypes = new Set([
      "missed_call", "booking", "estimate_approval", "ready_pickup", "payment_pending",
      "large_party", "catering", "complaint", "reservation", "order_issue", "general",
    ]);
    const followUpType = allowedTypes.has(type) ? type : "general";
    const priority = Number.isFinite(body.priority) ? Number(body.priority) : 1;
    const dueAt = body.dueAt ? new Date(body.dueAt) : null;

    const result = await query(
      `INSERT INTO follow_ups (
         id, org_id, contact_id, call_id, type, status, priority, severity, owner_id, due_at, notes, vertical
       ) VALUES ($1,$2,$3,$4,$5,'open',$6,'medium',$7,$8,$9,'Common')
       RETURNING id`,
      [
        randomUUID(),
        orgId,
        body.contactId ?? null,
        callId,
        followUpType,
        priority,
        body.ownerId ?? null,
        dueAt ? dueAt.toISOString() : null,
        body.notes ?? null,
      ],
    );
    sendData(reply, { ok: true, id: result.rows[0]?.id });
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
