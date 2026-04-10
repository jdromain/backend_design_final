import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { sendData, sendError } from "../lib/responses";
import { authHook, resolvedAuthHook } from "../auth/jwt";
import { requireOrgForRequest } from "../auth/orgScope";
import { ConfigStore } from "../config/store";
import { query } from "../persistence/dbClient";


export function registerAgentRoutes(app: FastifyInstance, configStore: ConfigStore) {
  const preHandler = resolvedAuthHook(["admin", "editor", "viewer"]);

  app.get("/agents", { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;

    const snapshot = await configStore.getSnapshot(orgId);
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
       WHERE org_id = $1 AND agent_config_id IS NOT NULL
       GROUP BY agent_config_id`,
      [orgId]
    );
    const metricsMap = new Map<string, any>();
    for (const row of metricsResult.rows) {
      metricsMap.set(row.agent_config_id, row);
    }

    const m = metricsMap.get(agentConfig.id) ?? { total_calls: 0, handled: 0, escalated: 0, failed: 0, avg_duration: 0 };

    const cfgName = (agentConfig as { name?: string }).name;

    const agents = [{
      id: agentConfig.id,
      name: cfgName ?? agentConfig.id,
      description: agentConfig.persona,
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
    }];

    sendData(reply, agents);
  });

  app.get("/agents/:agentId", { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;
    const { agentId } = request.params as { agentId: string };

    const snapshot = await configStore.getSnapshot(orgId);
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
       FROM calls WHERE org_id = $1 AND agent_config_id = $2`,
      [orgId, agentId]
    )).rows[0] ?? { total_calls: 0, handled: 0, escalated: 0, failed: 0, avg_duration: 0 };

    sendData(reply, {
      id: agentConfig.id,
      name: (agentConfig as { name?: string }).name ?? agentConfig.id,
      description: agentConfig.persona,
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
    });
  });
}
