import {
  normalizeCanonicalIntentCategory,
  validateCanonicalTerminalTuple,
  type CallIntelligenceEvidence,
  type CallIntelligenceV2,
  type CallIntelligenceWarning,
  type CanonicalActionClass,
  type CanonicalFailureCategory,
  type CanonicalIntentCategory,
  type CanonicalTerminalTuple,
  type CallIntelligencePhase,
} from "@rezovo/core-types";
import { createLogger } from "@rezovo/logging";

import { env } from "../env";
import { withTransaction } from "../persistence/dbClient";
import {
  actionClassWouldDowngrade,
  buildCompactIntelligence,
  compareEnrichmentRevision,
  deriveReviewRecommended,
  intentProxyFromBand,
  normalizeIntelligenceInput,
  parseStoredIntelligence,
  type ScalarSnapshot,
} from "./callIntelligence";

type CallIntelligenceRow = {
  call_id: string;
  org_id: string;
  status: string | null;
  outcome: string | null;
  end_reason: string | null;
  ended_at: string | null;
  started_at: string | null;
  failure_category: string | null;
  action_class: string | null;
  classified_intent: string | null;
  intent_confidence_band: string | null;
  classification_v2: unknown;
  classification_v2_phase: string | null;
  classification_v2_updated_at: string | null;
  call_intelligence_manual_lock: boolean | null;
};

export type UpsertCallIntelligenceInput = {
  callId: string;
  orgId: string;
  source: "rules" | "hybrid_llm";
  model?: string;
  author?: string;
  enrichmentRevision: string;
  phase?: CallIntelligencePhase;
  interpreterMode?: "shadow" | "active";
  interpreterEnabled?: boolean;
  intelligence: unknown;
  warnings?: CallIntelligenceWarning[];
};

export type UpsertCallIntelligenceResult = {
  applied: boolean;
  reason:
    | "applied"
    | "same_revision"
    | "stale_revision"
    | "manual_lock"
    | "outside_retention"
    | "invalid_terminal"
    | "missing_call";
  callId: string;
  orgId: string;
  phase?: CallIntelligencePhase;
  intelligence: CallIntelligenceV2 | null;
  compact: ReturnType<typeof buildCompactIntelligence>;
  warnings: CallIntelligenceWarning[];
};

const logger = createLogger({ service: "platform-api", module: "callIntelligenceService" });

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

const ACTION_SEVERITY: Record<CanonicalActionClass, number> = {
  no_action: 0,
  review_required: 1,
  followup_required: 2,
  escalate_human: 3,
  engineering_investigate: 4,
};

const WARNING_CODES = new Set([
  "missing_transcript_timestamp",
  "null_event_timestamp",
  "invalid_confidence",
  "stale_revision",
  "context_incomplete",
]);

const WARNING_SEVERITY = new Set(["info", "warn", "error"]);

function asFailureCategory(value: unknown): CanonicalFailureCategory {
  if (typeof value === "string" && FAILURE_CATEGORY_VALUES.includes(value as CanonicalFailureCategory)) {
    return value as CanonicalFailureCategory;
  }
  return "unknown";
}

function asActionClass(value: unknown): CanonicalActionClass {
  if (typeof value === "string" && ACTION_CLASS_VALUES.includes(value as CanonicalActionClass)) {
    return value as CanonicalActionClass;
  }
  return "no_action";
}

function warning(
  code: CallIntelligenceWarning["code"],
  field: string,
  message: string,
  severity: CallIntelligenceWarning["severity"] = "warn",
  count = 1,
  sampleIds: string[] = [],
): CallIntelligenceWarning {
  return {
    code,
    severity,
    field,
    message,
    count,
    sampleIds,
    detectedAt: new Date().toISOString(),
  };
}

function sanitizeIncomingWarnings(input: unknown): CallIntelligenceWarning[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => {
      const code = typeof item.code === "string" && WARNING_CODES.has(item.code) ? item.code : "context_incomplete";
      const severity =
        typeof item.severity === "string" && WARNING_SEVERITY.has(item.severity) ? item.severity : "warn";
      const count = typeof item.count === "number" && Number.isFinite(item.count) && item.count > 0
        ? Math.floor(item.count)
        : 1;
      const sampleIds = Array.isArray(item.sampleIds)
        ? item.sampleIds.filter((entry): entry is string => typeof entry === "string").slice(0, 10)
        : [];
      const field = typeof item.field === "string" ? item.field : "intelligence";
      const message = typeof item.message === "string" ? item.message : "warning";
      const detectedAt = typeof item.detectedAt === "string" ? item.detectedAt : new Date().toISOString();
      return {
        code: code as CallIntelligenceWarning["code"],
        severity: severity as CallIntelligenceWarning["severity"],
        field,
        message,
        count,
        sampleIds,
        detectedAt,
      };
    });
}

function resolveInterpreterMode(input: UpsertCallIntelligenceInput): "shadow" | "active" {
  const requested = input.interpreterMode === "active" ? "active" : "shadow";
  if (!env.INTEL_INTERPRETER_ENABLED) return "shadow";
  if (input.interpreterEnabled === false) return "shadow";
  if (input.interpreterEnabled === true) return requested;
  return env.INTEL_INTERPRETER_MODE;
}

function hasStructuredInterpreterPayload(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const payload = input as Record<string, unknown>;
  if (!payload.decision || typeof payload.decision !== "object") return false;
  if (!payload.explanation || typeof payload.explanation !== "object") return false;
  if (!payload.display || typeof payload.display !== "object") return false;
  return true;
}

function isWithinRetentionWindow(endedAtIso: string | null): boolean {
  if (!endedAtIso) return false;
  const endedMs = new Date(endedAtIso).getTime();
  if (!Number.isFinite(endedMs)) return false;
  const retentionMs = Math.max(1, env.INTEL_RECOMPUTE_RETENTION_DAYS) * 24 * 60 * 60 * 1000;
  return Date.now() - endedMs <= retentionMs;
}

function isValidTerminalTuple(row: CallIntelligenceRow): boolean {
  const terminal = validateCanonicalTerminalTuple({
    status: row.status,
    outcome: row.outcome,
    endReason: row.end_reason,
  });
  return terminal.valid;
}

function toScalarSnapshot(row: CallIntelligenceRow): ScalarSnapshot {
  return {
    failureCategory: asFailureCategory(row.failure_category),
    actionClass: asActionClass(row.action_class),
    intentCategory: normalizeCanonicalIntentCategory(row.classified_intent ?? "Unknown"),
  };
}

function maybeRefineFailureCategory(args: {
  current: ScalarSnapshot;
  existing: CallIntelligenceV2 | null;
  proposed: CanonicalFailureCategory;
  confidence: number | null | undefined;
  warnings: CallIntelligenceWarning[];
}): CanonicalFailureCategory {
  const { current, existing, proposed, confidence, warnings } = args;
  if (proposed === "unknown") return current.failureCategory;

  if (current.failureCategory === "unknown") {
    return proposed;
  }

  const modelAuthoredCurrent =
    existing?.provenance.source === "hybrid_llm" &&
    existing.provenance.postRefinement.failureCategory === current.failureCategory;

  if (!modelAuthoredCurrent) {
    warnings.push(
      warning(
        "context_incomplete",
        "decision.failureCategory",
        "skipped failure_category overwrite because current value is deterministic/system-authored",
        "info",
      ),
    );
    return current.failureCategory;
  }

  if (typeof confidence !== "number" || confidence < env.INTEL_FAILURE_REWRITE_THRESHOLD) {
    warnings.push(
      warning(
        "invalid_confidence",
        "confidence.failureCategory",
        `failure_category rewrite requires confidence >= ${env.INTEL_FAILURE_REWRITE_THRESHOLD}`,
      ),
    );
    return current.failureCategory;
  }

  return proposed;
}

function maybeRefineActionClass(args: {
  current: CanonicalActionClass;
  proposed: CanonicalActionClass;
  confidence: number | null | undefined;
  warnings: CallIntelligenceWarning[];
}): CanonicalActionClass {
  const { current, proposed, confidence, warnings } = args;
  if (proposed === current) return current;

  if (actionClassWouldDowngrade(current, proposed)) {
    warnings.push(
      warning(
        "context_incomplete",
        "decision.actionClass",
        "action_class downgrade blocked by deterministic guardrail",
        "info",
      ),
    );
    return current;
  }

  const currentSeverity = ACTION_SEVERITY[current];
  const proposedSeverity = ACTION_SEVERITY[proposed];
  if (proposedSeverity <= currentSeverity) return current;

  if (current === "no_action") {
    return proposed;
  }

  if (typeof confidence !== "number" || confidence < env.INTEL_ACTION_REFINE_THRESHOLD) {
    warnings.push(
      warning(
        "invalid_confidence",
        "confidence.actionClass",
        `action_class escalation requires confidence >= ${env.INTEL_ACTION_REFINE_THRESHOLD}`,
      ),
    );
    return current;
  }

  return proposed;
}

function maybeRefineIntentCategory(args: {
  current: CanonicalIntentCategory;
  currentIntentBand: string | null;
  proposed: CanonicalIntentCategory;
  confidence: number | null | undefined;
  warnings: CallIntelligenceWarning[];
}): CanonicalIntentCategory {
  const { current, currentIntentBand, proposed, confidence, warnings } = args;
  if (proposed === "Unknown") return current;

  const required = intentProxyFromBand(currentIntentBand ?? "unknown") + env.INTEL_INTENT_REFINE_DELTA;
  if (typeof confidence !== "number") {
    warnings.push(
      warning(
        "invalid_confidence",
        "confidence.primaryIntent",
        "intent refinement requires numeric confidence",
      ),
    );
    return current;
  }

  if (confidence < required) {
    warnings.push(
      warning(
        "invalid_confidence",
        "confidence.primaryIntent",
        `intent refinement requires confidence >= ${required.toFixed(2)}`,
        "info",
      ),
    );
    return current;
  }

  return proposed;
}

async function loadCallForIntelligence(callId: string): Promise<CallIntelligenceRow | null> {
  return withTransaction(async (client) => {
    const result = await client.query<CallIntelligenceRow>(
      `SELECT
         call_id,
         org_id,
         status,
         outcome,
         end_reason,
         ended_at,
         started_at,
         failure_category,
         action_class,
         classified_intent,
         intent_confidence_band,
         classification_v2,
         classification_v2_phase,
         classification_v2_updated_at,
         call_intelligence_manual_lock
       FROM calls
       WHERE call_id = $1
       LIMIT 1`,
      [callId],
    );
    return result.rows[0] ?? null;
  });
}

export async function getCallIntelligence(callId: string): Promise<{
  callId: string;
  orgId: string;
  phase: CallIntelligencePhase;
  intelligence: CallIntelligenceV2 | null;
  compact: ReturnType<typeof buildCompactIntelligence>;
  updatedAt: string | null;
  classificationVersion: number;
  enrichmentRevision: string;
  warnings: CallIntelligenceWarning[];
} | null> {
  const row = await loadCallForIntelligence(callId);
  if (!row) return null;

  const parsed = parseStoredIntelligence(row.classification_v2);
  const phase = (parsed?.phase ?? row.classification_v2_phase ?? "provisional") as CallIntelligencePhase;

  return {
    callId: row.call_id,
    orgId: row.org_id,
    phase,
    intelligence: parsed,
    compact: buildCompactIntelligence(parsed),
    updatedAt: row.classification_v2_updated_at,
    classificationVersion: parsed?.provenance.classificationVersion ?? 2,
    enrichmentRevision: parsed?.provenance.enrichmentRevision ?? "",
    warnings: parsed?.provenance.warnings ?? [],
  };
}

export async function upsertCallIntelligence(input: UpsertCallIntelligenceInput): Promise<UpsertCallIntelligenceResult> {
  const row = await loadCallForIntelligence(input.callId);
  if (!row) {
    return {
      applied: false,
      reason: "missing_call",
      callId: input.callId,
      orgId: input.orgId,
      intelligence: null,
      compact: null,
      warnings: [warning("context_incomplete", "callId", "call not found", "error")],
    };
  }

  if (row.org_id !== input.orgId) {
    return {
      applied: false,
      reason: "missing_call",
      callId: input.callId,
      orgId: input.orgId,
      intelligence: null,
      compact: null,
      warnings: [warning("context_incomplete", "orgId", "call/org mismatch", "error")],
    };
  }

  if (!isValidTerminalTuple(row)) {
    return {
      applied: false,
      reason: "invalid_terminal",
      callId: input.callId,
      orgId: input.orgId,
      intelligence: parseStoredIntelligence(row.classification_v2),
      compact: buildCompactIntelligence(parseStoredIntelligence(row.classification_v2)),
      warnings: [warning("context_incomplete", "terminal_tuple", "terminal tuple not finalized")],
    };
  }

  const existing = parseStoredIntelligence(row.classification_v2);
  if (existing?.provenance.enrichmentRevision) {
    const cmp = compareEnrichmentRevision(input.enrichmentRevision, existing.provenance.enrichmentRevision);
    if (cmp === 0) {
      return {
        applied: false,
        reason: "same_revision",
        callId: input.callId,
        orgId: input.orgId,
        phase: existing.phase,
        intelligence: existing,
        compact: buildCompactIntelligence(existing),
        warnings: existing.provenance.warnings,
      };
    }
    if (cmp < 0) {
      const warnings = [
        ...existing.provenance.warnings,
        warning(
          "stale_revision",
          "provenance.enrichmentRevision",
          `incoming revision ${input.enrichmentRevision} is older than stored ${existing.provenance.enrichmentRevision}`,
        ),
      ];
      return {
        applied: false,
        reason: "stale_revision",
        callId: input.callId,
        orgId: input.orgId,
        phase: existing.phase,
        intelligence: existing,
        compact: buildCompactIntelligence(existing),
        warnings,
      };
    }

    if (row.call_intelligence_manual_lock) {
      const warnings = [
        ...existing.provenance.warnings,
        warning(
          "stale_revision",
          "call_intelligence_manual_lock",
          "recompute blocked due to manual lock",
          "warn",
        ),
      ];
      return {
        applied: false,
        reason: "manual_lock",
        callId: input.callId,
        orgId: input.orgId,
        phase: existing.phase,
        intelligence: existing,
        compact: buildCompactIntelligence(existing),
        warnings,
      };
    }

    if (!isWithinRetentionWindow(row.ended_at)) {
      const warnings = [
        ...existing.provenance.warnings,
        warning(
          "stale_revision",
          "classification_v2_updated_at",
          "recompute blocked outside retention window",
          "warn",
        ),
      ];
      return {
        applied: false,
        reason: "outside_retention",
        callId: input.callId,
        orgId: input.orgId,
        phase: existing.phase,
        intelligence: existing,
        compact: buildCompactIntelligence(existing),
        warnings,
      };
    }
  }

  const interpreterMode = resolveInterpreterMode(input);
  const normalized = normalizeIntelligenceInput(input.intelligence);
  const structuredInterpreterPayload = hasStructuredInterpreterPayload(input.intelligence);
  const mergedWarnings = [
    ...sanitizeIncomingWarnings(input.warnings),
    ...normalized.warnings,
  ];
  if (!structuredInterpreterPayload) {
    mergedWarnings.push(
      warning(
        "context_incomplete",
        "intelligence",
        "missing structured interpreter payload fields; preserving deterministic display behavior",
        "warn",
      ),
    );
  }

  const preRefinement = toScalarSnapshot(row);

  const postFailureCategory = maybeRefineFailureCategory({
    current: preRefinement,
    existing,
    proposed: normalized.decision.failureCategory,
    confidence: normalized.confidence.failureCategory,
    warnings: mergedWarnings,
  });

  const postActionClass = maybeRefineActionClass({
    current: preRefinement.actionClass,
    proposed: normalized.decision.actionClass,
    confidence: normalized.confidence.actionClass,
    warnings: mergedWarnings,
  });

  const postIntentCategory = maybeRefineIntentCategory({
    current: preRefinement.intentCategory,
    currentIntentBand: row.intent_confidence_band,
    proposed: normalized.decision.primaryIntent,
    confidence: normalized.confidence.primaryIntent,
    warnings: mergedWarnings,
  });

  const validatedTerminal = validateCanonicalTerminalTuple({
    status: row.status,
    outcome: row.outcome,
    endReason: row.end_reason,
  });
  const operationalTuple = validatedTerminal.normalized as CanonicalTerminalTuple;

  const reviewRecommended = deriveReviewRecommended({
    riskLevel: normalized.decision.riskLevel,
    followupNeeded: normalized.decision.followupNeeded,
    followupSlaClass: normalized.decision.followupSlaClass,
    phase: normalized.phase,
    confidence: normalized.confidence,
    reviewConfidenceFloor: env.INTEL_REVIEW_CONFIDENCE_FLOOR,
  });

  const postRefinement: ScalarSnapshot = {
    failureCategory: postFailureCategory,
    actionClass: postActionClass,
    intentCategory: postIntentCategory,
  };

  const phase = input.phase ?? normalized.phase;
  const explanationEvidence: CallIntelligenceEvidence[] = normalized.explanation.evidence.map((entry) => {
    const kind: CallIntelligenceEvidence["kind"] =
      entry.kind === "transcript" ||
      entry.kind === "tool_event" ||
      entry.kind === "call_event" ||
      entry.kind === "derived_signal"
        ? entry.kind
        : "derived_signal";
    return {
      kind,
      note: entry.note,
      snippet: entry.snippet,
      timestampMs: entry.timestampMs,
      sourceId: entry.sourceId,
    };
  });
  const existingDisplay = existing?.display;
  const shadowDisplay = {
    ...normalized.display,
    summary: normalized.display.summary || existingDisplay?.summary || "Shadow interpreter evaluation recorded.",
    shortReason:
      normalized.display.shortReason ||
      existingDisplay?.shortReason ||
      "Shadow interpreter mode: deterministic/rules labels retained",
  };

  const malformedActiveDisplay = {
    summary: existingDisplay?.summary || "Classification failed; deterministic labels retained.",
    shortReason: "Interpreter output was invalid for this revision",
    recommendedBadge: "classification_failed",
    topic: undefined,
    topicSource: "fallback" as const,
    topicState: "classification_failed" as const,
    topicConfidence: null,
    resolutionLabel: existingDisplay?.resolutionLabel ?? normalized.display.resolutionLabel,
    nextStepLabel: existingDisplay?.nextStepLabel ?? normalized.display.nextStepLabel,
    riskLabel: existingDisplay?.riskLabel ?? normalized.display.riskLabel,
  };

  const effectivePhase: CallIntelligencePhase =
    interpreterMode === "shadow"
      ? existing?.phase ?? phase
      : !structuredInterpreterPayload
        ? "failed"
        : phase;
  const effectiveDisplay =
    interpreterMode === "shadow"
      ? shadowDisplay
      : !structuredInterpreterPayload
        ? malformedActiveDisplay
        : normalized.display;

  const intelligence: CallIntelligenceV2 = {
    version: 2,
    phase: effectivePhase,
    operational: {
      status: operationalTuple.status,
      outcome: operationalTuple.outcome,
      endReason: operationalTuple.endReason,
      failureCategory: postFailureCategory,
      actionClass: postActionClass,
    },
    decision: {
      intents: {
        primary: postIntentCategory,
        secondary: normalized.decision.secondaryIntents,
        callerGoal: normalized.decision.callerGoal,
      },
      followup: {
        needed: normalized.decision.followupNeeded,
        reasonCode: normalized.decision.followupReasonCode,
        slaClass: normalized.decision.followupSlaClass,
        recommendedOwner: normalized.decision.followupRecommendedOwner,
        reviewRecommended,
      },
      resolutionState: normalized.decision.resolutionState,
      failureCategory: postFailureCategory,
      actionClass: postActionClass,
      riskLevel: normalized.decision.riskLevel,
    },
    explanation: {
      rationale: normalized.explanation.rationale,
      evidence: explanationEvidence,
    },
    recommendations: normalized.recommendations,
    signals: normalized.signals,
    confidence: normalized.confidence,
    provenance: {
      source: input.source,
      model: input.model,
      author: input.author,
      generatedAt: new Date().toISOString(),
      classificationVersion: 2,
      enrichmentRevision: input.enrichmentRevision,
      preRefinement,
      postRefinement,
      // Interpreter mode is persisted as an additive metadata field.
      ...(interpreterMode === "shadow" ? { mode: "shadow" as const } : { mode: "active" as const }),
      warnings: mergedWarnings,
    },
    display: effectiveDisplay,
  };

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE calls
       SET
         classification_v2 = $1::jsonb,
         classification_v2_phase = $2,
         classification_v2_updated_at = now(),
         failure_category = $3,
         action_class = $4,
         classified_intent = $5
       WHERE call_id = $6 AND org_id = $7`,
      [
        JSON.stringify(intelligence),
        effectivePhase,
        postFailureCategory,
        postActionClass,
        postIntentCategory,
        input.callId,
        input.orgId,
      ],
    );
  });

  logger.info("call intelligence updated", {
    callId: input.callId,
    orgId: input.orgId,
    phase: effectivePhase,
    source: input.source,
    revision: input.enrichmentRevision,
    interpreterMode,
    shadowAgreement:
      interpreterMode === "shadow"
        ? existing?.display?.topic && normalized.display.topic
          ? existing.display.topic.trim().toLowerCase() === normalized.display.topic.trim().toLowerCase()
          : null
        : undefined,
    warnings: mergedWarnings.length,
  });

  return {
    applied: true,
    reason: "applied",
    callId: input.callId,
    orgId: input.orgId,
    phase: effectivePhase,
    intelligence,
    compact: buildCompactIntelligence(intelligence),
    warnings: mergedWarnings,
  };
}
