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

type ApiInsightRow = { label: string; value: number }

function mapInsightRows(rows: ApiInsightRow[]): InsightItem[] {
  return rows.map((r, i) => ({ id: String(i + 1), label: r.label, count: r.value }))
}

export async function getTopIntents() {
  if (useMocks) return topIntents
  const rows = await get<ApiInsightRow[]>(appendTenantQuery("/analytics/intents"))
  return Array.isArray(rows) ? mapInsightRows(rows) : []
}

export async function getTopHandoffReasons() {
  if (useMocks) return topHandoffReasons
  const rows = await get<ApiInsightRow[]>(appendTenantQuery("/analytics/handoffs"))
  return Array.isArray(rows) ? mapInsightRows(rows) : []
}

export async function getTopFailureReasons() {
  if (useMocks) return topFailureReasons
  const rows = await get<ApiInsightRow[]>(appendTenantQuery("/analytics/failures"))
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
  const rows = await get<ApiOnboardingStep[]>(appendTenantQuery("/onboarding"))
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
