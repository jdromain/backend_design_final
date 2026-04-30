import { assertMockSafety } from "./_env-check"
import { mockPhoneLines, mockToolsPerformance, mockAssistant, mockInsights } from "@/data/mock/analytics"
import { appendOrgQuery, get } from "@/lib/api-client"
import { appendDateRangeToPath, type DashboardDateRange } from "@/lib/data/dashboard"

assertMockSafety()

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === "true"

export async function getPhoneLines(): Promise<string[]> {
  if (useMocks) return mockPhoneLines
  const lines = await get<{ id: string; number: string; name: string }[]>(appendOrgQuery("/phone-lines"))
  return lines.map((l) => l.number)
}

type ApiToolsRow = {
  name: string
  invocations: number
  successRate: number
  failures: number
  avgLatency: number
}

export async function getToolsPerformance(range?: DashboardDateRange) {
  if (useMocks) return mockToolsPerformance
  const raw = await get<ApiToolsRow[]>(
    appendDateRangeToPath(appendOrgQuery("/analytics/tools"), range)
  )
  if (!Array.isArray(raw)) return []
  return raw.map((r) => ({
    name: r.name,
    usageCount: r.invocations,
    failureRate: r.invocations > 0 ? (r.failures / r.invocations) * 100 : 0,
    avgLatency: r.avgLatency ?? 0,
    lastFailure: null as string | null,
  }))
}

export async function getAgentPerformance(range?: DashboardDateRange) {
  if (useMocks) return mockAssistant
  return get<typeof mockAssistant | null>(
    appendDateRangeToPath(appendOrgQuery("/analytics/agents"), range)
  )
}

export async function getAnalyticsInsights() {
  if (useMocks) return mockInsights
  return get<typeof mockInsights>(appendOrgQuery("/analytics/insights"))
}

export { mockPhoneLines, mockToolsPerformance, mockAssistant, mockInsights }
