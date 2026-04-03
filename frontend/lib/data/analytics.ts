import { assertMockSafety } from "./_env-check"
import { mockPhoneLines, mockToolsPerformance, mockAssistant, mockInsights } from "@/data/mock/analytics"
import { appendTenantQuery, get } from "@/lib/api-client"

assertMockSafety()

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === "true"

export async function getPhoneLines(): Promise<string[]> {
  if (useMocks) return mockPhoneLines
  const lines = await get<{ id: string; number: string; name: string }[]>(appendTenantQuery("/phone-lines"))
  return lines.map((l) => l.number)
}

export async function getToolsPerformance() {
  if (useMocks) return mockToolsPerformance
  return get<typeof mockToolsPerformance>(appendTenantQuery("/analytics/tools"))
}

export async function getAgentPerformance() {
  if (useMocks) return mockAssistant
  return get<typeof mockAssistant | null>(appendTenantQuery("/analytics/agents"))
}

export async function getAnalyticsInsights() {
  if (useMocks) return mockInsights
  return get<typeof mockInsights>(appendTenantQuery("/analytics/insights"))
}

export { mockPhoneLines, mockToolsPerformance, mockAssistant, mockInsights }
