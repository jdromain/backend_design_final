import type { CallRecord, LiveCall } from "@/types/api"

export type CanonicalCallStatus =
  | "initiated"
  | "ringing"
  | "in_progress"
  | "completed"
  | "failed"
  | "abandoned"
  | "transferred"
  | "unknown"

export type CanonicalOutcome = "handled" | "failed" | "abandoned" | "transferred" | "unknown"
export type CanonicalEndReason =
  | "caller_hangup"
  | "agent_end"
  | "transfer"
  | "timeout"
  | "error"
  | "quota_denied"
  | "unknown"
export type CanonicalFailureCategory =
  | "carrier_error"
  | "stt_error"
  | "tts_error"
  | "llm_error"
  | "tool_error"
  | "config_error"
  | "auth_error"
  | "quota_error"
  | "unknown"
export type CanonicalActionClass =
  | "no_action"
  | "review_required"
  | "followup_required"
  | "escalate_human"
  | "engineering_investigate"

export type CallTopicDisplay = {
  text: string
  state:
    | "final"
    | "provisional"
    | "pending_analysis"
    | "insufficient_evidence"
    | "classification_failed"
    | "true_unknown"
  source:
    | "intelligence_final"
    | "canonical_intent"
    | "deterministic_context"
    | "intelligence_provisional"
    | "fallback"
  confidence?: number | null
  badge?: string
  warning?: string
}

export type CallResolutionDisplay = {
  label: string
  tone: "success" | "warning" | "danger" | "neutral"
}

export type CallNextStepDisplay = {
  label: string
  tone: "success" | "warning" | "danger" | "neutral"
}

export type CallRiskDisplay = {
  label: "Low" | "Medium" | "High"
  level: "low" | "medium" | "high"
  source: "intelligence" | "deterministic"
}

export type CallEndedByDisplay = {
  label: "Caller End" | "Agent End" | "Carrier Dropped" | "Unknown"
  tone: "success" | "warning" | "danger" | "neutral"
}

const FINAL_TOPIC_CONFIDENCE_FLOOR = 0.7
const PROVISIONAL_TOPIC_CONFIDENCE_FLOOR = 0.6

const TOPIC_GENERIC_VALUES = new Set([
  "unknown",
  "support",
  "billing",
  "sales",
  "booking",
  "general inquiry",
  "other",
  "review required",
  "failed call",
  "call ended",
  "system failed",
  "high risk call requires review",
  "call may need follow up",
  "call resolved with low risk",
  "call intelligence deferred context incomplete",
])

const INTENT_TOPIC_PHRASES: Record<"Billing" | "Support" | "Sales" | "Booking", string> = {
  Billing: "Billing Question",
  Support: "Support Request",
  Sales: "Sales Inquiry",
  Booking: "Appointment Booking",
}

function normalizeTopicText(value: string): string {
  return value.trim().replace(/\s+/g, " ")
}

function normalizeTopicToken(value: string): string {
  return normalizeTopicText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function isGenericTopicText(value: string | undefined | null): boolean {
  if (!value) return true
  const token = normalizeTopicToken(value)
  if (!token) return true
  if (TOPIC_GENERIC_VALUES.has(token)) return true

  // Common non-topic diagnostics that should not win title selection.
  if (
    token.includes("requires review") ||
    token.includes("may need follow up") ||
    token.includes("operationally stable completion") ||
    token.includes("no summary")
  ) {
    return true
  }
  return false
}

function numberOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function topicConfidenceFromCompact(compact: CallRecord["intelligence"]): number | null {
  if (!compact) return null
  return (
    numberOrNull(compact.topicConfidence) ??
    numberOrNull(compact.confidence?.primaryIntent) ??
    numberOrNull(compact.confidence?.recommendations)
  )
}

function intelligenceTopicCandidate(compact: CallRecord["intelligence"]): string | null {
  if (!compact) return null
  if (typeof compact.topic !== "string") return null
  const topic = normalizeTopicText(compact.topic)
  return topic.length > 0 ? topic : null
}

function isPendingState(call: Pick<CallRecord, "result" | "canonical" | "intelligence">): boolean {
  if (call.result === "pending") return true
  if (call.intelligence?.phase === "pending_context" || call.intelligence?.phase === "provisional") return true
  const status = call.canonical?.status
  return status === "initiated" || status === "ringing" || status === "in_progress"
}

function deterministicIntentTopic(
  call: Pick<CallRecord, "classification" | "intent" | "display">
): string | null {
  const intent = normalizeIntent(call.classification?.intentCategory ?? call.display?.intent ?? call.intent)
  if (intent === "Unknown") return null
  return INTENT_TOPIC_PHRASES[intent]
}

function deterministicContextTopic(
  call: Pick<CallRecord, "classification" | "canonical" | "direction" | "intelligence">,
  intentTopic: string | null,
): string | null {
  const failureCategory = normalizeFailureCategory(call.classification?.failureCategory)
  const actionClass = normalizeActionClass(call.classification?.actionClass)
  const endReason = normalizeEndReason(call.classification?.endReason ?? call.canonical?.endReason)
  const outcome = normalizeOutcome(call.classification?.outcome ?? call.canonical?.outcome)
  const directionWord = call.direction === "outbound" ? "Outbound" : "Inbound"
  const baseTopic = intentTopic ?? `${directionWord} Call`

  if (failureCategory === "tool_error") return `${baseTopic} - Tool Failure`
  if (failureCategory === "auth_error") return `${baseTopic} - Authentication Blocked`
  if (failureCategory === "quota_error" || endReason === "quota_denied") return `${baseTopic} - Quota Limit Reached`
  if (failureCategory === "carrier_error") return `${baseTopic} - Carrier Disconnect`
  if (failureCategory === "stt_error") return `${baseTopic} - Speech Recognition Failure`
  if (failureCategory === "tts_error") return `${baseTopic} - Voice Response Failure`
  if (failureCategory === "llm_error") return `${baseTopic} - AI Response Failure`
  if (failureCategory === "config_error") return `${baseTopic} - Configuration Failure`

  if (actionClass === "escalate_human" || outcome === "transferred" || endReason === "transfer") {
    return `${baseTopic} - Transferred to Human`
  }
  if (endReason === "caller_hangup" && outcome !== "handled") {
    return `${baseTopic} - Caller Disconnected`
  }
  if (outcome === "abandoned") {
    return `${baseTopic} - Caller Disconnected`
  }
  if (outcome === "failed") {
    return `${baseTopic} - Unresolved Failure`
  }
  if (actionClass === "followup_required") {
    return `${baseTopic} - Follow-up Needed`
  }

  return null
}

function hasInsufficientEvidenceSignals(call: Pick<CallRecord, "intelligence">): boolean {
  const warnings = call.intelligence?.warnings ?? []
  return warnings.some((warning) =>
    warning.code === "missing_transcript_timestamp" ||
    warning.code === "null_event_timestamp" ||
    warning.code === "context_incomplete",
  )
}

function pickDeterministicTopic(
  call: Pick<CallRecord, "classification" | "canonical" | "intent" | "display" | "direction" | "intelligence">,
): { text: string; source: "canonical_intent" | "deterministic_context" } | null {
  const intentTopic = deterministicIntentTopic(call)
  const contextTopic = deterministicContextTopic(call, intentTopic)

  if (contextTopic && !isGenericTopicText(contextTopic)) {
    return { text: contextTopic, source: "deterministic_context" }
  }
  if (intentTopic && !isGenericTopicText(intentTopic)) {
    return { text: intentTopic, source: "canonical_intent" }
  }
  return null
}

export const CANONICAL_OUTCOME_FILTER_OPTIONS: Array<{ value: CanonicalOutcome; label: string }> = [
  { value: "handled", label: "Handled" },
  { value: "transferred", label: "Handoff" },
  { value: "abandoned", label: "Dropped" },
  { value: "failed", label: "System Failed" },
  { value: "unknown", label: "Unknown" },
]

export const CANONICAL_END_REASON_FILTER_OPTIONS: Array<{ value: CanonicalEndReason; label: string }> = [
  { value: "agent_end", label: "Agent Ended" },
  { value: "caller_hangup", label: "Caller Hangup" },
  { value: "transfer", label: "Transfer" },
  { value: "timeout", label: "Timeout" },
  { value: "error", label: "Error" },
  { value: "quota_denied", label: "Quota Denied" },
  { value: "unknown", label: "Unknown" },
]
export const CANONICAL_FAILURE_CATEGORY_FILTER_OPTIONS: Array<{ value: CanonicalFailureCategory; label: string }> = [
  { value: "carrier_error", label: "Carrier Error" },
  { value: "stt_error", label: "STT Error" },
  { value: "tts_error", label: "TTS Error" },
  { value: "llm_error", label: "LLM Error" },
  { value: "tool_error", label: "Tool Error" },
  { value: "config_error", label: "Config Error" },
  { value: "auth_error", label: "Auth Error" },
  { value: "quota_error", label: "Quota Error" },
  { value: "unknown", label: "Unknown" },
]
export const CANONICAL_ACTION_CLASS_FILTER_OPTIONS: Array<{ value: CanonicalActionClass; label: string }> = [
  { value: "engineering_investigate", label: "Engineering Investigate" },
  { value: "escalate_human", label: "Escalate Human" },
  { value: "followup_required", label: "Follow-up Required" },
  { value: "review_required", label: "Review Required" },
  { value: "no_action", label: "No Action" },
]

function normalizeCallStatus(value: string | undefined): CanonicalCallStatus {
  switch (value) {
    case "initiated":
    case "ringing":
    case "in_progress":
    case "completed":
    case "failed":
    case "abandoned":
    case "transferred":
    case "unknown":
      return value
    default:
      return "unknown"
  }
}

function normalizeOutcome(value: string | undefined): CanonicalOutcome {
  switch (value) {
    case "handled":
    case "failed":
    case "abandoned":
    case "transferred":
    case "unknown":
      return value
    default:
      return "unknown"
  }
}

function normalizeEndReason(value: string | undefined): CanonicalEndReason {
  switch (value) {
    case "caller_hangup":
    case "agent_end":
    case "transfer":
    case "timeout":
    case "error":
    case "quota_denied":
    case "unknown":
      return value
    default:
      return "unknown"
  }
}

function normalizeFailureCategory(value: string | undefined): CanonicalFailureCategory {
  switch (value) {
    case "carrier_error":
    case "stt_error":
    case "tts_error":
    case "llm_error":
    case "tool_error":
    case "config_error":
    case "auth_error":
    case "quota_error":
    case "unknown":
      return value
    default:
      return "unknown"
  }
}

function normalizeActionClass(value: string | undefined): CanonicalActionClass {
  switch (value) {
    case "no_action":
    case "review_required":
    case "followup_required":
    case "escalate_human":
    case "engineering_investigate":
      return value
    default:
      return "no_action"
  }
}

function normalizeIntent(
  value: string | undefined
): "Billing" | "Support" | "Sales" | "Booking" | "Unknown" {
  switch (value) {
    case "Billing":
    case "Support":
    case "Sales":
    case "Booking":
    case "Unknown":
      return value
    default:
      return "Unknown"
  }
}

export function mapCanonicalOutcomeToResult(
  outcome: CanonicalOutcome,
  status: CanonicalCallStatus
): CallRecord["result"] {
  switch (outcome) {
    case "handled":
      return "completed"
    case "transferred":
      return "handoff"
    case "abandoned":
      return "dropped"
    case "failed":
      return "systemFailed"
    case "unknown":
      if (status === "initiated" || status === "ringing" || status === "in_progress") {
        return "pending"
      }
      return "unknown"
    default:
      return "unknown"
  }
}

export function mapCanonicalStatusToLiveState(status: CanonicalCallStatus): LiveCall["state"] {
  switch (status) {
    case "initiated":
    case "ringing":
      return "ringing"
    case "in_progress":
      return "active"
    case "transferred":
      return "handoff_requested"
    case "failed":
      return "error"
    case "unknown":
      return "unknown"
    default:
      return "at_risk"
  }
}

export function toDisplayResult(outcome: CanonicalOutcome): string {
  switch (outcome) {
    case "handled":
      return "Handled"
    case "transferred":
      return "Handoff"
    case "abandoned":
      return "Dropped"
    case "failed":
      return "System Failed"
    default:
      return "Unknown"
  }
}

export function toDisplayReason(endReason: CanonicalEndReason, outcome?: CanonicalOutcome): string {
  switch (endReason) {
    case "agent_end":
      return "Agent Ended"
    case "caller_hangup":
      return "Caller Hangup"
    case "transfer":
      return "Transfer"
    case "timeout":
      return "Timeout"
    case "error":
      return "Error"
    case "quota_denied":
      return "Quota Denied"
    default:
      if (outcome === "handled") return "Completed (end party unknown)"
      if (outcome === "abandoned") return "Caller Ended or Disconnected"
      if (outcome === "transferred") return "Transfer Completed"
      if (outcome === "failed") return "Failure (end party unknown)"
      return "Unknown"
  }
}

function inferCanonicalFromLegacyResult(result?: CallRecord["result"]): CanonicalOutcome {
  switch (result) {
    case "completed":
      return "handled"
    case "handoff":
      return "transferred"
    case "dropped":
      return "abandoned"
    case "systemFailed":
      return "failed"
    default:
      return "unknown"
  }
}

function inferCanonicalStatusFromLegacyLiveState(state?: LiveCall["state"]): CanonicalCallStatus {
  switch (state) {
    case "ringing":
      return "ringing"
    case "active":
    case "at_risk":
      return "in_progress"
    case "handoff_requested":
      return "transferred"
    case "error":
      return "failed"
    case "unknown":
      return "unknown"
    default:
      return "unknown"
  }
}

export function normalizeCallRecordLabels(input: CallRecord): CallRecord {
  const canonicalStatus = normalizeCallStatus(input.canonical?.status)
  const canonicalOutcome = normalizeOutcome(input.canonical?.outcome ?? inferCanonicalFromLegacyResult(input.result))
  const canonicalEndReason = normalizeEndReason(input.canonical?.endReason ?? input.endReason)

  const canonical = {
    status: canonicalStatus,
    outcome: canonicalOutcome,
    endReason: canonicalEndReason,
    terminalStatusSource: input.canonical?.terminalStatusSource ?? "unknown",
    intentSource: input.canonical?.intentSource ?? "unknown",
    intentConfidenceBand: input.canonical?.intentConfidenceBand ?? "unknown",
  }

  const result = mapCanonicalOutcomeToResult(canonicalOutcome, canonicalStatus)

  const normalized: CallRecord = {
    ...input,
    result,
    endReason: canonicalEndReason,
    intent: normalizeIntent(input.display?.intent ?? input.intent),
    canonical,
    classification: {
      status: canonicalStatus,
      outcome: canonicalOutcome,
      endReason: canonicalEndReason,
      failureCategory: normalizeFailureCategory(input.classification?.failureCategory),
      intentCategory: normalizeIntent(input.classification?.intentCategory ?? input.display?.intent ?? input.intent),
      intentConfidenceBand: input.classification?.intentConfidenceBand ?? canonical.intentConfidenceBand,
      actionClass: normalizeActionClass(input.classification?.actionClass),
      toolSummary: {
        toolsUsedCount: input.classification?.toolSummary?.toolsUsedCount ?? input.toolsUsed?.length ?? 0,
        toolErrorsCount: input.classification?.toolSummary?.toolErrorsCount ?? 0,
        primaryFailedTool: input.classification?.toolSummary?.primaryFailedTool ?? "unknown",
        toolFailureClass: normalizeFailureCategory(input.classification?.toolSummary?.toolFailureClass),
      },
      provenance: {
        terminalStatusSource: input.classification?.provenance?.terminalStatusSource ?? canonical.terminalStatusSource,
        intentSource: input.classification?.provenance?.intentSource ?? canonical.intentSource,
        labelVersion: input.classification?.provenance?.labelVersion ?? 1,
      },
    },
    display: {
      status: input.display?.status ?? "Unknown",
      result: toDisplayResult(canonicalOutcome),
      reason: toDisplayReason(canonicalEndReason, canonicalOutcome),
      intent: input.display?.intent ?? input.intent ?? "Unknown",
      tools: input.display?.tools ?? String(input.toolsUsed?.length ?? 0),
      failureType: input.display?.failureType ?? input.failureType ?? "Unknown",
    },
  }
  return {
    ...normalized,
    topicDisplay: selectCallTopicDisplay(normalized),
  }
}

export function normalizeLiveCallLabels(input: LiveCall): LiveCall {
  const canonicalStatus = normalizeCallStatus(input.canonical?.status ?? inferCanonicalStatusFromLegacyLiveState(input.state))
  const canonicalOutcome = normalizeOutcome(input.canonical?.outcome)
  const canonicalEndReason = normalizeEndReason(input.canonical?.endReason)

  return {
    ...input,
    state: mapCanonicalStatusToLiveState(canonicalStatus),
    intent: normalizeIntent(input.display?.intent ?? input.intent),
    canonical: {
      status: canonicalStatus,
      outcome: canonicalOutcome,
      endReason: canonicalEndReason,
      terminalStatusSource: input.canonical?.terminalStatusSource ?? "unknown",
      intentSource: input.canonical?.intentSource ?? "unknown",
      intentConfidenceBand: input.canonical?.intentConfidenceBand ?? "unknown",
      failureType: input.canonical?.failureType ?? "unknown",
      toolErrors: input.canonical?.toolErrors ?? 0,
    },
    classification: {
      status: canonicalStatus,
      outcome: canonicalOutcome,
      endReason: canonicalEndReason,
      failureCategory: normalizeFailureCategory(input.classification?.failureCategory ?? input.canonical?.failureType),
      intentCategory: normalizeIntent(input.classification?.intentCategory ?? input.display?.intent ?? input.intent),
      intentConfidenceBand: input.classification?.intentConfidenceBand ?? (input.canonical?.intentConfidenceBand ?? "unknown"),
      actionClass: normalizeActionClass(input.classification?.actionClass),
      toolSummary: {
        toolsUsedCount: input.classification?.toolSummary?.toolsUsedCount ?? input.tools.length,
        toolErrorsCount: input.classification?.toolSummary?.toolErrorsCount ?? (input.canonical?.toolErrors ?? 0),
        primaryFailedTool: input.classification?.toolSummary?.primaryFailedTool ?? "unknown",
        toolFailureClass: normalizeFailureCategory(input.classification?.toolSummary?.toolFailureClass),
      },
      provenance: {
        terminalStatusSource: input.classification?.provenance?.terminalStatusSource ?? (input.canonical?.terminalStatusSource ?? "unknown"),
        intentSource: input.classification?.provenance?.intentSource ?? (input.canonical?.intentSource ?? "unknown"),
        labelVersion: input.classification?.provenance?.labelVersion ?? 1,
      },
    },
    display: {
      status: input.display?.status ?? "Unknown",
      result: input.display?.result ?? toDisplayResult(canonicalOutcome),
      reason: input.display?.reason ?? toDisplayReason(canonicalEndReason, canonicalOutcome),
      intent: input.display?.intent ?? input.intent ?? "Unknown",
      tools: input.display?.tools ?? String(input.tools.length),
      failureType: input.display?.failureType ?? input.canonical?.failureType ?? "Unknown",
    },
  }
}

export function selectCallTopicDisplay(
  call: Pick<CallRecord, "classification" | "canonical" | "direction" | "display" | "intent" | "intelligence" | "result">,
): CallTopicDisplay {
  const compact = call.intelligence ?? null
  const phase = compact?.phase
  const topicStateHint = compact?.topicState
  const topicSourceHint = compact?.topicSource
  const topicCandidate = intelligenceTopicCandidate(compact)
  const topicConfidence = topicConfidenceFromCompact(compact)
  const deterministic = pickDeterministicTopic(call)
  const sourceFromHint = (() => {
    if (topicSourceHint === "deterministic_context") return "deterministic_context" as const
    if (topicSourceHint === "intent_context") return "intelligence_provisional" as const
    if (topicSourceHint === "semantic_transcript") return "intelligence_final" as const
    return "fallback" as const
  })()

  if (topicStateHint === "classification_failed" || phase === "failed") {
    if (deterministic) {
      return {
        text: deterministic.text,
        state: "classification_failed",
        source: deterministic.source,
        confidence: topicConfidence,
        badge: "Classification Failed",
        warning: "AI classification failed; using deterministic topic.",
      }
    }
    return {
      text: "Classification Failed",
      state: "classification_failed",
      source: "fallback",
      confidence: topicConfidence,
      badge: "Classification Failed",
      warning: "No trustworthy topic candidate was available.",
    }
  }

  if (topicStateHint === "pending_analysis") {
    return {
      text: "Pending Analysis",
      state: "pending_analysis",
      source: "fallback",
      confidence: topicConfidence,
      badge: "Pending",
      warning: "Classification is waiting for final transcript/event context.",
    }
  }

  if (topicStateHint === "insufficient_evidence") {
    return {
      text: "Insufficient Evidence",
      state: "insufficient_evidence",
      source: "fallback",
      confidence: topicConfidence,
      badge: "Insufficient Evidence",
      warning: "Available signals were not strong enough for a trustworthy topic.",
    }
  }

  if (
    (phase === "final" || topicStateHint === "final") &&
    topicCandidate &&
    !isGenericTopicText(topicCandidate) &&
    typeof topicConfidence === "number" &&
    topicConfidence >= FINAL_TOPIC_CONFIDENCE_FLOOR
  ) {
    return {
      text: topicCandidate,
      state: "final",
      source: sourceFromHint === "deterministic_context" ? "deterministic_context" : "intelligence_final",
      confidence: topicConfidence,
      warning: topicConfidence < 0.78 ? "Lower-confidence semantic topic; verify in call detail." : undefined,
    }
  }

  if (deterministic) {
    return {
      text: deterministic.text,
      state: "final",
      source: deterministic.source,
      confidence: topicConfidence,
      warning:
        typeof topicConfidence === "number" && topicConfidence < FINAL_TOPIC_CONFIDENCE_FLOOR
          ? "Deterministic topic retained because semantic confidence was low."
          : undefined,
    }
  }

  if (
    (phase === "provisional" ||
      phase === "pending_context" ||
      topicStateHint === "provisional") &&
    topicCandidate &&
    !isGenericTopicText(topicCandidate) &&
    typeof topicConfidence === "number" &&
    topicConfidence >= PROVISIONAL_TOPIC_CONFIDENCE_FLOOR
  ) {
    return {
      text: topicCandidate,
      state: "provisional",
      source: "intelligence_provisional",
      confidence: topicConfidence,
      badge: "Provisional",
      warning: "Topic is provisional and may change when more evidence arrives.",
    }
  }

  if (isPendingState(call)) {
    return {
      text: "Pending Analysis",
      state: "pending_analysis",
      source: "fallback",
      confidence: topicConfidence,
      badge: "Pending",
      warning: "Classification is waiting for final transcript/event context.",
    }
  }

  if (phase === "final" && hasInsufficientEvidenceSignals(call)) {
    return {
      text: "Insufficient Evidence",
      state: "insufficient_evidence",
      source: "fallback",
      confidence: topicConfidence,
      badge: "Insufficient Evidence",
      warning: "Classification completed with insufficient evidence quality.",
    }
  }

  return {
    text: "Unknown",
    state: "true_unknown",
    source: "fallback",
    confidence: topicConfidence,
    badge: "Unknown",
    warning: "No trustworthy topic signal was available for this call.",
  }
}

export function selectCallResolutionDisplay(
  call: Pick<CallRecord, "classification" | "canonical" | "result" | "intelligence">,
): CallResolutionDisplay {
  const intelligenceLabel = call.intelligence?.resolutionLabel
  if (intelligenceLabel === "Resolved") return { label: "Resolved", tone: "success" }
  if (intelligenceLabel === "Partially Resolved") return { label: "Partially Resolved", tone: "warning" }
  if (intelligenceLabel === "Unresolved") return { label: "Unresolved", tone: "warning" }

  const outcome = normalizeOutcome(call.classification?.outcome ?? call.canonical?.outcome)
  if (outcome === "handled") return { label: "Resolved", tone: "success" }
  if (outcome === "transferred") return { label: "Transferred", tone: "warning" }
  if (outcome === "abandoned") return { label: "Unresolved", tone: "warning" }
  if (outcome === "failed") return { label: "Failed", tone: "danger" }
  if (isPendingState(call)) return { label: "In Analysis", tone: "neutral" }
  return { label: "Unknown", tone: "neutral" }
}

export function selectCallNextStepDisplay(
  call: Pick<CallRecord, "classification" | "intelligence">,
): CallNextStepDisplay {
  const intelligenceLabel = call.intelligence?.nextStepLabel
  if (intelligenceLabel) {
    if (intelligenceLabel === "Engineering Investigation") return { label: intelligenceLabel, tone: "danger" }
    if (
      intelligenceLabel === "Escalate to Human" ||
      intelligenceLabel === "Follow-up Required" ||
      intelligenceLabel === "Manual Review"
    ) {
      return { label: intelligenceLabel, tone: "warning" }
    }
    if (intelligenceLabel === "No Action") return { label: intelligenceLabel, tone: "success" }
  }

  const actionClass = normalizeActionClass(call.classification?.actionClass)
  if (actionClass === "engineering_investigate") return { label: "Engineering Investigation", tone: "danger" }
  if (actionClass === "escalate_human") return { label: "Escalate to Human", tone: "warning" }
  if (actionClass === "followup_required") return { label: "Follow-up Required", tone: "warning" }
  if (actionClass === "review_required") return { label: "Manual Review", tone: "warning" }
  if (call.intelligence?.reviewRecommended) return { label: "Manual Review", tone: "warning" }
  if (call.intelligence?.followupNeeded) return { label: "Follow-up Recommended", tone: "warning" }
  return { label: "No Action", tone: "success" }
}

export function selectCallRiskDisplay(
  call: Pick<CallRecord, "classification" | "intelligence">,
): CallRiskDisplay {
  if (call.intelligence?.riskLabel === "High") return { label: "High", level: "high", source: "intelligence" }
  if (call.intelligence?.riskLabel === "Medium") return { label: "Medium", level: "medium", source: "intelligence" }
  if (call.intelligence?.riskLabel === "Low") return { label: "Low", level: "low", source: "intelligence" }

  const riskLevel = call.intelligence?.riskLevel
  if (riskLevel === "high") return { label: "High", level: "high", source: "intelligence" }
  if (riskLevel === "medium") return { label: "Medium", level: "medium", source: "intelligence" }
  if (riskLevel === "low") return { label: "Low", level: "low", source: "intelligence" }

  const actionClass = normalizeActionClass(call.classification?.actionClass)
  const failureCategory = normalizeFailureCategory(call.classification?.failureCategory)
  if (actionClass === "engineering_investigate") {
    return { label: "High", level: "high", source: "deterministic" }
  }
  if (
    failureCategory === "tool_error" ||
    failureCategory === "config_error" ||
    failureCategory === "llm_error" ||
    failureCategory === "auth_error" ||
    failureCategory === "quota_error"
  ) {
    return { label: "High", level: "high", source: "deterministic" }
  }
  if (failureCategory !== "unknown") {
    return { label: "Medium", level: "medium", source: "deterministic" }
  }
  if (
    actionClass === "review_required" ||
    actionClass === "followup_required" ||
    actionClass === "escalate_human"
  ) {
    return { label: "Medium", level: "medium", source: "deterministic" }
  }
  return { label: "Low", level: "low", source: "deterministic" }
}

export function selectCallEndedByDisplay(
  call: Pick<CallRecord, "classification" | "canonical">,
): CallEndedByDisplay {
  const endReason = normalizeEndReason(call.classification?.endReason ?? call.canonical?.endReason)
  const outcome = normalizeOutcome(call.classification?.outcome ?? call.canonical?.outcome)
  const status = normalizeCallStatus(call.classification?.status ?? call.canonical?.status)
  const terminalSource = call.canonical?.terminalStatusSource ?? call.classification?.provenance?.terminalStatusSource
  const failureCategory = normalizeFailureCategory(call.classification?.failureCategory)

  if (
    endReason === "caller_hangup" ||
    ((outcome === "abandoned" || status === "abandoned") && terminalSource !== "carrier" && failureCategory !== "carrier_error")
  ) {
    return { label: "Caller End", tone: "warning" }
  }
  if (endReason === "agent_end" || outcome === "handled" || status === "completed") {
    return { label: "Agent End", tone: "success" }
  }
  if (
    terminalSource === "carrier" ||
    failureCategory === "carrier_error" ||
    endReason === "timeout" ||
    endReason === "error" ||
    endReason === "quota_denied" ||
    outcome === "failed" ||
    status === "failed"
  ) {
    return { label: "Carrier Dropped", tone: "danger" }
  }
  return { label: "Unknown", tone: "neutral" }
}

export function mapInitialLegacyFilterToCanonicalOutcome(filter: string): CanonicalOutcome[] {
  if (filter === "failed") return ["failed"]
  if (filter === "handoff") return ["transferred"]
  if (filter === "dropped") return ["abandoned"]
  if (filter === "completed") return ["handled"]
  return []
}

export function matchesCanonicalCallFilters(
  call: Pick<CallRecord, "canonical" | "classification">,
  filters: {
    outcomes?: CanonicalOutcome[]
    endReason?: CanonicalEndReason | ""
    failureCategory?: CanonicalFailureCategory | ""
    actionClass?: CanonicalActionClass | ""
  }
): boolean {
  const outcome = normalizeOutcome(call.classification?.outcome ?? call.canonical?.outcome)
  const endReason = normalizeEndReason(call.classification?.endReason ?? call.canonical?.endReason)
  const failureCategory = normalizeFailureCategory(call.classification?.failureCategory)
  const actionClass = normalizeActionClass(call.classification?.actionClass)

  if (filters.outcomes && filters.outcomes.length > 0 && !filters.outcomes.includes(outcome)) {
    return false
  }
  if (filters.endReason && endReason !== filters.endReason) {
    return false
  }
  if (filters.failureCategory && failureCategory !== filters.failureCategory) {
    return false
  }
  if (filters.actionClass && actionClass !== filters.actionClass) {
    return false
  }
  return true
}
