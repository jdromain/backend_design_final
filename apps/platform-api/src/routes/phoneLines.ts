import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { callStore } from "../persistence/callStore";
import { sendData, sendError } from "../lib/responses";
import { authHook, resolvedAuthHook } from "../auth/jwt";
import { requireTenantForRequest } from "../auth/tenantScope";


export function registerPhoneLineRoutes(app: FastifyInstance) {
  app.get("/phone-lines", {
    preHandler: resolvedAuthHook(["admin", "editor", "viewer"]),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = requireTenantForRequest(request, reply, (request.query as any).tenantId);
    if (!tenantId) return;

    const numbers = await callStore.getPhoneNumbersByTenant(tenantId);

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
