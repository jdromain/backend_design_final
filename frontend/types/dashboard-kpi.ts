/**
 * Aligned with GET /analytics/summary (platform-api) — single source of truth
 * for home dashboard headline KPIs (not derived from the capped GET /calls list).
 */
export type DashboardKpiSummary = {
  totalCalls: number
  activeNow: number
  successfulCalls: number
  completedCalls: number
  handoffCalls: number
  droppedCalls: number
  failedCalls: number
  completionRate: number
  handoffRate: number
  dropRate: number
  failureRate: number
  averageDurationMs: number
  successRate: number
  toolInvocations: number
  avgTimeToAgentSpeechMs: number | null
  avgTimeToAgentSpeechHasData: boolean
}
