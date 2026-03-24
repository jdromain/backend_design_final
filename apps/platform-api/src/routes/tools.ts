import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { sendData, sendError } from "../lib/responses";
import { authHook } from "../auth/jwt";
import { ConfigStore } from "../config/store";

const isProduction = (process.env.NODE_ENV ?? "development") === "production";
const devNoOp = undefined;

export function registerToolRoutes(app: FastifyInstance, configStore: ConfigStore) {
  app.get("/tools", {
    preHandler: isProduction ? authHook(["admin", "editor", "viewer"]) : devNoOp,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.auth?.tenant_id ?? (request.query as any).tenantId;
    if (!tenantId) return sendError(reply, 400, "missing_tenant", "tenantId required");

    const snapshot = await configStore.getSnapshot(tenantId);
    const tools: string[] = ((snapshot.agentConfig as any).toolAccess ?? []).sort();
    sendData(reply, tools);
  });
}
