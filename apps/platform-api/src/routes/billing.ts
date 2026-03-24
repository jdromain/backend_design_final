import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { query } from "../persistence/dbClient";
import { sendData, sendError } from "../lib/responses";
import { authHook } from "../auth/jwt";

const isProduction = (process.env.NODE_ENV ?? "development") === "production";
const devNoOp = undefined;

function periodInterval(period?: string): string {
  switch (period) {
    case "7d": return "7 days";
    case "30d": return "30 days";
    case "90d": return "90 days";
    default: return "30 days";
  }
}

export function registerBillingRoutes(app: FastifyInstance) {
  const preHandler = isProduction ? authHook(["admin", "editor", "viewer"]) : devNoOp;

  app.get("/billing/usage", { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.auth?.tenant_id ?? (request.query as any).tenantId;
    const period = (request.query as any).period;
    if (!tenantId) return sendError(reply, 400, "missing_tenant", "tenantId required");

    const interval = periodInterval(period);

    const callStats = (await query(
      `SELECT
         COUNT(*)::int AS total_calls,
         COALESCE(SUM(duration_sec), 0)::int AS total_seconds,
         COALESCE(SUM(llm_tokens_in + llm_tokens_out), 0)::bigint AS total_tokens
       FROM calls
       WHERE tenant_id = $1 AND started_at > now() - $2::interval`,
      [tenantId, interval]
    )).rows[0];

    const agentCount = (await query(
      `SELECT COUNT(DISTINCT agent_config_id)::int AS count
       FROM calls WHERE tenant_id = $1 AND agent_config_id IS NOT NULL`,
      [tenantId]
    )).rows[0]?.count ?? 0;

    const kbSize = (await query(
      `SELECT COUNT(*)::int AS doc_count, COALESCE(SUM(embedded_chunks), 0)::int AS total_chunks
       FROM kb_documents WHERE tenant_id = $1`,
      [tenantId]
    )).rows[0];

    const plan = (await query(
      "SELECT * FROM plans WHERE tenant_id = $1 AND status = 'active' LIMIT 1",
      [tenantId]
    )).rows[0];

    sendData(reply, {
      totalMinutes: Math.ceil((callStats?.total_seconds ?? 0) / 60),
      totalCalls: callStats?.total_calls ?? 0,
      totalTokens: Number(callStats?.total_tokens ?? 0),
      agentCount,
      kbDocuments: kbSize?.doc_count ?? 0,
      kbChunks: kbSize?.total_chunks ?? 0,
      plan: plan ? {
        minutesIncluded: plan.monthly_minutes_included,
        costPerMinute: parseFloat(plan.cost_per_minute),
        concurrentCallsLimit: plan.concurrent_calls_limit,
      } : null,
    });
  });

  app.get("/billing/breakdown", { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.auth?.tenant_id ?? (request.query as any).tenantId;
    const period = (request.query as any).period;
    if (!tenantId) return sendError(reply, 400, "missing_tenant", "tenantId required");

    const interval = periodInterval(period);

    const result = (await query(
      `SELECT
         COALESCE(SUM(duration_sec), 0)::int AS telephony_seconds,
         COALESCE(SUM(llm_tokens_in), 0)::bigint AS tokens_in,
         COALESCE(SUM(llm_tokens_out), 0)::bigint AS tokens_out,
         COALESCE(SUM(tts_chars), 0)::bigint AS tts_chars,
         COALESCE(SUM(stt_seconds), 0)::numeric AS stt_seconds
       FROM calls
       WHERE tenant_id = $1 AND started_at > now() - $2::interval`,
      [tenantId, interval]
    )).rows[0];

    const toolInvocations = (await query(
      `SELECT COUNT(*)::int AS count
       FROM call_events WHERE tenant_id = $1 AND event_type = 'tool_called'
       AND occurred_at > now() - $2::interval`,
      [tenantId, interval]
    )).rows[0]?.count ?? 0;

    sendData(reply, {
      telephony: {
        minutes: Math.ceil((result?.telephony_seconds ?? 0) / 60),
        unitCost: 0.05,
        total: Math.ceil((result?.telephony_seconds ?? 0) / 60) * 0.05,
      },
      llm: {
        tokensIn: Number(result?.tokens_in ?? 0),
        tokensOut: Number(result?.tokens_out ?? 0),
        unitCost: 0.00003,
        total: (Number(result?.tokens_in ?? 0) + Number(result?.tokens_out ?? 0)) * 0.00003,
      },
      tts: {
        characters: Number(result?.tts_chars ?? 0),
        unitCost: 0.00003,
        total: Number(result?.tts_chars ?? 0) * 0.00003,
      },
      stt: {
        seconds: parseFloat(result?.stt_seconds ?? "0"),
        unitCost: 0.006,
        total: parseFloat(result?.stt_seconds ?? "0") * 0.006,
      },
      tools: {
        invocations: toolInvocations,
        unitCost: 0.001,
        total: toolInvocations * 0.001,
      },
    });
  });

  app.get("/billing/agents", { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.auth?.tenant_id ?? (request.query as any).tenantId;
    if (!tenantId) return sendError(reply, 400, "missing_tenant", "tenantId required");

    const result = await query(
      `SELECT
         agent_config_id,
         COUNT(*)::int AS total_calls,
         COALESCE(SUM(duration_sec), 0)::int AS total_seconds,
         COALESCE(SUM(llm_tokens_in + llm_tokens_out), 0)::bigint AS total_tokens
       FROM calls
       WHERE tenant_id = $1 AND agent_config_id IS NOT NULL
       GROUP BY agent_config_id`,
      [tenantId]
    );

    sendData(reply, result.rows.map((r: any) => ({
      agentId: r.agent_config_id,
      totalCalls: r.total_calls,
      totalMinutes: Math.ceil(r.total_seconds / 60),
      totalTokens: Number(r.total_tokens),
    })));
  });

  app.get("/billing/tools", { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.auth?.tenant_id ?? (request.query as any).tenantId;
    if (!tenantId) return sendError(reply, 400, "missing_tenant", "tenantId required");

    const result = await query(
      `SELECT
         payload->>'toolName' AS name,
         COUNT(*)::int AS invocations
       FROM call_events
       WHERE tenant_id = $1 AND event_type = 'tool_called' AND payload->>'toolName' IS NOT NULL
       GROUP BY payload->>'toolName'
       ORDER BY invocations DESC`,
      [tenantId]
    );

    sendData(reply, result.rows.map((r: any) => ({
      name: r.name,
      invocations: r.invocations,
      cost: r.invocations * 0.001,
    })));
  });

  app.get("/billing/invoices", { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.auth?.tenant_id ?? (request.query as any).tenantId;
    if (!tenantId) return sendError(reply, 400, "missing_tenant", "tenantId required");

    const result = await query(
      `SELECT
         date_trunc('month', recorded_at) AS month,
         COUNT(*)::int AS call_count,
         COALESCE(SUM(duration_seconds), 0)::int AS total_seconds,
         COALESCE(SUM(cost), 0)::numeric AS total_cost
       FROM usage_records
       WHERE tenant_id = $1
       GROUP BY month ORDER BY month DESC LIMIT 12`,
      [tenantId]
    );

    sendData(reply, result.rows.map((r: any, idx: number) => ({
      id: `inv-${tenantId}-${idx}`,
      period: new Date(r.month).toISOString().slice(0, 7),
      calls: r.call_count,
      minutes: Math.ceil(r.total_seconds / 60),
      total: parseFloat(r.total_cost),
      status: "paid",
    })));
  });
}
