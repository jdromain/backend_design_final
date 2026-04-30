import { describe, it, expect } from "vitest"
import type { CallRecord, LiveCall } from "@/types/api"
import {
  matchesCanonicalCallFilters,
  normalizeCallRecordLabels,
  normalizeLiveCallLabels,
} from "@/lib/call-labels"

function baseHistoryCall(overrides: Partial<CallRecord> = {}): CallRecord {
  return {
    callId: "call_123",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:01:00.000Z",
    callerNumber: "+15551111111",
    phoneLineId: "+15550000000",
    phoneLineNumber: "+15550000000",
    agentId: "agent_1",
    agentName: "Rezovo Agent",
    direction: "inbound",
    durationMs: 60000,
    result: "unknown",
    toolsUsed: [],
    canonical: {
      status: "failed",
      outcome: "failed",
      endReason: "error",
      terminalStatusSource: "realtime",
      intentSource: "agent_inference",
      intentConfidenceBand: "high",
    },
    ...overrides,
  }
}

function baseLiveCall(overrides: Partial<LiveCall> = {}): LiveCall {
  return {
    callId: "call_123",
    callerNumber: "+15551111111",
    agentName: "Rezovo Agent",
    agentVersion: "1",
    state: "active",
    direction: "inbound",
    startedAt: "2026-01-01T00:00:00.000Z",
    durationSeconds: 60,
    lastEvent: "call_started",
    riskFlags: [],
    timeline: [],
    transcript: [],
    tools: [],
    tags: [],
    canonical: {
      status: "failed",
      outcome: "failed",
      endReason: "error",
      terminalStatusSource: "realtime",
      intentSource: "agent_inference",
      intentConfidenceBand: "high",
      failureType: "unknown",
      toolErrors: 0,
    },
    ...overrides,
  }
}

describe("call label consistency", () => {
  it("renders the same result label across history/dashboard and live mappers for the same call", () => {
    const history = normalizeCallRecordLabels(baseHistoryCall())
    const dashboard = normalizeCallRecordLabels(baseHistoryCall())
    const live = normalizeLiveCallLabels(baseLiveCall())

    expect(history.display?.result).toBe("System Failed")
    expect(dashboard.display?.result).toBe("System Failed")
    expect(live.display?.result).toBe("System Failed")
    expect(history.result).toBe("systemFailed")
    expect(dashboard.result).toBe("systemFailed")
  })

  it("renders explicit Unknown for unknown terminal values", () => {
    const unknown = normalizeCallRecordLabels(
      baseHistoryCall({
        canonical: {
          status: "unknown",
          outcome: "unknown",
          endReason: "unknown",
          terminalStatusSource: "unknown",
          intentSource: "unknown",
          intentConfidenceBand: "unknown",
        },
      })
    )

    expect(unknown.result).toBe("unknown")
    expect(unknown.display?.result).toBe("Unknown")
    expect(unknown.display?.reason).toBe("Unknown")
  })

  it("filters on canonical values (outcome + end reason), not display text", () => {
    const call = normalizeCallRecordLabels(
      baseHistoryCall({
        classification: {
          status: "failed",
          outcome: "failed",
          endReason: "error",
          failureCategory: "tool_error",
          intentCategory: "Support",
          intentConfidenceBand: "high",
          actionClass: "engineering_investigate",
          toolSummary: {
            toolsUsedCount: 1,
            toolErrorsCount: 1,
            primaryFailedTool: "calendar_lookup",
            toolFailureClass: "tool_error",
          },
          provenance: {
            terminalStatusSource: "realtime",
            intentSource: "agent_inference",
            labelVersion: 1,
          },
        },
      })
    )

    expect(matchesCanonicalCallFilters(call, { outcomes: ["failed"] })).toBe(true)
    expect(matchesCanonicalCallFilters(call, { outcomes: ["handled"] })).toBe(false)
    expect(matchesCanonicalCallFilters(call, { endReason: "error" })).toBe(true)
    expect(matchesCanonicalCallFilters(call, { endReason: "timeout" })).toBe(false)
    expect(matchesCanonicalCallFilters(call, { failureCategory: "tool_error" })).toBe(true)
    expect(matchesCanonicalCallFilters(call, { actionClass: "engineering_investigate" })).toBe(true)
    expect(matchesCanonicalCallFilters(call, { actionClass: "no_action" })).toBe(false)
  })
})
