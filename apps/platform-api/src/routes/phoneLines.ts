import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { callStore } from "../persistence/callStore";
import { sendData, sendError } from "../lib/responses";
import { authHook, resolvedAuthHook } from "../auth/jwt";
import { requireOrgForRequest } from "../auth/orgScope";


export function registerPhoneLineRoutes(app: FastifyInstance) {
  app.get("/phone-lines", {
    preHandler: resolvedAuthHook(["admin", "editor", "viewer"]),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;

    const numbers = await callStore.getPhoneNumbersByOrganization(orgId);

    const mapped = numbers.map((n) => ({
      id: n.id ?? n.phoneNumber,
      number: n.phoneNumber,
      name: n.displayName ?? n.phoneNumber,
      routeType: n.routeType,
      status: n.status,
      agentConfigId: n.agentConfigId,
    }));

    sendData(reply, mapped);
  });
}
