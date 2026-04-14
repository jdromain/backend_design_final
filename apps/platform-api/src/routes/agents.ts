import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { sendData, sendError } from "../lib/responses";
import { authHook, resolvedAuthHook } from "../auth/jwt";
import { requireOrgForRequest } from "../auth/orgScope";
import { ConfigStore } from "../config/store";
import { query } from "../persistence/dbClient";


export function registerAgentRoutes(app: FastifyInstance, configStore: ConfigStore) {
  const preHandler = resolvedAuthHook(["admin", "editor", "viewer"]);
  const writePreHandler = resolvedAuthHook(["admin", "editor"]);

  function mapAgentType(persona: string): "booking" | "support" | "sales" | "custom" {
    if (persona === "scheduler") return "booking";
    if (persona === "support") return "support";
    return "custom";
  }

  function buildAgentDetail(snapshot: Awaited<ReturnType<ConfigStore["getSnapshot"]>>) {
    const agentConfig = snapshot.agentConfig as typeof snapshot.agentConfig & {
      name?: string;
      description?: string;
      temperature?: number;
      maxTokens?: number;
      voice?: string;
      silenceTimeout?: number;
      interruptionSensitivity?: number;
    };

    return {
      id: agentConfig.id,
      name: agentConfig.name ?? agentConfig.id,
      description: agentConfig.description ?? agentConfig.persona,
      systemPrompt: agentConfig.basePrompt,
      temperature: agentConfig.temperature ?? 0.7,
      maxTokens: agentConfig.maxTokens ?? 1024,
      voice: agentConfig.voice ?? "alloy",
      silenceTimeout: agentConfig.silenceTimeout ?? 5,
      interruptionSensitivity: agentConfig.interruptionSensitivity ?? 0.5,
      version: agentConfig.version,
      persona: agentConfig.persona,
      toolAccess: agentConfig.toolAccess ?? [],
      phoneNumbers: snapshot.phoneNumbers.map((p: any) => ({
        number: p.did,
        businessId: p.businessId,
      })),
      kbNamespace: agentConfig.kbNamespace ?? "",
      status: snapshot.status === "published" ? "active" : "draft",
      agentType: mapAgentType(agentConfig.persona),
    };
  }

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
    const kbNamespace = (agentConfig as { kbNamespace?: string }).kbNamespace;

    const agents = [{
      id: agentConfig.id,
      name: cfgName ?? agentConfig.id,
      description: agentConfig.persona,
      status: snapshot.status === "published" ? "active" : "draft",
      type: "general",
      version: String(snapshot.version),
      phoneLines: snapshot.phoneNumbers.map((p: any) => p.did),
      knowledgeBase: kbNamespace ? [kbNamespace] : [],
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

    sendData(reply, buildAgentDetail(snapshot));
  });

  app.patch("/agents/:agentId", { preHandler: writePreHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;
    const { agentId } = request.params as { agentId: string };

    const snapshot = await configStore.getSnapshot(orgId);
    if (snapshot.agentConfig.id !== agentId) {
      return sendError(reply, 404, "not_found", "Agent not found");
    }

    const body = (request.body ?? {}) as Partial<{
      name: string;
      description: string;
      systemPrompt: string;
      temperature: number;
      maxTokens: number;
      voice: string;
      silenceTimeout: number;
      interruptionSensitivity: number;
      kbNamespace: string;
      toolAccess: string[];
      persona: "receptionist" | "scheduler" | "support";
    }>;

    const existing = snapshot.agentConfig as typeof snapshot.agentConfig & {
      name?: string;
      description?: string;
      temperature?: number;
      maxTokens?: number;
      voice?: string;
      silenceTimeout?: number;
      interruptionSensitivity?: number;
    };

    const nextAgentConfig = {
      ...snapshot.agentConfig,
      version: snapshot.agentConfig.version + 1,
      basePrompt:
        typeof body.systemPrompt === "string" && body.systemPrompt.trim().length > 0
          ? body.systemPrompt
          : snapshot.agentConfig.basePrompt,
      kbNamespace:
        typeof body.kbNamespace === "string" && body.kbNamespace.trim().length > 0
          ? body.kbNamespace.trim()
          : snapshot.agentConfig.kbNamespace,
      toolAccess: Array.isArray(body.toolAccess)
        ? body.toolAccess.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
        : snapshot.agentConfig.toolAccess,
      persona: body.persona ?? snapshot.agentConfig.persona,
    } as typeof snapshot.agentConfig & {
      name?: string;
      description?: string;
      temperature?: number;
      maxTokens?: number;
      voice?: string;
      silenceTimeout?: number;
      interruptionSensitivity?: number;
    };

    if (typeof body.name === "string" && body.name.trim().length > 0) {
      nextAgentConfig.name = body.name.trim();
    } else if (existing.name) {
      nextAgentConfig.name = existing.name;
    }

    if (typeof body.description === "string" && body.description.trim().length > 0) {
      nextAgentConfig.description = body.description.trim();
    } else if (existing.description) {
      nextAgentConfig.description = existing.description;
    }

    if (typeof body.temperature === "number") {
      nextAgentConfig.temperature = body.temperature;
    } else if (typeof existing.temperature === "number") {
      nextAgentConfig.temperature = existing.temperature;
    }

    if (typeof body.maxTokens === "number") {
      nextAgentConfig.maxTokens = body.maxTokens;
    } else if (typeof existing.maxTokens === "number") {
      nextAgentConfig.maxTokens = existing.maxTokens;
    }

    if (typeof body.voice === "string" && body.voice.trim().length > 0) {
      nextAgentConfig.voice = body.voice.trim();
    } else if (existing.voice) {
      nextAgentConfig.voice = existing.voice;
    }

    if (typeof body.silenceTimeout === "number") {
      nextAgentConfig.silenceTimeout = body.silenceTimeout;
    } else if (typeof existing.silenceTimeout === "number") {
      nextAgentConfig.silenceTimeout = existing.silenceTimeout;
    }

    if (typeof body.interruptionSensitivity === "number") {
      nextAgentConfig.interruptionSensitivity = body.interruptionSensitivity;
    } else if (typeof existing.interruptionSensitivity === "number") {
      nextAgentConfig.interruptionSensitivity = existing.interruptionSensitivity;
    }

    configStore.upsertConfig({
      orgId,
      agentConfig: nextAgentConfig,
      phoneNumbers: snapshot.phoneNumbers,
      plan: snapshot.plan,
      status: snapshot.status,
    });

    const updatedSnapshot = await configStore.getSnapshot(orgId);
    sendData(reply, buildAgentDetail(updatedSnapshot));
  });
}
