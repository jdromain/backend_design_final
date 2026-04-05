import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { sendData, sendError } from "../lib/responses";
import { authHook, resolvedAuthHook } from "../auth/jwt";
import { requireTenantForRequest } from "../auth/tenantScope";
import { ConfigStore } from "../config/store";


export function registerToolRoutes(app: FastifyInstance, configStore: ConfigStore) {
  app.get("/tools", {
    preHandler: resolvedAuthHook(["admin", "editor", "viewer"]),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = requireTenantForRequest(request, reply, (request.query as any).tenantId);
    if (!tenantId) return;

    const snapshot = await configStore.getSnapshot(tenantId);
    const tools: string[] = ((snapshot.agentConfig as any).toolAccess ?? []).sort();
    sendData(reply, tools);
  });
}
