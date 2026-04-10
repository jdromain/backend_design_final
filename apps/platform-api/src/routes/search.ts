import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { query } from "../persistence/dbClient";
import { sendData, sendError } from "../lib/responses";
import { authHook, resolvedAuthHook } from "../auth/jwt";
import { requireOrgForRequest } from "../auth/orgScope";


export function registerSearchRoutes(app: FastifyInstance) {
  app.get("/search", {
    preHandler: resolvedAuthHook(["admin", "editor", "viewer"]),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;
    const q = ((request.query as any).q ?? "").trim();
    if (!q) return sendData(reply, { calls: [], contacts: [], followUps: [], workflows: [], kbDocs: [], users: [], agents: [], integrations: [] });

    const pattern = `%${q}%`;

    const [calls, contacts, followUps, workflows, documents, users] = await Promise.all([
      query(
        `SELECT call_id, caller_number, classified_intent, started_at FROM calls
         WHERE org_id = $1 AND (caller_number ILIKE $2 OR classified_intent ILIKE $2 OR summary ILIKE $2)
         LIMIT 10`,
        [orgId, pattern]
      ),
      query(
        `SELECT id, name, phone, email FROM contacts
         WHERE org_id = $1 AND (name ILIKE $2 OR phone ILIKE $2 OR email ILIKE $2)
         LIMIT 10`,
        [orgId, pattern]
      ),
      query(
        `SELECT id, type, status, notes FROM follow_ups
         WHERE org_id = $1 AND (type ILIKE $2 OR notes ILIKE $2)
         LIMIT 10`,
        [orgId, pattern]
      ),
      query(
        `SELECT id, name, trigger_key FROM workflows
         WHERE org_id = $1 AND (name ILIKE $2 OR trigger_key ILIKE $2)
         LIMIT 10`,
        [orgId, pattern]
      ),
      query(
        `SELECT id, doc_id, namespace FROM kb_documents
         WHERE org_id = $1 AND (doc_id ILIKE $2 OR namespace ILIKE $2)
         LIMIT 10`,
        [orgId, pattern]
      ),
      query(
        `SELECT id, name, email FROM users
         WHERE org_id = $1 AND (name ILIKE $2 OR email ILIKE $2)
         LIMIT 10`,
        [orgId, pattern]
      ),
    ]);

    sendData(reply, {
      calls: calls.rows,
      contacts: contacts.rows,
      followUps: followUps.rows,
      workflows: workflows.rows,
      kbDocs: documents.rows,
      users: users.rows,
      agents: [],
      integrations: [],
    });
  });
}
