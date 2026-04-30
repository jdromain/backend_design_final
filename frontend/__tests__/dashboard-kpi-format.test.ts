import { describe, it, expect } from "vitest"
import { formatAgentSpeechLatencyHeadline } from "@/lib/dashboard-kpi-format"
import type { DashboardKpiSummary } from "@/types/dashboard-kpi"

const base = (): DashboardKpiSummary => ({
  totalCalls: 0,
  activeNow: 0,
  successfulCalls: 0,
  completedCalls: 0,
  handoffCalls: 0,
  droppedCalls: 0,
  failedCalls: 0,
  completionRate: 0,
  handoffRate: 0,
  dropRate: 0,
  failureRate: 0,
  averageDurationMs: 0,
  successRate: 0,
  toolInvocations: 0,
  avgTimeToAgentSpeechMs: null,
  avgTimeToAgentSpeechHasData: false,
})

describe("formatAgentSpeechLatencyHeadline", () => {
  it('returns "—" when hasData is false', () => {
    expect(formatAgentSpeechLatencyHeadline(base())).toBe("—")
  })

  it("returns 0ms when measured zero is real (has data)", () => {
    expect(
      formatAgentSpeechLatencyHeadline({
        ...base(),
        avgTimeToAgentSpeechHasData: true,
        avgTimeToAgentSpeechMs: 0,
      })
    ).toBe("0ms")
  })

  it("returns ms when data exists", () => {
    expect(
      formatAgentSpeechLatencyHeadline({
        ...base(),
        avgTimeToAgentSpeechHasData: true,
        avgTimeToAgentSpeechMs: 240,
      })
    ).toBe("240ms")
  })
})
