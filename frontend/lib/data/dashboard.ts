import type { CallRecord } from "@/types/api"
import type { Incident } from "@/components/dashboard/needs-attention-panel"
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
import { appendTenantQuery, get } from "@/lib/api-client"

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
}

function mapSparklinesFromApi(api: ApiSparklines): typeof sparklineData {
  return {
    calls: api.totalCalls ?? [],
    active: api.activeCalls ?? [],
    completed: api.completed ?? [],
    failed: api.failed ?? [],
    handoff: api.handoff ?? [],
    dropped: api.dropped ?? [],
    latency: api.latency ?? [],
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
        ? { label: "View calls", page: "history", params: { filter: "transferred" } }
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

export async function getDashboardOutcomes() {
  if (useMocks) return generateOutcomesData()
  return get<ReturnType<typeof generateOutcomesData>>(appendTenantQuery("/analytics/outcomes"))
}

export async function getDashboardCalls(): Promise<CallRecord[]> {
  if (useMocks) return generateCallsData()
  return get<CallRecord[]>(appendTenantQuery("/calls"))
}

export async function getDashboardActivity() {
  if (useMocks) return generateActivityData()
  return get<ReturnType<typeof generateActivityData>>(appendTenantQuery("/activity"))
}

export async function getSparklineData() {
  if (useMocks) return sparklineData
  const raw = await get<ApiSparklines>(appendTenantQuery("/analytics/sparklines"))
  return mapSparklinesFromApi(raw)
}

export async function getSystemHealth() {
  if (useMocks) return systemHealth
  return get<typeof systemHealth | null>("/health")
}

export async function getIncidents(): Promise<Incident[]> {
  if (useMocks) return incidents as Incident[]
  const rows = await get<ApiIncident[]>(appendTenantQuery("/incidents"))
  return Array.isArray(rows) ? rows.map(mapApiIncidentToPanel) : []
}

export async function getTopIntents() {
  if (useMocks) return topIntents
  return get<typeof topIntents>(appendTenantQuery("/analytics/intents"))
}

export async function getTopHandoffReasons() {
  if (useMocks) return topHandoffReasons
  return get<typeof topHandoffReasons>(appendTenantQuery("/analytics/handoffs"))
}

export async function getTopFailureReasons() {
  if (useMocks) return topFailureReasons
  return get<typeof topFailureReasons>(appendTenantQuery("/analytics/failures"))
}

export async function getOnboardingSteps() {
  if (useMocks) return onboardingSteps
  return get<typeof onboardingSteps>(appendTenantQuery("/onboarding"))
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
