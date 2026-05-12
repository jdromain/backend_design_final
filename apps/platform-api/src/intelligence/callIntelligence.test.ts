import { describe, expect, it } from "vitest";
import { buildCompactIntelligence, normalizeIntelligenceInput, parseStoredIntelligence } from "./callIntelligence";

describe("callIntelligence interpreter contract", () => {
  it("normalizes invalid confidence values to null and emits warnings", () => {
    const normalized = normalizeIntelligenceInput({
      phase: "final",
      decision: {
        primaryIntent: "Support",
        secondaryIntents: [],
        callerGoal: "Need help",
        followupNeeded: true,
        followupReasonCode: "customer_request",
        followupSlaClass: "medium",
        followupRecommendedOwner: "agent",
        resolutionState: "partially_resolved",
        failureCategory: "unknown",
        actionClass: "followup_required",
        riskLevel: "medium",
      },
      explanation: { rationale: "r", evidence: [] },
      recommendations: [],
      confidence: {
        primaryIntent: 2,
        resolutionState: -1,
        failureCategory: 0.9,
        actionClass: 0.8,
        recommendations: 0.7,
      },
      display: {
        summary: "summary",
        shortReason: "short",
        topic: "Support request",
        topicConfidence: 4,
      },
      signals: {
        interpreterTopicConfidence: -3,
      },
    });

    expect(normalized.confidence.primaryIntent).toBeNull();
    expect(normalized.confidence.resolutionState).toBeNull();
    expect(normalized.display.topicConfidence).toBeNull();
    expect(normalized.signals.interpreterTopicConfidence).toBeNull();
    expect(normalized.warnings.some((w) => w.code === "invalid_confidence")).toBe(true);
  });

  it("parses interpreter provenance mode and exposes it through compact intelligence", () => {
    const parsed = parseStoredIntelligence({
      version: 2,
      phase: "final",
      operational: {
        status: "completed",
        outcome: "handled",
        endReason: "agent_end",
        failureCategory: "unknown",
        actionClass: "no_action",
      },
      decision: {
        intents: { primary: "Support", secondary: [], callerGoal: "" },
        followup: {
          needed: false,
          reasonCode: "none",
          slaClass: "low",
          recommendedOwner: "agent",
          reviewRecommended: false,
        },
        resolutionState: "resolved",
        failureCategory: "unknown",
        actionClass: "no_action",
        riskLevel: "low",
      },
      explanation: { rationale: "r", evidence: [] },
      recommendations: [],
      signals: {},
      confidence: {
        primaryIntent: 0.95,
        resolutionState: 0.95,
        failureCategory: 0.95,
        actionClass: 0.95,
        recommendations: 0.95,
      },
      provenance: {
        source: "hybrid_llm",
        mode: "shadow",
        generatedAt: new Date().toISOString(),
        classificationVersion: 2,
        enrichmentRevision: "2:topic:v1:gpt-4o-mini:v1",
        preRefinement: {
          failureCategory: "unknown",
          actionClass: "review_required",
          intentCategory: "Unknown",
        },
        postRefinement: {
          failureCategory: "unknown",
          actionClass: "no_action",
          intentCategory: "Support",
        },
        warnings: [],
      },
      display: {
        summary: "summary",
        shortReason: "short",
        topic: "Support request",
        topicSource: "semantic_transcript",
        topicState: "final",
        topicConfidence: 0.92,
        resolutionLabel: "Resolved",
        nextStepLabel: "No Action",
        riskLabel: "Low",
      },
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.provenance.mode).toBe("shadow");
    const compact = buildCompactIntelligence(parsed!);
    expect(compact.interpreterMode).toBe("shadow");
  });
});

