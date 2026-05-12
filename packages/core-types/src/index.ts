export type RouteType = "ai" | "queue" | "voicemail";

export type EventType =
  | "CallStarted"
  | "CallEnded"
  | "UsageReported"
  | "ConfigChanged"
  | "DocIngestRequested"
  | "AppointmentUpdated"
  | "ToolUsed"
  | "VoicemailReferenceCreated";

export type EventEnvelope<T> = {
  event_id: string;
  event_type: EventType;
  org_id: string;
  call_id?: string;
  timestamp: string;
  payload: T;
};

export type PhoneNumberConfig = {
  did: string;
  orgId: string;
  businessId: string;
  routeType: RouteType;
  agentConfigId?: string;
  queueExtension?: string;
};

export type AgentPersona = "receptionist" | "scheduler" | "support";

export type OpeningHours = Record<string, Array<{ open: string; close: string }>>;

export type EscalationRules = {
  escalateOnExplicitRequest?: boolean;
  escalateOnPolicyHit?: boolean;
  retryLimit?: number;
  fallbackQueueExtension?: string;
};

export type BookingProvider = "calendly" | "opentable" | "none";

export type CalendlyIntegration = {
  accessToken: string;
  refreshToken?: string;
  eventTypeUri: string;
  organizationUri?: string;
  timezone: string;
};

export type OpenTableIntegration = {
  restaurantId: string;
};

export type AgentConfigSnapshot = {
  id: string;
  version: number;
  orgId: string;
  businessId: string;
  basePrompt: string;
  persona: AgentPersona;
  openingHours: OpeningHours;
  languagePrefs: string[];
  llmProfileId: string;
  toolAccess: string[];
  kbNamespace: string;
  maxCallDurationSec: number;
  escalationRules: EscalationRules;
  bookingProvider?: BookingProvider;
  calendly?: CalendlyIntegration;
  opentable?: OpenTableIntegration;
};

export type PlanSnapshot = {
  orgId: string;
  planId: string;
  maxConcurrentCalls: number | null;
};

export type CallTranscriptEntry = {
  from: "user" | "agent";
  text: string;
  timestamp: string;
};

export type CallSessionContext = {
  callId: string;
  orgId: string;
  businessId: string;
  phoneNumberConfig: PhoneNumberConfig;
  agentConfig: AgentConfigSnapshot;
  slots: {
    callerName?: string;
    callbackNumber?: string;
    reason?: string;
    desiredTime?: string;
  };
  transcript: CallTranscriptEntry[];
  kbContext?: string;
  startedAt: Date;
};

export type CanonicalCallStatus =
  | "initiated"
  | "ringing"
  | "in_progress"
  | "completed"
  | "failed"
  | "abandoned"
  | "transferred"
  | "unknown";

export type CanonicalOutcome = "handled" | "failed" | "abandoned" | "transferred" | "unknown";

export type CanonicalEndReason =
  | "caller_hangup"
  | "agent_end"
  | "transfer"
  | "timeout"
  | "error"
  | "quota_denied"
  | "unknown";

export type CanonicalIntentSource = "model_classifier" | "agent_inference" | "human_override" | "unknown";

export type CanonicalConfidenceBand = "high" | "medium" | "low" | "unknown";
export type CanonicalFailureCategory =
  | "carrier_error"
  | "stt_error"
  | "tts_error"
  | "llm_error"
  | "tool_error"
  | "config_error"
  | "auth_error"
  | "quota_error"
  | "unknown";

export type CanonicalActionClass =
  | "no_action"
  | "review_required"
  | "followup_required"
  | "escalate_human"
  | "engineering_investigate";

export type CanonicalIntentCategory = "Billing" | "Support" | "Sales" | "Booking" | "Unknown";

export type CanonicalToolSummary = {
  toolsUsedCount: number;
  toolErrorsCount: number;
  primaryFailedTool: string;
  toolFailureClass: CanonicalFailureCategory;
};

export type CanonicalClassification = {
  status: CanonicalCallStatus;
  outcome: CanonicalOutcome;
  endReason: CanonicalEndReason;
  failureCategory: CanonicalFailureCategory;
  intentCategory: CanonicalIntentCategory;
  intentConfidenceBand: CanonicalConfidenceBand;
  actionClass: CanonicalActionClass;
  toolSummary: CanonicalToolSummary;
  provenance: {
    terminalStatusSource: "realtime" | "carrier" | "system" | "unknown";
    intentSource: CanonicalIntentSource;
    labelVersion: number;
  };
};

export type CanonicalTerminalStatus = Exclude<
  CanonicalCallStatus,
  "initiated" | "ringing" | "in_progress" | "unknown"
>;

export type CanonicalTerminalOutcome = Exclude<CanonicalOutcome, "unknown">;

export type CanonicalTerminalTuple = {
  status: CanonicalTerminalStatus;
  outcome: CanonicalTerminalOutcome;
  endReason: CanonicalEndReason;
};

export type CanonicalTupleValidation = {
  valid: boolean;
  normalized: CanonicalTerminalTuple;
  reason?: string;
};

export const CANONICAL_UNKNOWN_VALUE = "unknown" as const;

const TERMINAL_STATUS_SET = new Set<CanonicalTerminalStatus>([
  "completed",
  "failed",
  "abandoned",
  "transferred",
]);

const NON_TERMINAL_STATUS_SET = new Set<CanonicalCallStatus>(["initiated", "ringing", "in_progress", "unknown"]);

export const CANONICAL_TERMINAL_TUPLES: readonly CanonicalTerminalTuple[] = [
  { status: "completed", outcome: "handled", endReason: "agent_end" },
  { status: "completed", outcome: "handled", endReason: "unknown" },
  { status: "transferred", outcome: "transferred", endReason: "transfer" },
  { status: "transferred", outcome: "transferred", endReason: "unknown" },
  { status: "abandoned", outcome: "abandoned", endReason: "caller_hangup" },
  { status: "abandoned", outcome: "abandoned", endReason: "timeout" },
  { status: "abandoned", outcome: "abandoned", endReason: "unknown" },
  { status: "failed", outcome: "failed", endReason: "error" },
  { status: "failed", outcome: "failed", endReason: "timeout" },
  { status: "failed", outcome: "failed", endReason: "quota_denied" },
  { status: "failed", outcome: "failed", endReason: "unknown" },
] as const;

const CANONICAL_TERMINAL_TUPLE_KEYS = new Set<string>(
  CANONICAL_TERMINAL_TUPLES.map((tuple) => `${tuple.status}:${tuple.outcome}:${tuple.endReason}`)
);

export function isCanonicalTerminalStatus(status: string | null | undefined): status is CanonicalTerminalStatus {
  return TERMINAL_STATUS_SET.has(status as CanonicalTerminalStatus);
}

export function isCanonicalNonTerminalStatus(status: string | null | undefined): status is CanonicalCallStatus {
  return NON_TERMINAL_STATUS_SET.has(status as CanonicalCallStatus);
}

export function toCanonicalConfidenceBand(confidence: number | null | undefined): CanonicalConfidenceBand {
  if (typeof confidence !== "number" || Number.isNaN(confidence)) return "unknown";
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.5) return "medium";
  return "low";
}

export function validateCanonicalTerminalTuple(input: {
  status?: string | null;
  outcome?: string | null;
  endReason?: string | null;
}): CanonicalTupleValidation {
  const normalized: CanonicalTerminalTuple = {
    status: isCanonicalTerminalStatus(input.status) ? input.status : "failed",
    outcome: (input.outcome === "handled" ||
      input.outcome === "failed" ||
      input.outcome === "abandoned" ||
      input.outcome === "transferred"
      ? input.outcome
      : "failed") as CanonicalTerminalOutcome,
    endReason: (input.endReason === "caller_hangup" ||
      input.endReason === "agent_end" ||
      input.endReason === "transfer" ||
      input.endReason === "timeout" ||
      input.endReason === "error" ||
      input.endReason === "quota_denied" ||
      input.endReason === "unknown"
      ? input.endReason
      : "unknown") as CanonicalEndReason,
  };

  const key = `${normalized.status}:${normalized.outcome}:${normalized.endReason}`;
  if (!CANONICAL_TERMINAL_TUPLE_KEYS.has(key)) {
    return {
      valid: false,
      normalized: { status: "failed", outcome: "failed", endReason: "unknown" },
      reason: `invalid terminal tuple: ${key}`,
    };
  }
  return { valid: true, normalized };
}

export type CanonicalDisplayLabels = {
  statusLabel: string;
  resultLabel: string;
  reasonLabel: string;
  intentLabel: string;
  toolsLabel: string;
  failureTypeLabel: string;
};

export type CanonicalDisplayMapperInput = {
  status?: string | null;
  outcome?: string | null;
  endReason?: string | null;
  intent?: string | null;
  toolsUsedCount?: number | null;
  toolErrorCount?: number | null;
  failureType?: string | null;
};

function normalizeUnknownString(value?: string | null): string {
  if (!value || value.trim().length === 0) return "Unknown";
  if (value === "unknown") return "Unknown";
  return value;
}

export function normalizeCanonicalIntentCategory(value?: string | null): CanonicalIntentCategory {
  switch (value) {
    case "Billing":
    case "Support":
    case "Sales":
    case "Booking":
    case "Unknown":
      return value;
    default:
      return "Unknown";
  }
}

export function inferFailureCategoryFromString(value?: string | null): CanonicalFailureCategory {
  const v = (value ?? "").trim().toLowerCase();
  if (!v) return "unknown";
  if (v.includes("quota")) return "quota_error";
  if (v.includes("tool")) return "tool_error";
  if (v.includes("stt") || v.includes("deepgram") || v.includes("transcript")) return "stt_error";
  if (v.includes("tts") || v.includes("eleven") || v.includes("synth")) return "tts_error";
  if (v.includes("llm") || v.includes("model") || v.includes("openai")) return "llm_error";
  if (
    v.includes("carrier") ||
    v.includes("twilio") ||
    v.includes("sip") ||
    v.includes("busy") ||
    v.includes("no-answer") ||
    v.includes("canceled")
  ) {
    return "carrier_error";
  }
  if (v.includes("auth") || v.includes("signature") || v.includes("unauthor")) return "auth_error";
  if (v.includes("config") || v.includes("missing_") || v.includes("route")) return "config_error";
  return "unknown";
}

export function deriveCanonicalFailureCategory(input: {
  outcome?: string | null;
  failureType?: string | null;
  toolErrorsCount?: number | null;
  endReason?: string | null;
  toolFailureClass?: CanonicalFailureCategory | null;
}): CanonicalFailureCategory {
  if (input.outcome !== "failed") return "unknown";

  const fromFailureType = inferFailureCategoryFromString(input.failureType);
  if (fromFailureType !== "unknown") return fromFailureType;

  if (input.toolFailureClass && input.toolFailureClass !== "unknown") return input.toolFailureClass;
  if ((input.toolErrorsCount ?? 0) > 0) return "tool_error";

  if (input.endReason === "quota_denied") return "quota_error";
  if (input.endReason === "error") return "unknown";
  if (input.endReason === "timeout") return "unknown";
  return "unknown";
}

export function deriveCanonicalActionClass(input: {
  outcome: CanonicalOutcome;
  endReason: CanonicalEndReason;
  failureCategory: CanonicalFailureCategory;
  intentCategory: CanonicalIntentCategory;
  toolErrorsCount?: number | null;
}): CanonicalActionClass {
  if (input.failureCategory !== "unknown" || (input.toolErrorsCount ?? 0) > 0) {
    return "engineering_investigate";
  }
  if (input.outcome === "failed") {
    return "review_required";
  }
  if (input.outcome === "transferred" || input.endReason === "transfer") {
    return "escalate_human";
  }
  if (input.intentCategory === "Unknown") {
    return "followup_required";
  }
  if (input.outcome === "abandoned") {
    return "review_required";
  }
  return "no_action";
}

export function mapCanonicalToDisplayLabels(input: CanonicalDisplayMapperInput): CanonicalDisplayLabels {
  const statusLabel = (() => {
    switch (input.status) {
      case "initiated":
        return "Initiated";
      case "ringing":
        return "Ringing";
      case "in_progress":
        return "In Progress";
      case "completed":
        return "Completed";
      case "failed":
        return "Failed";
      case "abandoned":
        return "Abandoned";
      case "transferred":
        return "Transferred";
      default:
        return "Unknown";
    }
  })();

  const resultLabel = (() => {
    switch (input.outcome) {
      case "handled":
        return "Handled";
      case "transferred":
        return "Handoff";
      case "abandoned":
        return "Dropped";
      case "failed":
        return "System Failed";
      default:
        return "Unknown";
    }
  })();

  const reasonLabel = (() => {
    switch (input.endReason) {
      case "agent_end":
        return "Agent Ended";
      case "caller_hangup":
        return "Caller Hangup";
      case "transfer":
        return "Transfer";
      case "timeout":
        return "Timeout";
      case "error":
        return "Error";
      case "quota_denied":
        return "Quota Denied";
      default:
        return "Unknown";
    }
  })();

  const toolTotal = typeof input.toolsUsedCount === "number" ? input.toolsUsedCount : 0;
  const toolErrors = typeof input.toolErrorCount === "number" ? input.toolErrorCount : 0;
  const toolsLabel = toolTotal === 0 ? "No Tools" : toolErrors > 0 ? `${toolTotal} (${toolErrors} errors)` : `${toolTotal}`;

  return {
    statusLabel,
    resultLabel,
    reasonLabel,
    intentLabel: normalizeUnknownString(input.intent),
    toolsLabel,
    failureTypeLabel: normalizeUnknownString(input.failureType),
  };
}

export type CanonicalLabelContract = {
  canonical: {
    status: CanonicalCallStatus;
    outcome: CanonicalOutcome;
    endReason: CanonicalEndReason;
    intentSource: CanonicalIntentSource;
    intentConfidenceBand: CanonicalConfidenceBand;
  };
  display: CanonicalDisplayLabels;
};

export type LegacyCallEndReason = "normal_completion";
export type CallEndReason = CanonicalEndReason | LegacyCallEndReason;

export type UsageBreakdown = {
  callDurationSec: number;
  llmInputTokens?: number;
  llmOutputTokens?: number;
  sttSeconds?: number;
  ttsSeconds?: number;
  ttsCharacters?: number;
};

export type CallStartedPayload = {
  did: string;
  businessId: string;
  routeType: RouteType;
  agentConfigId?: string;
  agentConfigVersion?: number;
  startedAt: string;
};

export type CallEndedPayload = {
  did: string;
  businessId: string;
  routeType: RouteType;
  agentConfigId?: string;
  agentConfigVersion?: number;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  endReason: CallEndReason;
  outcome?: "handled" | "transferred" | "voicemail" | "abandoned" | "failed" | "unknown";
  usage?: UsageBreakdown;
};

export type UsageReportedPayload = {
  usage: UsageBreakdown;
  callStartedAt: string;
  callEndedAt: string;
  metadata?: Record<string, unknown>;
};

export type ConfigChangedPayload = {
  entity: "PhoneNumber" | "AgentConfig" | "Plan" | "Business";
  entity_id: string;
  version: number;
  lob?: string;
  status?: "draft" | "published";
};

export type DocIngestRequestedPayload = {
  doc_id: string;
  namespace: string;
};

export type AppointmentUpdatedPayload = {
  externalId: string;
  status: string;
  startsAt?: string;
  endsAt?: string;
  metadata?: Record<string, unknown>;
};

export type ToolUsedPayload = {
  toolName: string;
  idempotencyKey: string;
  args: Record<string, unknown>;
  provider?: string;
  result?: unknown;
};

export type VoicemailReferenceCreatedPayload = {
  voicemailId: string;
  recordingUrl: string;
  did: string;
  businessId: string;
  receivedAt: string;
};

export type CallIntelligencePhase = "provisional" | "pending_context" | "final" | "failed";
export type CallIntelligenceRiskLevel = "low" | "medium" | "high";
export type CallIntelligenceSeverity = "info" | "warn" | "error";
export type CallIntelligenceRecommendationPriority = "low" | "medium" | "high";
export type CallIntelligenceResolutionState = "resolved" | "partially_resolved" | "unresolved" | "unknown";
export type CallIntelligenceEvidenceKind = "transcript" | "tool_event" | "call_event" | "derived_signal";
export type CallIntelligenceFollowupReasonCode =
  | "unknown_intent"
  | "customer_request"
  | "handoff"
  | "failure_recovery"
  | "policy"
  | "none";
export type CallIntelligenceSlaClass = "low" | "medium" | "high";
export type CallIntelligenceRecommendedOwner = "agent" | "ops" | "engineering" | "human_supervisor";
export type CallIntelligenceTopicSource =
  | "semantic_transcript"
  | "intent_context"
  | "deterministic_context"
  | "fallback";
export type CallIntelligenceTopicState =
  | "final"
  | "provisional"
  | "pending_analysis"
  | "insufficient_evidence"
  | "classification_failed"
  | "true_unknown";
export type CallIntelligenceWarningCode =
  | "missing_transcript_timestamp"
  | "null_event_timestamp"
  | "invalid_confidence"
  | "stale_revision"
  | "context_incomplete";

export type CallIntelligenceWarning = {
  code: CallIntelligenceWarningCode;
  severity: CallIntelligenceSeverity;
  field: string;
  message: string;
  count: number;
  sampleIds: string[];
  detectedAt: string;
};

export type CallIntelligenceEvidence = {
  kind: CallIntelligenceEvidenceKind;
  note: string;
  snippet?: string;
  timestampMs?: number;
  sourceId?: string;
};

export type CallIntelligenceRecommendation = {
  action: string;
  reason: string;
  priority: CallIntelligenceRecommendationPriority;
};

export type CallIntelligenceConfidence = {
  primaryIntent?: number | null;
  resolutionState?: number | null;
  failureCategory?: number | null;
  actionClass?: number | null;
  recommendations?: number | null;
};

export type CallIntelligenceDecision = {
  intents: {
    primary: CanonicalIntentCategory;
    secondary: CanonicalIntentCategory[];
    callerGoal: string;
  };
  followup: {
    needed: boolean;
    reasonCode: CallIntelligenceFollowupReasonCode;
    slaClass: CallIntelligenceSlaClass;
    recommendedOwner: CallIntelligenceRecommendedOwner;
    reviewRecommended: boolean;
  };
  resolutionState: CallIntelligenceResolutionState;
  failureCategory: CanonicalFailureCategory;
  actionClass: CanonicalActionClass;
  riskLevel: CallIntelligenceRiskLevel;
};

export type CallIntelligenceSignals = {
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

export type CallIntelligenceScalarSnapshot = {
  failureCategory: CanonicalFailureCategory;
  actionClass: CanonicalActionClass;
  intentCategory: CanonicalIntentCategory;
};

export type CallIntelligenceProvenance = {
  source: "rules" | "hybrid_llm";
  model?: string;
  author?: string;
  mode?: "shadow" | "active";
  generatedAt: string;
  classificationVersion: number;
  enrichmentRevision: string;
  preRefinement: CallIntelligenceScalarSnapshot;
  postRefinement: CallIntelligenceScalarSnapshot;
  warnings: CallIntelligenceWarning[];
};

export type CallIntelligenceDisplay = {
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

export type CallIntelligenceV2 = {
  version: 2;
  phase: CallIntelligencePhase;
  operational: {
    status: CanonicalCallStatus;
    outcome: CanonicalOutcome;
    endReason: CanonicalEndReason;
    failureCategory: CanonicalFailureCategory;
    actionClass: CanonicalActionClass;
  };
  decision: CallIntelligenceDecision;
  explanation: {
    rationale: string;
    evidence: CallIntelligenceEvidence[];
  };
  recommendations: CallIntelligenceRecommendation[];
  signals: CallIntelligenceSignals;
  confidence: CallIntelligenceConfidence;
  provenance: CallIntelligenceProvenance;
  display: CallIntelligenceDisplay;
};

export type EventPayloadByType = {
  CallStarted: CallStartedPayload;
  CallEnded: CallEndedPayload;
  UsageReported: UsageReportedPayload;
  ConfigChanged: ConfigChangedPayload;
  DocIngestRequested: DocIngestRequestedPayload;
  AppointmentUpdated: AppointmentUpdatedPayload;
  ToolUsed: ToolUsedPayload;
  VoicemailReferenceCreated: VoicemailReferenceCreatedPayload;
};

export type TypedEventEnvelope<E extends EventType> = EventEnvelope<EventPayloadByType[E]>;
