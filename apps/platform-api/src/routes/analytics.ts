import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { query } from "../persistence/dbClient";
import { sendData, sendError } from "../lib/responses";
import { authHook, resolvedAuthHook } from "../auth/jwt";
import { requireOrgForRequest } from "../auth/orgScope";
import { ConfigStore } from "../config/store";
import { callStore } from "../persistence/callStore";
import { AnalyticsSummaryEnvelopeSchema } from "../contracts/httpSchemas";
import { mapOutcomeToUiResult, normalizeEndReasonLabel } from "../lib/callTaxonomy";

type TimeWindow = { start: Date; end: Date };

function parseTimeWindowFromQuery(request: FastifyRequest): TimeWindow {
  const q = request.query as { start?: string; end?: string };
  const now = new Date();
  if (q.start && q.end) {
    const start = new Date(q.start);
    const end = new Date(q.end);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start.getTime() <= end.getTime()) {
      return { start, end };
    }
  }
  return { start: new Date(now.getTime() - 24 * 60 * 60 * 1000), end: now };
}

function toIntentLabel(label: string | null): string {
  const raw = (label ?? "").trim();
  if (!raw) return "Unknown";
  return raw
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

export function registerAnalyticsRoutes(app: FastifyInstance, configStore: ConfigStore) {
  const preHandler = resolvedAuthHook(["admin", "editor", "viewer"]);

  app.get("/analytics/outcomes", { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;
    const queryParams = (request.query as {
      from?: string;
      to?: string;
      granularity?: "hour" | "day" | "week";
    }) ?? {};

    const granularity = queryParams.granularity === "day" || queryParams.granularity === "week"
      ? queryParams.granularity
      : "hour";
    const truncateExpr = granularity === "day" ? "day" : granularity === "week" ? "week" : "hour";
    const stepExpr = granularity === "day" ? "1 day" : granularity === "week" ? "1 week" : "1 hour";

    const parsedFrom = queryParams.from ? new Date(queryParams.from) : null;
    const parsedTo = queryParams.to ? new Date(queryParams.to) : null;
    const hasValidFrom = !!parsedFrom && !Number.isNaN(parsedFrom.getTime());
    const hasValidTo = !!parsedTo && !Number.isNaN(parsedTo.getTime());
    const fallbackTo = new Date();
    const fallbackFrom = new Date(fallbackTo.getTime() - 24 * 60 * 60 * 1000);
    let fromTs = hasValidFrom ? parsedFrom! : fallbackFrom;
    let toTs = hasValidTo ? parsedTo! : fallbackTo;
    if (fromTs.getTime() > toTs.getTime()) {
      const tmp = fromTs;
      fromTs = toTs;
      toTs = tmp;
    }

    const result = await query(
      `WITH buckets AS (
         SELECT generate_series(
           date_trunc('${truncateExpr}', $2::timestamptz),
           date_trunc('${truncateExpr}', $3::timestamptz),
           '${stepExpr}'::interval
         ) AS bucket_time
       ),
       aggregated AS (
         SELECT
           date_trunc('${truncateExpr}', started_at) AS bucket_time,
           outcome,
           COUNT(*)::int AS count
         FROM calls
         WHERE org_id = $1
           AND started_at >= $2::timestamptz
           AND started_at <= $3::timestamptz
         GROUP BY 1, 2
       )
       SELECT b.bucket_time AS time, a.outcome, COALESCE(a.count, 0)::int AS count
       FROM buckets b
       LEFT JOIN aggregated a ON a.bucket_time = b.bucket_time
       ORDER BY b.bucket_time ASC`,
      [orgId, fromTs.toISOString(), toTs.toISOString()]
    );

    const buckets = new Map<string, { time: string; pending: number; completed: number; handoff: number; dropped: number; systemFailed: number }>();
    for (const row of result.rows) {
      const t = new Date(row.time).toISOString();
      const bucket = buckets.get(t) ?? { time: t, pending: 0, completed: 0, handoff: 0, dropped: 0, systemFailed: 0 };
      const key = mapOutcomeToUiResult(row.outcome) as keyof typeof bucket;
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

    const { start, end } = parseTimeWindowFromQuery(request);

    const result = await query(
      `SELECT date_trunc('hour', started_at) AS time,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'in_progress')::int AS active,
              COUNT(*) FILTER (WHERE outcome = 'handled')::int AS completed,
              COUNT(*) FILTER (WHERE outcome = 'failed')::int AS failed,
              COUNT(*) FILTER (WHERE outcome = 'transferred')::int AS handoff,
              COUNT(*) FILTER (WHERE outcome = 'abandoned')::int AS dropped
       FROM calls
       WHERE org_id = $1 AND started_at >= $2 AND started_at <= $3
       GROUP BY time ORDER BY time`,
      [orgId, start, end]
    );

    const latencyResult = await query(
      `SELECT date_trunc('hour', ce.occurred_at) AS time,
              AVG(EXTRACT(EPOCH FROM (ce.occurred_at - c.started_at)) * 1000)::int AS avg_latency
       FROM call_events ce JOIN calls c ON ce.call_id = c.call_id
       WHERE c.org_id = $1 AND ce.event_type = 'agent_spoke' AND ce.occurred_at >= $2 AND ce.occurred_at <= $3
       GROUP BY time ORDER BY time`,
      [orgId, start, end]
    );

    const latencyMap = new Map<string, number>();
    for (const row of latencyResult.rows) {
      latencyMap.set(new Date(row.time).toISOString(), row.avg_latency ?? 0);
    }

    const activeNow = await callStore.countActiveLiveCalls(orgId);

    const sparklines = {
      totalCalls: result.rows.map((r: any) => r.total),
      activeCalls: result.rows.map((r: any) => r.active),
      completed: result.rows.map((r: any) => r.completed),
      failed: result.rows.map((r: any) => r.failed),
      handoff: result.rows.map((r: any) => r.handoff),
      dropped: result.rows.map((r: any) => r.dropped),
      // Per-bucket: calls still in `in_progress` in that hour (not the same as live active count).
      latency: result.rows.map((r: any) => latencyMap.get(new Date(r.time).toISOString()) ?? 0),
      activeNow,
    };

    sendData(reply, sparklines);
  });

  app.get("/analytics/intents", { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;

    const { start, end } = parseTimeWindowFromQuery(request);

    const result = await query(
      `SELECT classified_intent AS label, COUNT(*)::int AS value
       FROM calls
       WHERE org_id = $1 AND classified_intent IS NOT NULL
         AND started_at >= $2 AND started_at <= $3
       GROUP BY classified_intent ORDER BY value DESC LIMIT 10`,
      [orgId, start, end]
    );

    sendData(reply, result.rows.map((r: any) => ({ label: toIntentLabel(r.label), value: r.value })));
  });

  app.get("/analytics/handoffs", { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;

    const { start, end } = parseTimeWindowFromQuery(request);

    const result = await query(
      `SELECT COALESCE(NULLIF(end_reason, ''), 'unknown') AS label, COUNT(*)::int AS value
       FROM calls
       WHERE org_id = $1 AND outcome = 'transferred'
         AND started_at >= $2 AND started_at <= $3
       GROUP BY COALESCE(NULLIF(end_reason, ''), 'unknown') ORDER BY value DESC LIMIT 10`,
      [orgId, start, end]
    );

    sendData(reply, result.rows.map((r: any) => ({
      label: normalizeEndReasonLabel(r.label, "transferred") ?? "Unknown",
      value: r.value,
    })));
  });

  app.get("/analytics/failures", { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;

    const { start, end } = parseTimeWindowFromQuery(request);

    let result;
    try {
      // Preferred query when classification migration (009) is present.
      result = await query(
        `SELECT COALESCE(NULLIF(failure_category, ''), NULLIF(failure_type, ''), end_reason, 'unknown') AS label, COUNT(*)::int AS value
         FROM calls
         WHERE org_id = $1 AND outcome = 'failed'
           AND started_at >= $2 AND started_at <= $3
         GROUP BY COALESCE(NULLIF(failure_category, ''), NULLIF(failure_type, ''), end_reason, 'unknown') ORDER BY value DESC LIMIT 10`,
        [orgId, start, end]
      );
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code !== "42703") throw err; // undefined_column
      // Backward-compatible fallback for pre-009 schemas.
      result = await query(
        `SELECT COALESCE(NULLIF(failure_type, ''), end_reason, 'unknown') AS label, COUNT(*)::int AS value
         FROM calls
         WHERE org_id = $1 AND outcome = 'failed'
           AND started_at >= $2 AND started_at <= $3
         GROUP BY COALESCE(NULLIF(failure_type, ''), end_reason, 'unknown') ORDER BY value DESC LIMIT 10`,
        [orgId, start, end]
      );
    }

    sendData(reply, result.rows);
  });

  app.get("/analytics/tools", { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;

    const { start, end } = parseTimeWindowFromQuery(request);

    const result = await query(
      `SELECT
         payload->>'toolName' AS name,
         COUNT(*)::int AS invocations,
         COUNT(*) FILTER (WHERE payload->>'result' = 'success')::int AS successes,
         COUNT(*) FILTER (WHERE payload->>'result' IN ('error','failed'))::int AS failures,
         AVG((payload->>'latencyMs')::numeric)::int AS avg_latency
       FROM call_events
       WHERE org_id = $1 AND event_type = 'tool_called' AND payload->>'toolName' IS NOT NULL
         AND occurred_at >= $2 AND occurred_at <= $3
       GROUP BY payload->>'toolName'
       ORDER BY invocations DESC`,
      [orgId, start, end]
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

    const { start, end } = parseTimeWindowFromQuery(request);

    const agg = (await query(
      `SELECT
         COUNT(*)::int AS total_calls,
         COUNT(*) FILTER (WHERE outcome = 'handled')::int AS handled,
         COUNT(*) FILTER (WHERE outcome = 'transferred')::int AS escalated,
         COUNT(*) FILTER (WHERE outcome = 'failed')::int AS failed,
         AVG(duration_sec)::int AS avg_duration
       FROM calls
       WHERE org_id = $1 AND started_at >= $2 AND started_at <= $3`,
      [orgId, start, end]
    )).rows[0] ?? { total_calls: 0, handled: 0, escalated: 0, failed: 0, avg_duration: 0 };

    const intentsResult = await query(
      `SELECT classified_intent AS name, COUNT(*)::int AS count
       FROM calls
       WHERE org_id = $1 AND classified_intent IS NOT NULL
         AND started_at >= $2 AND started_at <= $3
       GROUP BY classified_intent ORDER BY count DESC LIMIT 5`,
      [orgId, start, end]
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
   * SQL-only home-dashboard KPIs for org + start/end. Not limited by GET /calls row cap.
   */
  app.get("/analytics/summary", {
    preHandler,
    schema: { response: { 200: AnalyticsSummaryEnvelopeSchema } },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;

    const { start, end } = parseTimeWindowFromQuery(request);

    const aggRow = (
      await query<{
        total_calls: string;
        completed_calls: string;
        handoff_calls: string;
        dropped_calls: string;
        failed_calls: string;
        total_duration_sec: string;
      }>(
        `SELECT
           COUNT(*)::int AS total_calls,
           COUNT(*) FILTER (WHERE outcome = 'handled')::int AS completed_calls,
           COUNT(*) FILTER (WHERE outcome = 'transferred')::int AS handoff_calls,
           COUNT(*) FILTER (WHERE outcome = 'abandoned')::int AS dropped_calls,
           COUNT(*) FILTER (WHERE outcome = 'failed')::int AS failed_calls,
           COALESCE(SUM(duration_sec), 0)::bigint AS total_duration_sec
         FROM calls
         WHERE org_id = $1 AND started_at >= $2 AND started_at <= $3`,
        [orgId, start, end]
      )
    ).rows[0] ?? {
      total_calls: "0",
      completed_calls: "0",
      handoff_calls: "0",
      dropped_calls: "0",
      failed_calls: "0",
      total_duration_sec: "0",
    };

    const totalCalls = Number(aggRow.total_calls) || 0;
    const completedCalls = Number(aggRow.completed_calls) || 0;
    const handoffCalls = Number(aggRow.handoff_calls) || 0;
    const droppedCalls = Number(aggRow.dropped_calls) || 0;
    const failedCalls = Number(aggRow.failed_calls) || 0;
    const totalDurationSec = Number(aggRow.total_duration_sec) || 0;

    const pct = (n: number) => (totalCalls > 0 ? Math.round((n / totalCalls) * 100) : 0);

    const latencyRow = (
      await query<{
        sample_count: string;
        avg_ms: string | null;
      }>(
        `SELECT
          COUNT(*)::int AS sample_count,
          AVG(first_speech.latency_ms)::float AS avg_ms
         FROM (
           SELECT MIN(
             EXTRACT(EPOCH FROM (ce.occurred_at - c.started_at)) * 1000
           ) AS latency_ms
           FROM calls c
           INNER JOIN call_events ce
             ON ce.call_id = c.call_id AND ce.org_id = c.org_id
           WHERE c.org_id = $1
             AND c.started_at >= $2 AND c.started_at <= $3
             AND ce.event_type = 'agent_spoke'
           GROUP BY c.call_id
         ) AS first_speech
         WHERE first_speech.latency_ms IS NOT NULL`,
        [orgId, start, end]
      )
    ).rows[0] ?? { sample_count: "0", avg_ms: null };

    const sampleCount = Number(latencyRow.sample_count) || 0;
    const avgRaw = latencyRow.avg_ms;
    const avgTimeToAgentSpeechHasData = sampleCount > 0 && avgRaw != null;
    const avgTimeToAgentSpeechMs = avgTimeToAgentSpeechHasData
      ? Math.round(Number(avgRaw))
      : null;

    const activeNow = await callStore.countActiveLiveCalls(orgId);

    const toolRow = (
      await query(
        `SELECT COUNT(*)::int AS tool_invocations
         FROM call_events
         WHERE org_id = $1 AND event_type = 'tool_called'
           AND occurred_at >= $2 AND occurred_at <= $3`,
        [orgId, start, end]
      )
    ).rows[0] ?? { tool_invocations: 0 };

    sendData(reply, {
      totalCalls,
      successfulCalls: completedCalls,
      completedCalls,
      handoffCalls,
      droppedCalls,
      failedCalls,
      completionRate: pct(completedCalls),
      handoffRate: pct(handoffCalls),
      dropRate: pct(droppedCalls),
      failureRate: pct(failedCalls),
      averageDurationMs: totalCalls > 0 ? (totalDurationSec * 1000) / totalCalls : 0,
      successRate: totalCalls > 0 ? completedCalls / totalCalls : 0,
      activeNow,
      toolInvocations: Number((toolRow as { tool_invocations: number }).tool_invocations) || 0,
      avgTimeToAgentSpeechMs,
      avgTimeToAgentSpeechHasData,
    });
  });
}
