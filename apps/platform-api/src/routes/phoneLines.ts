import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { callStore } from "../persistence/callStore";
import { sendData, sendError } from "../lib/responses";
import { authHook } from "../auth/jwt";

const isProduction = (process.env.NODE_ENV ?? "development") === "production";
const devNoOp = undefined;

export function registerPhoneLineRoutes(app: FastifyInstance) {
  app.get("/phone-lines", {
    preHandler: isProduction ? authHook(["admin", "editor", "viewer"]) : devNoOp,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.auth?.tenant_id ?? (request.query as any).tenantId;
    if (!tenantId) return sendError(reply, 400, "missing_tenant", "tenantId required");

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
