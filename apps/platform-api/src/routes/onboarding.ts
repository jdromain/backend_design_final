import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { query } from "../persistence/dbClient";
import { sendData, sendError } from "../lib/responses";
import { authHook, resolvedAuthHook } from "../auth/jwt";
import { requireOrgForRequest } from "../auth/orgScope";


export function registerOnboardingRoutes(app: FastifyInstance) {
  app.get("/onboarding", {
    preHandler: resolvedAuthHook(["admin", "editor", "viewer"]),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;

    const phoneNumbers = (await query(
      "SELECT COUNT(*)::int AS count FROM phone_numbers WHERE org_id = $1 AND status = 'active'",
      [orgId]
    )).rows[0]?.count ?? 0;

    const kbDocs = (await query(
      "SELECT COUNT(*)::int AS count FROM kb_documents WHERE org_id = $1",
      [orgId]
    )).rows[0]?.count ?? 0;

    const credentials = (await query(
      "SELECT COUNT(*)::int AS count FROM credentials WHERE org_id = $1",
      [orgId]
    )).rows[0]?.count ?? 0;

    const calls = (await query(
      "SELECT COUNT(*)::int AS count FROM calls WHERE org_id = $1",
      [orgId]
    )).rows[0]?.count ?? 0;

    const agentConfigs = (await query(
      "SELECT COUNT(*)::int AS count FROM agent_configs WHERE org_id = $1 AND status = 'published'",
      [orgId]
    )).rows[0]?.count ?? 0;

    const steps = [
      { id: "phone-number", label: "Add a phone number", completed: phoneNumbers > 0, order: 1 },
      { id: "kb-upload", label: "Upload knowledge base documents", completed: kbDocs > 0, order: 2 },
      { id: "credentials", label: "Save integration credentials", completed: credentials > 0, order: 3 },
      { id: "agent-publish", label: "Publish an agent", completed: agentConfigs > 0, order: 4 },
      { id: "test-call", label: "Make a test call", completed: calls > 0, order: 5 },
    ];

    sendData(reply, steps);
  });
}
