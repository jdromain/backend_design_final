import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { query } from "../persistence/dbClient";
import { sendData, sendError } from "../lib/responses";
import { authHook, resolvedAuthHook } from "../auth/jwt";
import { requireOrgForRequest } from "../auth/orgScope";
import { ConfigStore } from "../config/store";
import { AnalyticsSummaryEnvelopeSchema } from "../contracts/httpSchemas";


function mapOutcome(pg: string | null): string {
  switch (pg) {
    case "handled": return "completed";
    case "transferred": return "handoff";
    case "abandoned": return "dropped";
    case "failed": return "systemFailed";
    default: return "pending";
  }
}

export function registerAnalyticsRoutes(app: FastifyInstance, configStore: ConfigStore) {
  const preHandler = resolvedAuthHook(["admin", "editor", "viewer"]);

  app.get("/analytics/outcomes", { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;

    const result = await query(
      `SELECT date_trunc('hour', started_at) AS time, outcome, COUNT(*)::int AS count
       FROM calls
       WHERE org_id = $1 AND started_at > now() - interval '24 hours'
       GROUP BY time, outcome
       ORDER BY time`,
      [orgId]
    );

    const buckets = new Map<string, { time: string; pending: number; completed: number; handoff: number; dropped: number; systemFailed: number }>();
    for (const row of result.rows) {
      const t = new Date(row.time).toISOString();
      const bucket = buckets.get(t) ?? { time: t, pending: 0, completed: 0, handoff: 0, dropped: 0, systemFailed: 0 };
      const key = mapOutcome(row.outcome) as keyof typeof bucket;
      if (typeof bucket[key] === "number") {
        (bucket as any)[key] += row.count;
      }
      buckets.set(t, bucket);
    }

    sendData(reply, Array.from(buckets.values()));
  });

  app.get("/analytics/sparklines", { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;

    const result = await query(
      `SELECT date_trunc('hour', started_at) AS time,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'in_progress')::int AS active,
              COUNT(*) FILTER (WHERE outcome = 'handled')::int AS completed,
              COUNT(*) FILTER (WHERE outcome = 'failed')::int AS failed,
              COUNT(*) FILTER (WHERE outcome = 'transferred')::int AS handoff,
              COUNT(*) FILTER (WHERE outcome = 'abandoned')::int AS dropped
       FROM calls
       WHERE org_id = $1 AND started_at > now() - interval '24 hours'
       GROUP BY time ORDER BY time`,
      [orgId]
    );

    const latencyResult = await query(
      `SELECT date_trunc('hour', ce.occurred_at) AS time,
              AVG(EXTRACT(EPOCH FROM (ce.occurred_at - c.started_at)) * 1000)::int AS avg_latency
       FROM call_events ce JOIN calls c ON ce.call_id = c.call_id
       WHERE c.org_id = $1 AND ce.event_type = 'agent_spoke' AND ce.occurred_at > now() - interval '24 hours'
       GROUP BY time ORDER BY time`,
      [orgId]
    );

    const latencyMap = new Map<string, number>();
    for (const row of latencyResult.rows) {
      latencyMap.set(new Date(row.time).toISOString(), row.avg_latency ?? 0);
    }

    const sparklines = {
      totalCalls: result.rows.map((r: any) => r.total),
      activeCalls: result.rows.map((r: any) => r.active),
      completed: result.rows.map((r: any) => r.completed),
      failed: result.rows.map((r: any) => r.failed),
      handoff: result.rows.map((r: any) => r.handoff),
      dropped: result.rows.map((r: any) => r.dropped),
      latency: result.rows.map((r: any) => latencyMap.get(new Date(r.time).toISOString()) ?? 0),
    };

    sendData(reply, sparklines);
  });

  app.get("/analytics/intents", { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;

    const result = await query(
      `SELECT classified_intent AS label, COUNT(*)::int AS value
       FROM calls
       WHERE org_id = $1 AND classified_intent IS NOT NULL
       GROUP BY classified_intent ORDER BY value DESC LIMIT 10`,
      [orgId]
    );

    sendData(reply, result.rows);
  });

  app.get("/analytics/handoffs", { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;

    const result = await query(
      `SELECT end_reason AS label, COUNT(*)::int AS value
       FROM calls
       WHERE org_id = $1 AND outcome = 'transferred'
       GROUP BY end_reason ORDER BY value DESC LIMIT 10`,
      [orgId]
    );

    sendData(reply, result.rows);
  });

  app.get("/analytics/failures", { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;

    const result = await query(
      `SELECT COALESCE(NULLIF(failure_type, ''), end_reason, 'unknown') AS label, COUNT(*)::int AS value
       FROM calls
       WHERE org_id = $1 AND outcome = 'failed'
       GROUP BY COALESCE(NULLIF(failure_type, ''), end_reason, 'unknown') ORDER BY value DESC LIMIT 10`,
      [orgId]
    );

    sendData(reply, result.rows);
  });

  app.get("/analytics/tools", { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;

    const result = await query(
      `SELECT
         payload->>'toolName' AS name,
         COUNT(*)::int AS invocations,
         COUNT(*) FILTER (WHERE payload->>'result' = 'success')::int AS successes,
         COUNT(*) FILTER (WHERE payload->>'result' IN ('error','failed'))::int AS failures,
         AVG((payload->>'latencyMs')::numeric)::int AS avg_latency
       FROM call_events
       WHERE org_id = $1 AND event_type = 'tool_called' AND payload->>'toolName' IS NOT NULL
       GROUP BY payload->>'toolName'
       ORDER BY invocations DESC`,
      [orgId]
    );

    sendData(reply, result.rows.map((r: any) => ({
      name: r.name,
      invocations: r.invocations,
      successRate: r.invocations > 0 ? r.successes / r.invocations : 0,
      failures: r.failures,
      avgLatency: r.avg_latency ?? 0,
    })));
  });

  app.get("/analytics/agents", { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;

    const agg = (await query(
      `SELECT
         COUNT(*)::int AS total_calls,
         COUNT(*) FILTER (WHERE outcome = 'handled')::int AS handled,
         COUNT(*) FILTER (WHERE outcome = 'transferred')::int AS escalated,
         COUNT(*) FILTER (WHERE outcome = 'failed')::int AS failed,
         AVG(duration_sec)::int AS avg_duration
       FROM calls
       WHERE org_id = $1`,
      [orgId]
    )).rows[0] ?? { total_calls: 0, handled: 0, escalated: 0, failed: 0, avg_duration: 0 };

    const intentsResult = await query(
      `SELECT classified_intent AS name, COUNT(*)::int AS count
       FROM calls
       WHERE org_id = $1 AND classified_intent IS NOT NULL
       GROUP BY classified_intent ORDER BY count DESC LIMIT 5`,
      [orgId]
    );

    const totalCallsCount = Number(agg.total_calls) || 0;
    const topIntents = intentsResult.rows.map((r: any) => ({
      name: r.name,
      count: r.count,
      percentage:
        totalCallsCount > 0
          ? Math.round((r.count / totalCallsCount) * 1000) / 10
          : 0,
    }));

    const snapshot = await configStore.getSnapshot(orgId);
    const cfg = snapshot.agentConfig as { name?: string };
    const agentName = cfg.name ?? snapshot.agentConfig.id;

    sendData(reply, {
      name: agentName,
      version: `v${snapshot.version}`,
      totalCalls: agg.total_calls,
      handledRate:
        totalCallsCount > 0
          ? Math.round((agg.handled / totalCallsCount) * 1000) / 10
          : 0,
      escalationRate:
        totalCallsCount > 0
          ? Math.round((agg.escalated / totalCallsCount) * 1000) / 10
          : 0,
      failureRate:
        totalCallsCount > 0
          ? Math.round((agg.failed / totalCallsCount) * 1000) / 10
          : 0,
      avgDuration: agg.avg_duration ?? 0,
      topIntents,
    });
  });

  app.get("/analytics/insights", { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;

    const peakHour = await query(
      `SELECT EXTRACT(HOUR FROM started_at)::int AS hour, COUNT(*)::int AS count
       FROM calls WHERE org_id = $1 AND started_at > now() - interval '7 days'
       GROUP BY hour ORDER BY count DESC LIMIT 1`,
      [orgId]
    );

    const repeatCallers = await query(
      `SELECT caller_number, COUNT(*)::int AS count
       FROM calls WHERE org_id = $1 AND started_at > now() - interval '7 days'
       GROUP BY caller_number HAVING COUNT(*) > 1 ORDER BY count DESC LIMIT 5`,
      [orgId]
    );

    const insights = [];
    if (peakHour.rows.length > 0) {
      insights.push({
        label: `Peak hour: ${peakHour.rows[0].hour}:00`,
        value: peakHour.rows[0].count,
      });
    }
    if (repeatCallers.rows.length > 0) {
      insights.push({
        label: "Repeat callers (7d)",
        value: repeatCallers.rows.length,
      });
    }

    sendData(reply, insights);
  });

  /**
   * SQL-only dashboard summary (same semantics as client-side aggregate from /calls + live + tools).
   */
  app.get("/analytics/summary", {
    preHandler,
    schema: { response: { 200: AnalyticsSummaryEnvelopeSchema } },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;

    const aggRow = (
      await query(
        `SELECT
           COUNT(*)::int AS total_calls,
           COUNT(*) FILTER (WHERE outcome = 'handled')::int AS successful_calls,
           COUNT(*) FILTER (WHERE outcome = 'failed')::int AS failed_calls,
           COALESCE(SUM(duration_sec), 0)::bigint AS total_duration_sec
         FROM calls
         WHERE org_id = $1`,
        [orgId]
      )
    ).rows[0] ?? {
      total_calls: 0,
      successful_calls: 0,
      failed_calls: 0,
      total_duration_sec: "0",
    };

    const liveRow = (
      await query(
        `SELECT COUNT(*)::int AS active_now
         FROM calls
         WHERE org_id = $1
           AND status IN ('initiated', 'ringing', 'in_progress')`,
        [orgId]
      )
    ).rows[0] ?? { active_now: 0 };

    const toolRow = (
      await query(
        `SELECT COUNT(*)::int AS tool_invocations
         FROM call_events
         WHERE org_id = $1 AND event_type = 'tool_called'`,
        [orgId]
      )
    ).rows[0] ?? { tool_invocations: 0 };

    const totalCalls = Number(aggRow.total_calls) || 0;
    const successfulCalls = Number(aggRow.successful_calls) || 0;
    const failedCalls = Number(aggRow.failed_calls) || 0;
    const totalDurationSec = Number(aggRow.total_duration_sec) || 0;

    sendData(reply, {
      totalCalls,
      successfulCalls,
      failedCalls,
      averageDurationMs: totalCalls > 0 ? (totalDurationSec * 1000) / totalCalls : 0,
      successRate: totalCalls > 0 ? successfulCalls / totalCalls : 0,
      activeNow: Number(liveRow.active_now) || 0,
      toolInvocations: Number(toolRow.tool_invocations) || 0,
    });
  });
}
