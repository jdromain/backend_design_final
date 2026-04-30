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

export function toDisplayReason(endReason: CanonicalEndReason): string {
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

  return {
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
      reason: toDisplayReason(canonicalEndReason),
      intent: input.display?.intent ?? input.intent ?? "Unknown",
      tools: input.display?.tools ?? String(input.toolsUsed?.length ?? 0),
      failureType: input.display?.failureType ?? input.failureType ?? "Unknown",
    },
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
      reason: input.display?.reason ?? toDisplayReason(canonicalEndReason),
      intent: input.display?.intent ?? input.intent ?? "Unknown",
      tools: input.display?.tools ?? String(input.tools.length),
      failureType: input.display?.failureType ?? input.canonical?.failureType ?? "Unknown",
    },
  }
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
