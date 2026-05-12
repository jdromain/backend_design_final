import { describe, expect, it } from "vitest"

import type { CallRecord } from "@/types/api"
import { normalizeCallRecordLabels, selectCallEndedByDisplay, selectCallRiskDisplay, selectCallTopicDisplay } from "@/lib/call-labels"

function baseCall(overrides: Partial<CallRecord> = {}): CallRecord {
  return {
    callId: "call_topic_1",
    startedAt: "2026-05-08T12:00:00.000Z",
    endedAt: "2026-05-08T12:01:00.000Z",
    callerNumber: "+15550001111",
    phoneLineId: "+15550002222",
    phoneLineNumber: "+15550002222",
    agentId: "agent_1",
    agentName: "Rezovo Agent",
    direction: "inbound",
    durationMs: 60000,
    result: "unknown",
    toolsUsed: [],
    canonical: {
      status: "completed",
      outcome: "handled",
      endReason: "agent_end",
      terminalStatusSource: "realtime",
      intentSource: "agent_inference",
      intentConfidenceBand: "high",
    },
    classification: {
      status: "completed",
      outcome: "handled",
      endReason: "agent_end",
      failureCategory: "unknown",
      intentCategory: "Unknown",
      intentConfidenceBand: "high",
      actionClass: "no_action",
      toolSummary: {
        toolsUsedCount: 0,
        toolErrorsCount: 0,
        primaryFailedTool: "unknown",
        toolFailureClass: "unknown",
      },
      provenance: {
        terminalStatusSource: "realtime",
        intentSource: "agent_inference",
        labelVersion: 1,
      },
    },
    intelligence: null,
    ...overrides,
  }
}

describe("selectCallTopicDisplay", () => {
  it("uses final high-confidence intelligence topic first", () => {
    const call = normalizeCallRecordLabels(
      baseCall({
        classification: {
          ...baseCall().classification!,
          intentCategory: "Billing",
        },
        intelligence: {
          phase: "final",
          riskLevel: "low",
          followupNeeded: false,
          reviewRecommended: false,
          topic: "Billing dispute resolved after invoice verification",
          summary: "Billing dispute resolved after invoice verification",
          shortReason: "Invoice mismatch explained and corrected",
          confidence: { primaryIntent: 0.92 },
          warnings: [],
        },
      }),
    )

    const topic = selectCallTopicDisplay(call)
    expect(topic.text).toBe("Billing dispute resolved after invoice verification")
    expect(topic.state).toBe("final")
    expect(topic.source).toBe("intelligence_final")
  })

  it("prefers explicit backend topic field over generic summaries", () => {
    const call = normalizeCallRecordLabels(
      baseCall({
        classification: {
          ...baseCall().classification!,
          intentCategory: "Support",
        },
        intelligence: {
          phase: "final",
          riskLevel: "medium",
          followupNeeded: false,
          reviewRecommended: false,
          summary: "Call may need follow-up",
          shortReason: "Operationally stable completion",
          topic: "Technical Support Issue",
          topicSource: "semantic_transcript",
          topicState: "final",
          topicConfidence: 0.84,
          confidence: { primaryIntent: 0.41 },
          warnings: [],
        },
      }),
    )

    const topic = selectCallTopicDisplay(call)
    expect(topic.text).toBe("Technical Support Issue")
    expect(topic.state).toBe("final")
    expect(topic.source).toBe("intelligence_final")
  })

  it("prefers deterministic canonical intent over weak provisional semantic candidate", () => {
    const call = normalizeCallRecordLabels(
      baseCall({
        classification: {
          ...baseCall().classification!,
          intentCategory: "Billing",
        },
        intelligence: {
          phase: "provisional",
          riskLevel: "medium",
          followupNeeded: false,
          reviewRecommended: false,
          summary: "customer called",
          shortReason: "General inquiry",
          confidence: { primaryIntent: 0.4 },
          warnings: [],
        },
      }),
    )

    const topic = selectCallTopicDisplay(call)
    expect(topic.text).toBe("Billing Question")
    expect(topic.source).toBe("canonical_intent")
    expect(topic.state).toBe("final")
  })

  it("uses deterministic context topic when more specific than generic intent", () => {
    const call = normalizeCallRecordLabels(
      baseCall({
        classification: {
          ...baseCall().classification!,
          intentCategory: "Support",
          failureCategory: "tool_error",
          actionClass: "engineering_investigate",
          outcome: "failed",
        },
        canonical: {
          ...baseCall().canonical!,
          status: "failed",
          outcome: "failed",
          endReason: "error",
        },
        result: "systemFailed",
      }),
    )

    const topic = selectCallTopicDisplay(call)
    expect(topic.text).toBe("Support Request - Tool Failure")
    expect(topic.source).toBe("deterministic_context")
  })

  it("returns provisional topic + badge for strong provisional intelligence", () => {
    const call = normalizeCallRecordLabels(
      baseCall({
        canonical: {
          ...baseCall().canonical!,
          status: "in_progress",
          outcome: "unknown",
          endReason: "unknown",
        },
        result: "pending",
        intelligence: {
          phase: "provisional",
          riskLevel: "medium",
          followupNeeded: true,
          reviewRecommended: false,
          topic: "Caller wants to reschedule appointment",
          summary: "Caller wants to reschedule appointment",
          shortReason: "reschedule request",
          confidence: { primaryIntent: 0.78 },
          warnings: [],
        },
      }),
    )

    const topic = selectCallTopicDisplay(call)
    expect(topic.text).toBe("Caller wants to reschedule appointment")
    expect(topic.state).toBe("provisional")
    expect(topic.badge).toBe("Provisional")
  })

  it("separates pending, insufficient evidence, classification failed, and true unknown", () => {
    const pending = selectCallTopicDisplay(
      normalizeCallRecordLabels(
        baseCall({
          canonical: {
            ...baseCall().canonical!,
            status: "in_progress",
            outcome: "unknown",
            endReason: "unknown",
          },
          result: "pending",
          intelligence: null,
        }),
      ),
    )
    expect(pending.state).toBe("pending_analysis")
    expect(pending.text).toBe("Pending Analysis")

    const insufficient = selectCallTopicDisplay(
      normalizeCallRecordLabels(
        baseCall({
          intelligence: {
            phase: "final",
            riskLevel: "medium",
            followupNeeded: false,
            reviewRecommended: false,
            summary: "Unknown",
            shortReason: "Unknown",
            confidence: { primaryIntent: 0.99 },
            warnings: [
              {
                code: "context_incomplete",
                severity: "warn",
                field: "context",
                message: "context incomplete",
                count: 1,
                sampleIds: [],
                detectedAt: new Date().toISOString(),
              },
            ],
          },
        }),
      ),
    )
    expect(insufficient.state).toBe("insufficient_evidence")
    expect(insufficient.text).toBe("Insufficient Evidence")

    const failed = selectCallTopicDisplay(
      normalizeCallRecordLabels(
        baseCall({
          classification: {
            ...baseCall().classification!,
            intentCategory: "Sales",
          },
          intelligence: {
            phase: "failed",
            riskLevel: "high",
            followupNeeded: true,
            reviewRecommended: true,
            summary: "Unknown",
            shortReason: "Unknown",
            confidence: { primaryIntent: 0.2 },
            warnings: [],
          },
        }),
      ),
    )
    expect(failed.state).toBe("classification_failed")
    expect(failed.text).toBe("Sales Inquiry")
    expect(failed.badge).toBe("Classification Failed")

    const trueUnknown = selectCallTopicDisplay(
      normalizeCallRecordLabels(
        baseCall({
          intelligence: {
            phase: "final",
            riskLevel: "low",
            followupNeeded: false,
            reviewRecommended: false,
            summary: "Unknown",
            shortReason: "Unknown",
            confidence: { primaryIntent: 0.2 },
            warnings: [],
          },
        }),
      ),
    )
    expect(trueUnknown.state).toBe("true_unknown")
    expect(trueUnknown.text).toBe("Unknown")
  })

  it("suppresses generic semantic topics so they do not win", () => {
    const call = normalizeCallRecordLabels(
      baseCall({
        classification: {
          ...baseCall().classification!,
          intentCategory: "Support",
        },
        intelligence: {
          phase: "final",
          riskLevel: "low",
          followupNeeded: false,
          reviewRecommended: false,
          summary: "Support",
          shortReason: "Call Ended",
          confidence: { primaryIntent: 0.99 },
          warnings: [],
        },
      }),
    )

    const topic = selectCallTopicDisplay(call)
    expect(topic.text).toBe("Support Request")
    expect(topic.source).toBe("canonical_intent")
  })

  it("honors backend insufficient_evidence topic state hint", () => {
    const call = normalizeCallRecordLabels(
      baseCall({
        intelligence: {
          phase: "final",
          riskLevel: "medium",
          followupNeeded: false,
          reviewRecommended: false,
          summary: "Call topic could not be determined",
          shortReason: "Transcript/context evidence was too limited",
          topic: "Insufficient Evidence",
          topicSource: "fallback",
          topicState: "insufficient_evidence",
          topicConfidence: null,
          confidence: { primaryIntent: null },
          warnings: [],
        },
      }),
    )

    const topic = selectCallTopicDisplay(call)
    expect(topic.state).toBe("insufficient_evidence")
    expect(topic.text).toBe("Insufficient Evidence")
  })

  it("maps ended-by labels to business-readable values", () => {
    const callerEnded = normalizeCallRecordLabels(
      baseCall({
        canonical: {
          ...baseCall().canonical!,
          endReason: "caller_hangup",
          outcome: "abandoned",
        },
        classification: {
          ...baseCall().classification!,
          endReason: "caller_hangup",
          outcome: "abandoned",
        },
      }),
    )
    expect(selectCallEndedByDisplay(callerEnded).label).toBe("Caller End")

    const agentEnded = normalizeCallRecordLabels(
      baseCall({
        classification: {
          ...baseCall().classification!,
          endReason: "agent_end",
          outcome: "handled",
        },
      }),
    )
    expect(selectCallEndedByDisplay(agentEnded).label).toBe("Agent End")

    const systemEnded = normalizeCallRecordLabels(
      baseCall({
        canonical: {
          ...baseCall().canonical!,
          endReason: "error",
          outcome: "failed",
          status: "failed",
        },
        classification: {
          ...baseCall().classification!,
          endReason: "error",
          outcome: "failed",
        },
      }),
    )
    expect(selectCallEndedByDisplay(systemEnded).label).toBe("Carrier Dropped")
  })

  it("falls back to Agent for handled/completed calls when end reason is unknown", () => {
    const call = normalizeCallRecordLabels(
      baseCall({
        canonical: {
          ...baseCall().canonical!,
          status: "completed",
          outcome: "handled",
          endReason: "unknown",
          terminalStatusSource: "unknown",
        },
        classification: {
          ...baseCall().classification!,
          status: "completed",
          outcome: "handled",
          endReason: "unknown",
        },
      }),
    )

    expect(selectCallEndedByDisplay(call).label).toBe("Agent End")
  })

  it("falls back to Caller for carrier-abandoned calls with unknown end reason", () => {
    const call = normalizeCallRecordLabels(
      baseCall({
        canonical: {
          ...baseCall().canonical!,
          status: "abandoned",
          outcome: "abandoned",
          endReason: "unknown",
          terminalStatusSource: "carrier",
        },
        classification: {
          ...baseCall().classification!,
          status: "abandoned",
          outcome: "abandoned",
          endReason: "unknown",
        },
      }),
    )

    expect(selectCallEndedByDisplay(call).label).toBe("Carrier Dropped")
  })

  it("does not over-escalate deterministic risk for non-severe failure categories", () => {
    const call = normalizeCallRecordLabels(
      baseCall({
        classification: {
          ...baseCall().classification!,
          failureCategory: "carrier_error",
          actionClass: "review_required",
          outcome: "failed",
        },
        intelligence: null,
      }),
    )
    const risk = selectCallRiskDisplay(call)
    expect(risk.label).toBe("Medium")
  })
})
