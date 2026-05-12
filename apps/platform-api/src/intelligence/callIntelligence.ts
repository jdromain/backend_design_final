import {
  normalizeCanonicalIntentCategory,
  type CallIntelligenceConfidence,
  type CallIntelligencePhase,
  type CallIntelligenceV2,
  type CanonicalActionClass,
  type CanonicalCallStatus,
  type CanonicalEndReason,
  type CanonicalFailureCategory,
  type CanonicalIntentCategory,
  type CanonicalOutcome,
  type CallIntelligenceWarning,
  type CallIntelligenceRiskLevel,
  type CallIntelligenceTopicSource,
  type CallIntelligenceTopicState,
} from "@rezovo/core-types";

const FAILURE_CATEGORY_VALUES: CanonicalFailureCategory[] = [
  "carrier_error",
  "stt_error",
  "tts_error",
  "llm_error",
  "tool_error",
  "config_error",
  "auth_error",
  "quota_error",
  "unknown",
];

const ACTION_CLASS_VALUES: CanonicalActionClass[] = [
  "no_action",
  "review_required",
  "followup_required",
  "escalate_human",
  "engineering_investigate",
];

const STATUS_VALUES: CanonicalCallStatus[] = [
  "initiated",
  "ringing",
  "in_progress",
  "completed",
  "failed",
  "abandoned",
  "transferred",
  "unknown",
];

const OUTCOME_VALUES: CanonicalOutcome[] = ["handled", "failed", "abandoned", "transferred", "unknown"];
const END_REASON_VALUES: CanonicalEndReason[] = [
  "caller_hangup",
  "agent_end",
  "transfer",
  "timeout",
  "error",
  "quota_denied",
  "unknown",
];

const PHASE_VALUES: CallIntelligencePhase[] = ["provisional", "pending_context", "final", "failed"];

const ACTION_SEVERITY: Record<CanonicalActionClass, number> = {
  no_action: 0,
  review_required: 1,
  followup_required: 2,
  escalate_human: 3,
  engineering_investigate: 4,
};

const BAND_PROXY: Record<string, number> = {
  low: 0.4,
  medium: 0.65,
  high: 0.85,
  unknown: 0.35,
};

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function coerceEnum<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === "string" && (values as readonly string[]).includes(value) ? (value as T) : fallback;
}

function normalizeConfidence(
  field: keyof CallIntelligenceConfidence,
  value: unknown,
  warnings: CallIntelligenceWarning[],
): number | null {
  if (value === undefined || value === null) return null;
  const n = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    warnings.push({
      code: "invalid_confidence",
      severity: "warn",
      field: `confidence.${field}`,
      message: "confidence must be between 0.0 and 1.0",
      count: 1,
      sampleIds: [],
      detectedAt: new Date().toISOString(),
    });
    return null;
  }
  return n;
}

function normalizeDisplayConfidence(
  field: string,
  value: unknown,
  warnings: CallIntelligenceWarning[],
): number | null {
  if (value === undefined || value === null) return null;
  const n = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    warnings.push({
      code: "invalid_confidence",
      severity: "warn",
      field,
      message: "confidence must be between 0.0 and 1.0",
      count: 1,
      sampleIds: [],
      detectedAt: new Date().toISOString(),
    });
    return null;
  }
  return n;
}

export function compareEnrichmentRevision(incoming: string, current: string): -1 | 0 | 1 {
  if (incoming === current) return 0;
  const partsA = incoming.split(":");
  const partsB = current.split(":");
  const len = Math.max(partsA.length, partsB.length);

  const cmpToken = (a: string, b: string): number => {
    const segA = a.split(".");
    const segB = b.split(".");
    const numeric = segA.every((x) => /^\d+$/.test(x)) && segB.every((x) => /^\d+$/.test(x));
    if (numeric) {
      const max = Math.max(segA.length, segB.length);
      for (let i = 0; i < max; i += 1) {
        const na = Number(segA[i] ?? "0");
        const nb = Number(segB[i] ?? "0");
        if (na > nb) return 1;
        if (na < nb) return -1;
      }
      return 0;
    }
    return a.localeCompare(b);
  };

  for (let i = 0; i < len; i += 1) {
    const a = partsA[i] ?? "";
    const b = partsB[i] ?? "";
    const cmp = cmpToken(a, b);
    if (cmp > 0) return 1;
    if (cmp < 0) return -1;
  }
  return incoming.localeCompare(current) > 0 ? 1 : -1;
}

export type ScalarSnapshot = {
  failureCategory: CanonicalFailureCategory;
  actionClass: CanonicalActionClass;
  intentCategory: CanonicalIntentCategory;
};

export function deriveReviewRecommended(args: {
  riskLevel: CallIntelligenceRiskLevel;
  followupNeeded: boolean;
  followupSlaClass: "low" | "medium" | "high";
  phase: CallIntelligencePhase;
  confidence: CallIntelligenceConfidence;
  reviewConfidenceFloor: number;
}): boolean {
  if (args.riskLevel === "high") return true;
  if (args.phase === "failed") return true;
  if (args.followupNeeded && args.followupSlaClass === "high") return true;
  const confidenceValues = [
    args.confidence.primaryIntent,
    args.confidence.failureCategory,
    args.confidence.actionClass,
    args.confidence.recommendations,
  ];
  return confidenceValues.some((v) => typeof v === "number" && v < args.reviewConfidenceFloor);
}

export function normalizeIntelligenceInput(input: any): {
  phase: CallIntelligencePhase;
  confidence: CallIntelligenceConfidence;
  warnings: CallIntelligenceWarning[];
  decision: {
    primaryIntent: CanonicalIntentCategory;
    secondaryIntents: CanonicalIntentCategory[];
    callerGoal: string;
    followupNeeded: boolean;
    followupReasonCode: "unknown_intent" | "customer_request" | "handoff" | "failure_recovery" | "policy" | "none";
    followupSlaClass: "low" | "medium" | "high";
    followupRecommendedOwner: "agent" | "ops" | "engineering" | "human_supervisor";
    resolutionState: "resolved" | "partially_resolved" | "unresolved" | "unknown";
    failureCategory: CanonicalFailureCategory;
    actionClass: CanonicalActionClass;
    riskLevel: CallIntelligenceRiskLevel;
  };
  explanation: { rationale: string; evidence: Array<{ kind: string; note: string; snippet?: string; timestampMs?: number; sourceId?: string }> };
  recommendations: Array<{ action: string; reason: string; priority: "low" | "medium" | "high" }>;
  signals: {
    toolsUsedCount?: number;
    toolErrorsCount?: number;
    transferRequested?: boolean;
    silenceRisk?: boolean;
    tokenUsage?: number;
    durationSec?: number;
    evidenceScore?: number;
    evidenceGrade?: "strong" | "moderate" | "weak";
    interpreterMode?: "shadow" | "active";
    interpreterEnabled?: boolean;
    interpreterModel?: string;
    interpreterTopicCandidate?: string;
    interpreterTopicConfidence?: number | null;
    shadowAgreement?: boolean | null;
  };
  display: {
    summary: string;
    shortReason: string;
    recommendedBadge?: string;
    topic?: string;
    topicSource?: CallIntelligenceTopicSource;
    topicState?: CallIntelligenceTopicState;
    topicConfidence?: number | null;
    resolutionLabel?: string;
    nextStepLabel?: string;
    riskLabel?: "Low" | "Medium" | "High";
  };
} {
  const warnings: CallIntelligenceWarning[] = [];
  const confidence: CallIntelligenceConfidence = {
    primaryIntent: normalizeConfidence("primaryIntent", input?.confidence?.primaryIntent, warnings),
    resolutionState: normalizeConfidence("resolutionState", input?.confidence?.resolutionState, warnings),
    failureCategory: normalizeConfidence("failureCategory", input?.confidence?.failureCategory, warnings),
    actionClass: normalizeConfidence("actionClass", input?.confidence?.actionClass, warnings),
    recommendations: normalizeConfidence("recommendations", input?.confidence?.recommendations, warnings),
  };

  const secondary = Array.isArray(input?.decision?.secondaryIntents)
    ? input.decision.secondaryIntents.map((v: unknown) => normalizeCanonicalIntentCategory(asString(v, "Unknown")))
    : [];

  const evidence = Array.isArray(input?.explanation?.evidence)
    ? input.explanation.evidence
        .filter((e: any) => e && typeof e === "object")
        .map((e: any) => ({
          kind: asString(e.kind, "derived_signal"),
          note: asString(e.note, ""),
          snippet: typeof e.snippet === "string" ? e.snippet.slice(0, 280) : undefined,
          timestampMs: typeof e.timestampMs === "number" && Number.isFinite(e.timestampMs) ? Math.max(0, Math.floor(e.timestampMs)) : undefined,
          sourceId: typeof e.sourceId === "string" ? e.sourceId : undefined,
        }))
        .filter((e: any) => e.note.length > 0)
    : [];

  const recommendations = Array.isArray(input?.recommendations)
    ? input.recommendations
        .filter((r: any) => r && typeof r === "object")
        .map((r: any) => ({
          action: asString(r.action, ""),
          reason: asString(r.reason, ""),
          priority: coerceEnum(r.priority, ["low", "medium", "high"] as const, "medium"),
        }))
        .filter((r: any) => r.action.length > 0)
    : [];

  const riskLevel = coerceEnum(input?.decision?.riskLevel, ["low", "medium", "high"] as const, "medium");
  const phase = coerceEnum(input?.phase, PHASE_VALUES, "final");

  return {
    phase,
    confidence,
    warnings,
    decision: {
      primaryIntent: normalizeCanonicalIntentCategory(asString(input?.decision?.primaryIntent, "Unknown")),
      secondaryIntents: secondary,
      callerGoal: asString(input?.decision?.callerGoal, "").slice(0, 600),
      followupNeeded: Boolean(input?.decision?.followupNeeded),
      followupReasonCode: coerceEnum(
        input?.decision?.followupReasonCode,
        ["unknown_intent", "customer_request", "handoff", "failure_recovery", "policy", "none"] as const,
        "none",
      ),
      followupSlaClass: coerceEnum(input?.decision?.followupSlaClass, ["low", "medium", "high"] as const, "low"),
      followupRecommendedOwner: coerceEnum(
        input?.decision?.followupRecommendedOwner,
        ["agent", "ops", "engineering", "human_supervisor"] as const,
        "agent",
      ),
      resolutionState: coerceEnum(
        input?.decision?.resolutionState,
        ["resolved", "partially_resolved", "unresolved", "unknown"] as const,
        "unknown",
      ),
      failureCategory: coerceEnum(input?.decision?.failureCategory, FAILURE_CATEGORY_VALUES, "unknown"),
      actionClass: coerceEnum(input?.decision?.actionClass, ACTION_CLASS_VALUES, "no_action"),
      riskLevel,
    },
    explanation: {
      rationale: asString(input?.explanation?.rationale, "").slice(0, 1400),
      evidence,
    },
    recommendations,
    signals: {
      toolsUsedCount: typeof input?.signals?.toolsUsedCount === "number" ? Math.max(0, Math.floor(input.signals.toolsUsedCount)) : undefined,
      toolErrorsCount: typeof input?.signals?.toolErrorsCount === "number" ? Math.max(0, Math.floor(input.signals.toolErrorsCount)) : undefined,
      transferRequested: typeof input?.signals?.transferRequested === "boolean" ? input.signals.transferRequested : undefined,
      silenceRisk: typeof input?.signals?.silenceRisk === "boolean" ? input.signals.silenceRisk : undefined,
      tokenUsage: typeof input?.signals?.tokenUsage === "number" ? Math.max(0, Math.floor(input.signals.tokenUsage)) : undefined,
      durationSec: typeof input?.signals?.durationSec === "number" ? Math.max(0, Math.floor(input.signals.durationSec)) : undefined,
      evidenceScore:
        typeof input?.signals?.evidenceScore === "number" && Number.isFinite(input.signals.evidenceScore)
          ? Math.max(0, Math.min(1, input.signals.evidenceScore))
          : undefined,
      evidenceGrade:
        input?.signals?.evidenceGrade === "strong" ||
        input?.signals?.evidenceGrade === "moderate" ||
        input?.signals?.evidenceGrade === "weak"
          ? input.signals.evidenceGrade
          : undefined,
      interpreterMode:
        input?.signals?.interpreterMode === "shadow" || input?.signals?.interpreterMode === "active"
          ? input.signals.interpreterMode
          : undefined,
      interpreterEnabled:
        typeof input?.signals?.interpreterEnabled === "boolean" ? input.signals.interpreterEnabled : undefined,
      interpreterModel:
        typeof input?.signals?.interpreterModel === "string" && input.signals.interpreterModel.trim().length > 0
          ? input.signals.interpreterModel.slice(0, 120)
          : undefined,
      interpreterTopicCandidate:
        typeof input?.signals?.interpreterTopicCandidate === "string" &&
        input.signals.interpreterTopicCandidate.trim().length > 0
          ? input.signals.interpreterTopicCandidate.trim().slice(0, 240)
          : undefined,
      interpreterTopicConfidence: normalizeDisplayConfidence(
        "signals.interpreterTopicConfidence",
        input?.signals?.interpreterTopicConfidence,
        warnings,
      ),
      shadowAgreement:
        typeof input?.signals?.shadowAgreement === "boolean" || input?.signals?.shadowAgreement === null
          ? (input.signals.shadowAgreement as boolean | null)
          : undefined,
    },
    display: {
      summary: asString(input?.display?.summary, "").slice(0, 240),
      shortReason: asString(input?.display?.shortReason, "").slice(0, 160),
      recommendedBadge: typeof input?.display?.recommendedBadge === "string" ? input.display.recommendedBadge.slice(0, 64) : undefined,
      topic:
        typeof input?.display?.topic === "string" && input.display.topic.trim().length > 0
          ? input.display.topic.trim().slice(0, 240)
          : undefined,
      topicSource: coerceEnum(
        input?.display?.topicSource,
        ["semantic_transcript", "intent_context", "deterministic_context", "fallback"] as const,
        "fallback",
      ),
      topicState: coerceEnum(
        input?.display?.topicState,
        ["final", "provisional", "pending_analysis", "insufficient_evidence", "classification_failed", "true_unknown"] as const,
        "true_unknown",
      ),
      topicConfidence: normalizeDisplayConfidence("display.topicConfidence", input?.display?.topicConfidence, warnings),
      resolutionLabel:
        typeof input?.display?.resolutionLabel === "string" && input.display.resolutionLabel.trim().length > 0
          ? input.display.resolutionLabel.trim().slice(0, 96)
          : undefined,
      nextStepLabel:
        typeof input?.display?.nextStepLabel === "string" && input.display.nextStepLabel.trim().length > 0
          ? input.display.nextStepLabel.trim().slice(0, 96)
          : undefined,
      riskLabel:
        input?.display?.riskLabel === "Low" ||
        input?.display?.riskLabel === "Medium" ||
        input?.display?.riskLabel === "High"
          ? input.display.riskLabel
          : undefined,
    },
  };
}

export function actionClassWouldDowngrade(current: CanonicalActionClass, proposed: CanonicalActionClass): boolean {
  return ACTION_SEVERITY[proposed] < ACTION_SEVERITY[current];
}

export function intentProxyFromBand(inputBand: unknown): number {
  const key = typeof inputBand === "string" ? inputBand.toLowerCase() : "unknown";
  return BAND_PROXY[key] ?? BAND_PROXY.unknown;
}

export function buildCompactIntelligence(intel: CallIntelligenceV2 | null | undefined): {
  phase: CallIntelligencePhase;
  riskLevel: CallIntelligenceRiskLevel;
  followupNeeded: boolean;
  reviewRecommended: boolean;
  interpreterMode?: "shadow" | "active";
  summary: string;
  shortReason: string;
  topic?: string;
  topicSource?: CallIntelligenceTopicSource;
  topicState?: CallIntelligenceTopicState;
  topicConfidence?: number | null;
  resolutionLabel?: string;
  nextStepLabel?: string;
  riskLabel?: "Low" | "Medium" | "High";
  confidence: CallIntelligenceConfidence;
  warnings: CallIntelligenceWarning[];
} | null {
  if (!intel) return null;
  return {
    phase: intel.phase,
    riskLevel: intel.decision.riskLevel,
    followupNeeded: intel.decision.followup.needed,
    reviewRecommended: intel.decision.followup.reviewRecommended,
    interpreterMode: intel.provenance.mode,
    summary: intel.display.summary,
    shortReason: intel.display.shortReason,
    topic: intel.display.topic,
    topicSource: intel.display.topicSource,
    topicState: intel.display.topicState,
    topicConfidence: intel.display.topicConfidence,
    resolutionLabel: intel.display.resolutionLabel,
    nextStepLabel: intel.display.nextStepLabel,
    riskLabel: intel.display.riskLabel,
    confidence: intel.confidence,
    warnings: intel.provenance.warnings,
  };
}

export function parseStoredIntelligence(raw: unknown): CallIntelligenceV2 | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Record<string, unknown>;
  if (candidate.version !== 2) return null;
  const phase = coerceEnum(candidate.phase, PHASE_VALUES, "provisional");
  const operational = candidate.operational as Record<string, unknown> | undefined;
  const decision = candidate.decision as Record<string, unknown> | undefined;
  const confidence = candidate.confidence as Record<string, unknown> | undefined;
  const provenance = candidate.provenance as Record<string, unknown> | undefined;
  const explanation = candidate.explanation as Record<string, unknown> | undefined;
  const display = candidate.display as Record<string, unknown> | undefined;

  return {
    version: 2,
    phase,
    operational: {
      status: coerceEnum(operational?.status, STATUS_VALUES, "unknown"),
      outcome: coerceEnum(operational?.outcome, OUTCOME_VALUES, "unknown"),
      endReason: coerceEnum(operational?.endReason, END_REASON_VALUES, "unknown"),
      failureCategory: coerceEnum(operational?.failureCategory, FAILURE_CATEGORY_VALUES, "unknown"),
      actionClass: coerceEnum(operational?.actionClass, ACTION_CLASS_VALUES, "no_action"),
    },
    decision: {
      intents: {
        primary: normalizeCanonicalIntentCategory(asString((decision?.intents as any)?.primary, "Unknown")),
        secondary: Array.isArray((decision?.intents as any)?.secondary)
          ? (decision?.intents as any).secondary.map((x: unknown) => normalizeCanonicalIntentCategory(asString(x, "Unknown")))
          : [],
        callerGoal: asString((decision?.intents as any)?.callerGoal, ""),
      },
      followup: {
        needed: Boolean((decision?.followup as any)?.needed),
        reasonCode: coerceEnum(
          (decision?.followup as any)?.reasonCode,
          ["unknown_intent", "customer_request", "handoff", "failure_recovery", "policy", "none"] as const,
          "none",
        ),
        slaClass: coerceEnum((decision?.followup as any)?.slaClass, ["low", "medium", "high"] as const, "low"),
        recommendedOwner: coerceEnum(
          (decision?.followup as any)?.recommendedOwner,
          ["agent", "ops", "engineering", "human_supervisor"] as const,
          "agent",
        ),
        reviewRecommended: Boolean((decision?.followup as any)?.reviewRecommended),
      },
      resolutionState: coerceEnum(decision?.resolutionState, ["resolved", "partially_resolved", "unresolved", "unknown"] as const, "unknown"),
      failureCategory: coerceEnum(decision?.failureCategory, FAILURE_CATEGORY_VALUES, "unknown"),
      actionClass: coerceEnum(decision?.actionClass, ACTION_CLASS_VALUES, "no_action"),
      riskLevel: coerceEnum(decision?.riskLevel, ["low", "medium", "high"] as const, "medium"),
    },
    explanation: {
      rationale: asString(explanation?.rationale, ""),
      evidence: Array.isArray(explanation?.evidence) ? (explanation?.evidence as any[]) : [],
    },
    recommendations: Array.isArray(candidate.recommendations) ? (candidate.recommendations as any[]) : [],
    signals: typeof candidate.signals === "object" && candidate.signals ? (candidate.signals as any) : {},
    confidence: {
      primaryIntent: typeof confidence?.primaryIntent === "number" ? confidence.primaryIntent : null,
      resolutionState: typeof confidence?.resolutionState === "number" ? confidence.resolutionState : null,
      failureCategory: typeof confidence?.failureCategory === "number" ? confidence.failureCategory : null,
      actionClass: typeof confidence?.actionClass === "number" ? confidence.actionClass : null,
      recommendations: typeof confidence?.recommendations === "number" ? confidence.recommendations : null,
    },
    provenance: {
      source: coerceEnum(provenance?.source, ["rules", "hybrid_llm"] as const, "rules"),
      model: typeof provenance?.model === "string" ? provenance.model : undefined,
      author: typeof provenance?.author === "string" ? provenance.author : undefined,
      mode: coerceEnum(provenance?.mode, ["shadow", "active"] as const, "active"),
      generatedAt: asString(provenance?.generatedAt, new Date().toISOString()),
      classificationVersion: 2,
      enrichmentRevision: asString(provenance?.enrichmentRevision, ""),
      preRefinement: {
        failureCategory: coerceEnum((provenance?.preRefinement as any)?.failureCategory, FAILURE_CATEGORY_VALUES, "unknown"),
        actionClass: coerceEnum((provenance?.preRefinement as any)?.actionClass, ACTION_CLASS_VALUES, "no_action"),
        intentCategory: normalizeCanonicalIntentCategory(asString((provenance?.preRefinement as any)?.intentCategory, "Unknown")),
      },
      postRefinement: {
        failureCategory: coerceEnum((provenance?.postRefinement as any)?.failureCategory, FAILURE_CATEGORY_VALUES, "unknown"),
        actionClass: coerceEnum((provenance?.postRefinement as any)?.actionClass, ACTION_CLASS_VALUES, "no_action"),
        intentCategory: normalizeCanonicalIntentCategory(asString((provenance?.postRefinement as any)?.intentCategory, "Unknown")),
      },
      warnings: Array.isArray(provenance?.warnings) ? (provenance?.warnings as any[]) : [],
    },
    display: {
      summary: asString(display?.summary, ""),
      shortReason: asString(display?.shortReason, ""),
      recommendedBadge: typeof display?.recommendedBadge === "string" ? display.recommendedBadge : undefined,
      topic: typeof display?.topic === "string" ? display.topic : undefined,
      topicSource: coerceEnum(
        display?.topicSource,
        ["semantic_transcript", "intent_context", "deterministic_context", "fallback"] as const,
        "fallback",
      ),
      topicState: coerceEnum(
        display?.topicState,
        ["final", "provisional", "pending_analysis", "insufficient_evidence", "classification_failed", "true_unknown"] as const,
        "true_unknown",
      ),
      topicConfidence: typeof display?.topicConfidence === "number" ? display.topicConfidence : null,
      resolutionLabel: typeof display?.resolutionLabel === "string" ? display.resolutionLabel : undefined,
      nextStepLabel: typeof display?.nextStepLabel === "string" ? display.nextStepLabel : undefined,
      riskLabel:
        display?.riskLabel === "Low" || display?.riskLabel === "Medium" || display?.riskLabel === "High"
          ? display.riskLabel
          : undefined,
    },
  };
}
