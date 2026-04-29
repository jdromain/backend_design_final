export type UiCallResult =
  | "completed"
  | "handoff"
  | "dropped"
  | "systemFailed"
  | "pending";

const DEFAULT_COMPLETION_REASONS = new Set(["agent_end", "normal_completion"]);

export function normalizeEndReasonKey(endReason: string | null | undefined): string | undefined {
  const raw = (endReason ?? "").trim();
  if (!raw) return undefined;
  return raw.toLowerCase().replace(/[\s-]+/g, "_");
}

export function isDefaultCompletionReason(endReason: string | null | undefined): boolean {
  const normalized = normalizeEndReasonKey(endReason);
  if (!normalized) return false;
  return DEFAULT_COMPLETION_REASONS.has(normalized);
}

export function normalizeEndReasonLabel(
  endReason: string | null | undefined,
  outcome?: string | null,
): string | undefined {
  const normalized = normalizeEndReasonKey(endReason);
  if (!normalized) {
    if (outcome === "handled") return "Normal completion";
    if (outcome === "abandoned") return "Caller hung up";
    if (outcome === "transferred") return "Customer requested human";
    if (outcome === "failed") return "System error";
    return undefined;
  }

  switch (normalized) {
    case "agent_end":
      return "Agent ended call";
    case "normal_completion":
      return "Completed (end party unknown)";
    case "caller_hangup":
      return "Caller ended call";
    case "timeout":
    case "tool_timeout":
      return "Timed out";
    case "error":
    case "api_error":
      return "API error";
    case "system_error":
      return "System error";
    case "human_handoff":
    case "customer_requested_human":
    case "transfer":
      return "Customer requested human";
    default:
      return normalized
        .replace(/_/g, " ")
        .replace(/\b\w/g, (m) => m.toUpperCase());
  }
}

export function mapOutcomeToUiResult(
  outcome: string | null | undefined,
  status?: string | null | undefined,
): UiCallResult {
  if (outcome) {
    switch (outcome) {
      case "handled":
        return "completed";
      case "transferred":
        return "handoff";
      case "abandoned":
        return "dropped";
      case "failed":
        return "systemFailed";
      default:
        break;
    }
  }

  switch (status) {
    case "completed":
      return "completed";
    case "transferred":
      return "handoff";
    case "abandoned":
      return "dropped";
    case "failed":
      return "systemFailed";
    default:
      return "pending";
  }
}

export function uiResultToOutcome(result: string): "handled" | "transferred" | "abandoned" | "failed" | null {
  switch (result) {
    case "completed":
      return "handled";
    case "handoff":
      return "transferred";
    case "dropped":
      return "abandoned";
    case "systemFailed":
      return "failed";
    default:
      return null;
  }
}
