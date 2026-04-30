import type { DashboardKpiSummary } from "@/types/dashboard-kpi"

/** Main headline for Avg time to agent speech — never "0ms" for missing data. */
export function formatAgentSpeechLatencyHeadline(s: DashboardKpiSummary): string {
  if (!s.avgTimeToAgentSpeechHasData || s.avgTimeToAgentSpeechMs == null) {
    return "—"
  }
  return `${s.avgTimeToAgentSpeechMs}ms`
}
