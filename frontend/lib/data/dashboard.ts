import type { CallRecord } from "@/types/api"
import type { Incident } from "@/components/dashboard/needs-attention-panel"
import type { InsightItem } from "@/components/dashboard/insights-card"
import type { OnboardingStep } from "@/components/dashboard/onboarding-checklist"
import { formatDistanceToNow } from "date-fns"
import { assertMockSafety } from "./_env-check"
import {
  generateOutcomesData,
  generateCallsData,
  generateActivityData,
  sparklineData,
  systemHealth,
  incidents,
  topIntents,
  topHandoffReasons,
  topFailureReasons,
  onboardingSteps,
} from "@/data/mock/dashboard"
import { appendOrgQuery, get } from "@/lib/api-client"
import type { DashboardKpiSummary } from "@/types/dashboard-kpi"
import { normalizeCallRecordLabels } from "@/lib/call-labels"

export type DashboardDateRange = { start?: string; end?: string }

export type { DashboardKpiSummary } from "@/types/dashboard-kpi"

export function appendDateRangeToPath(path: string, range?: DashboardDateRange): string {
  if (!range?.start && !range?.end) return path
  const p = new URLSearchParams()
  if (range.start) p.set("start", range.start)
  if (range.end) p.set("end", range.end)
  const qs = p.toString()
  if (!qs) return path
  return path.includes("?") ? `${path}&${qs}` : `${path}?${qs}`
}

assertMockSafety()

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === "true"

type ApiSparklines = {
  totalCalls: number[]
  activeCalls: number[]
  completed: number[]
  failed: number[]
  handoff: number[]
  dropped: number[]
  latency: number[]
  /** Live in-progress/ringing count from Postgres (stale calls excluded) — not a sparkline bucket. */
  activeNow?: number
}

type DashboardActivity = ReturnType<typeof generateActivityData>[number]

function toDateSafe(value: unknown): Date {
  if (value instanceof Date) return value
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) return d
  }
  return new Date(0)
}

function normalizeActivityItem(item: DashboardActivity | Record<string, unknown>): DashboardActivity {
  return {
    ...(item as DashboardActivity),
    timestamp: toDateSafe((item as { timestamp?: unknown }).timestamp),
  }
}

function mapSparklinesFromApi(
  api: ApiSparklines
): typeof sparklineData & { activeNow: number } {
  return {
    calls: api.totalCalls ?? [],
    active: api.activeCalls ?? [],
    completed: api.completed ?? [],
    failed: api.failed ?? [],
    handoff: api.handoff ?? [],
    dropped: api.dropped ?? [],
    latency: api.latency ?? [],
    activeNow: typeof api.activeNow === "number" ? api.activeNow : 0,
  }
}

type ApiIncident = {
  id: string
  severity: string
  title: string
  description: string
  evaluatedAt: string
  status: string
}

function mapApiIncidentToPanel(i: ApiIncident): Incident {
  const severity: Incident["severity"] =
    i.severity === "critical" ? "high" : i.severity === "warning" ? "medium" : "low"

  let icon: Incident["icon"] = "escalation"
  if (i.id === "inc-tool-errors") icon = "tool"
  else if (i.id === "inc-handoff-rate") icon = "drop"
  else if (i.id === "inc-failures") icon = "escalation"

  const action: Incident["action"] =
    i.id === "inc-failures"
      ? { label: "View calls", page: "history", params: { filter: "failed" } }
      : i.id === "inc-handoff-rate"
        ? { label: "View calls", page: "history", params: { filter: "handoff" } }
        : i.id === "inc-tool-errors"
          ? { label: "Integrations", page: "integrations" }
          : { label: "View history", page: "history" }

  return {
    id: i.id,
    severity,
    icon,
    title: i.title,
    description: i.description,
    since: formatDistanceToNow(new Date(i.evaluatedAt), { addSuffix: true }),
    action,
  }
}

export async function getDashboardOutcomes(range?: DashboardDateRange) {
  if (useMocks) return generateOutcomesData()
  const path = appendDateRangeToPath(appendOrgQuery("/analytics/outcomes"), range)
  return get<ReturnType<typeof generateOutcomesData>>(path)
}

export async function getDashboardOutcomesByRange(params: {
  from: Date
  to: Date
  granularity: "hour" | "day" | "week"
}) {
  const base = appendDateRangeToPath(appendOrgQuery("/analytics/outcomes"), {
    start: params.from.toISOString(),
    end: params.to.toISOString(),
  })
  const parsed = new URL(base, "http://local")
  parsed.searchParams.set("granularity", params.granularity)
  const path = `${parsed.pathname}${parsed.search}`
  if (useMocks) return generateOutcomesData()
  return get<ReturnType<typeof generateOutcomesData>>(path)
}

type DashboardCallsInput = DashboardDateRange & {
  /** Compatibility for existing callers that still pass Date objects. */
  from?: Date
  to?: Date
  /** Optional row-cap hint for /calls. */
  limit?: number
}

/**
 * Recent calls for table/drilldown only. The API caps this list (see platform-api
 * `getCallsByOrganization` … `LIMIT 100`). **Do not** use this array’s length
 * for org-wide Total Calls or outcome rates; use `getDashboardSummary` instead.
 */
export async function getDashboardCalls(range?: DashboardCallsInput): Promise<CallRecord[]> {
  if (useMocks) return generateCallsData().map(normalizeCallRecordLabels)
  const normalizedRange: DashboardDateRange = {
    start: range?.start ?? (range?.from ? range.from.toISOString() : undefined),
    end: range?.end ?? (range?.to ? range.to.toISOString() : undefined),
  }
  const basePath = appendDateRangeToPath(appendOrgQuery("/calls"), normalizedRange)
  const parsed = new URL(basePath, "http://local")
  if (typeof range?.limit === "number" && range.limit > 0) {
    parsed.searchParams.set("limit", String(range.limit))
  }
  const path = `${parsed.pathname}${parsed.search}`
  const rows = await get<CallRecord[]>(path)
  return rows.map(normalizeCallRecordLabels)
}

/**
 * SQL-backed KPIs for the home dashboard (`GET /analytics/summary`), same `start`/`end`
 * as sparklines. Not affected by the GET /calls row cap.
 */
export async function getDashboardSummary(
  range?: DashboardDateRange
): Promise<DashboardKpiSummary> {
  if (useMocks) {
    const { buildMockDashboardSummary } = await import("@/data/mock/dashboard")
    return buildMockDashboardSummary()
  }
  return get<DashboardKpiSummary>(
    appendDateRangeToPath(appendOrgQuery("/analytics/summary"), range)
  )
}

export async function getDashboardActivity() {
  if (useMocks) return generateActivityData()
  const rows = await get<Array<Record<string, unknown>>>(appendOrgQuery("/activity"))
  return Array.isArray(rows) ? rows.map((r) => normalizeActivityItem(r)) : []
}

export async function getSparklineData(range?: DashboardDateRange) {
  if (useMocks) return sparklineData
  const raw = await get<ApiSparklines>(
    appendDateRangeToPath(appendOrgQuery("/analytics/sparklines"), range)
  )
  return mapSparklinesFromApi(raw)
}

export async function getSystemHealth() {
  if (useMocks) return systemHealth
  return get<typeof systemHealth | null>("/health")
}

export async function getIncidents(): Promise<Incident[]> {
  if (useMocks) return incidents as Incident[]
  const rows = await get<ApiIncident[]>(appendOrgQuery("/incidents"))
  return Array.isArray(rows) ? rows.map(mapApiIncidentToPanel) : []
}

type ApiInsightRow = { label: string; value: number }

function mapInsightRows(rows: ApiInsightRow[]): InsightItem[] {
  return rows.map((r, i) => ({ id: String(i + 1), label: r.label, count: r.value }))
}

export async function getTopIntents(range?: DashboardDateRange) {
  if (useMocks) return topIntents
  const rows = await get<ApiInsightRow[]>(
    appendDateRangeToPath(appendOrgQuery("/analytics/intents"), range)
  )
  return Array.isArray(rows) ? mapInsightRows(rows) : []
}

export async function getTopHandoffReasons(range?: DashboardDateRange) {
  if (useMocks) return topHandoffReasons
  const rows = await get<ApiInsightRow[]>(
    appendDateRangeToPath(appendOrgQuery("/analytics/handoffs"), range)
  )
  return Array.isArray(rows) ? mapInsightRows(rows) : []
}

export async function getTopFailureReasons(range?: DashboardDateRange) {
  if (useMocks) return topFailureReasons
  const rows = await get<ApiInsightRow[]>(
    appendDateRangeToPath(appendOrgQuery("/analytics/failures"), range)
  )
  return Array.isArray(rows) ? mapInsightRows(rows) : []
}

type ApiOnboardingStep = {
  id: string
  label: string
  completed: boolean
  order: number
}

const onboardingStepMeta: Record<
  string,
  {
    icon: OnboardingStep["icon"]
    description: string
    action: OnboardingStep["action"]
  }
> = {
  "phone-number": {
    icon: "phone",
    description: "Set up your Twilio or SIP connection",
    action: { label: "Configure", page: "integrations" },
  },
  "kb-upload": {
    icon: "docs",
    description: "Add your knowledge base content",
    action: { label: "Upload", page: "knowledge" },
  },
  credentials: {
    icon: "integration",
    description: "Link your CRM or calendar",
    action: { label: "Connect", page: "integrations" },
  },
  "agent-publish": {
    icon: "live",
    description: "Publish an agent configuration",
    action: { label: "Go Live", page: "agents" },
  },
  "test-call": {
    icon: "test",
    description: "Make sure everything works",
    action: { label: "Test", page: "dashboard" },
  },
}

function mapApiOnboardingStep(s: ApiOnboardingStep): OnboardingStep {
  const meta = onboardingStepMeta[s.id] ?? {
    icon: "phone" as const,
    description: "",
    action: { label: "Continue", page: "dashboard" },
  }
  return {
    id: s.id,
    title: s.label,
    description: meta.description,
    icon: meta.icon,
    completed: s.completed,
    action: meta.action,
  }
}

export async function getOnboardingSteps() {
  if (useMocks) return onboardingSteps
  const rows = await get<ApiOnboardingStep[]>(appendOrgQuery("/onboarding"))
  if (!Array.isArray(rows)) return []
  const sorted = [...rows].sort((a, b) => a.order - b.order)
  return sorted.map(mapApiOnboardingStep)
}

// Re-export generators and static mock objects for components that use them
// as synchronous useState initializers or direct inline values.
export {
  generateOutcomesData,
  generateCallsData,
  generateActivityData,
  sparklineData,
  systemHealth,
  incidents,
  topIntents,
  topHandoffReasons,
  topFailureReasons,
  onboardingSteps,
}
