import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { sendData, sendError } from "../lib/responses";
import { authHook } from "../auth/jwt";
import { ConfigStore } from "../config/store";
import { query } from "../persistence/dbClient";

const isProduction = (process.env.NODE_ENV ?? "development") === "production";
const devNoOp = undefined;

export function registerAgentRoutes(app: FastifyInstance, configStore: ConfigStore) {
  const preHandler = isProduction ? authHook(["admin", "editor", "viewer"]) : devNoOp;

  app.get("/agents", { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.auth?.tenant_id ?? (request.query as any).tenantId;
    if (!tenantId) return sendError(reply, 400, "missing_tenant", "tenantId required");

    const snapshot = await configStore.getSnapshot(tenantId);
    const agentConfig = snapshot.agentConfig;

    const metricsResult = await query(
      `SELECT
         agent_config_id,
         COUNT(*)::int AS total_calls,
         COUNT(*) FILTER (WHERE outcome = 'handled')::int AS handled,
         COUNT(*) FILTER (WHERE outcome = 'transferred')::int AS escalated,
         COUNT(*) FILTER (WHERE outcome = 'failed')::int AS failed,
         AVG(duration_sec)::int AS avg_duration
       FROM calls
       WHERE tenant_id = $1 AND agent_config_id IS NOT NULL
       GROUP BY agent_config_id`,
      [tenantId]
    );
    const metricsMap = new Map<string, any>();
    for (const row of metricsResult.rows) {
      metricsMap.set(row.agent_config_id, row);
    }

    const m = metricsMap.get(agentConfig.id) ?? { total_calls: 0, handled: 0, escalated: 0, failed: 0, avg_duration: 0 };

    const agents = [{
      id: agentConfig.id,
      name: agentConfig.name ?? agentConfig.id,
      description: (agentConfig as any).persona?.role ?? "AI Voice Agent",
      status: snapshot.status === "published" ? "active" : "draft",
      type: "general",
      version: String(snapshot.version),
      phoneLines: snapshot.phoneNumbers.map((p: any) => p.did),
      knowledgeBase: [] as string[],
      tools: (agentConfig as any).toolAccess ?? [],
      metrics: {
        totalCalls: m.total_calls,
        handledRate: m.total_calls > 0 ? m.handled / m.total_calls : 0,
        escalationRate: m.total_calls > 0 ? m.escalated / m.total_calls : 0,
        failureRate: m.total_calls > 0 ? m.failed / m.total_calls : 0,
        avgDuration: m.avg_duration ?? 0,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }];

    sendData(reply, agents);
  });

  app.get("/agents/:agentId", { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.auth?.tenant_id ?? (request.query as any).tenantId;
    const { agentId } = request.params as { agentId: string };
    if (!tenantId) return sendError(reply, 400, "missing_tenant", "tenantId required");

    const snapshot = await configStore.getSnapshot(tenantId);
    const agentConfig = snapshot.agentConfig;

    if (agentConfig.id !== agentId) {
      return sendError(reply, 404, "not_found", "Agent not found");
    }

    const m = (await query(
      `SELECT COUNT(*)::int AS total_calls,
              COUNT(*) FILTER (WHERE outcome = 'handled')::int AS handled,
              COUNT(*) FILTER (WHERE outcome = 'transferred')::int AS escalated,
              COUNT(*) FILTER (WHERE outcome = 'failed')::int AS failed,
              AVG(duration_sec)::int AS avg_duration
       FROM calls WHERE tenant_id = $1 AND agent_config_id = $2`,
      [tenantId, agentId]
    )).rows[0] ?? { total_calls: 0, handled: 0, escalated: 0, failed: 0, avg_duration: 0 };

    sendData(reply, {
      id: agentConfig.id,
      name: agentConfig.name ?? agentConfig.id,
      description: (agentConfig as any).persona?.role ?? "AI Voice Agent",
      status: snapshot.status === "published" ? "active" : "draft",
      type: "general",
      version: String(snapshot.version),
      phoneLines: snapshot.phoneNumbers.map((p: any) => p.did),
      knowledgeBase: [],
      tools: (agentConfig as any).toolAccess ?? [],
      metrics: {
        totalCalls: m.total_calls,
        handledRate: m.total_calls > 0 ? m.handled / m.total_calls : 0,
        escalationRate: m.total_calls > 0 ? m.escalated / m.total_calls : 0,
        failureRate: m.total_calls > 0 ? m.failed / m.total_calls : 0,
        avgDuration: m.avg_duration ?? 0,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });
}
