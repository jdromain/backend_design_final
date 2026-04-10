import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { sendData, sendError } from "../lib/responses";
import { authHook, resolvedAuthHook } from "../auth/jwt";
import { requireOrgForRequest } from "../auth/orgScope";
import { ConfigStore } from "../config/store";


export function registerToolRoutes(app: FastifyInstance, configStore: ConfigStore) {
  app.get("/tools", {
    preHandler: resolvedAuthHook(["admin", "editor", "viewer"]),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;

    const snapshot = await configStore.getSnapshot(orgId);
    const tools: string[] = ((snapshot.agentConfig as any).toolAccess ?? []).sort();
    sendData(reply, tools);
  });
}
