import { describe, it, expect } from "vitest";
import type { CallRecord } from "../persistence/callStore";
import {
  deriveCanonicalCallView,
  deriveFailureType,
  mapCallListItem,
  mapTimelineType,
  resolveCanonicalTerminalTuple,
  type DerivedTool,
} from "./calls";

function buildCall(overrides: Partial<CallRecord> = {}): CallRecord {
  return {
    callId: "call_123",
    orgId: "org_test",
    phoneNumber: "+15550000000",
    callerNumber: "+15551111111",
    status: "failed",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:01:00.000Z",
    durationSec: 60,
    outcome: "failed",
    endReason: "error",
    ...overrides,
  };
}

describe("resolveCanonicalTerminalTuple", () => {
  it("accepts explicit unknown end reason with valid failed tuple", () => {
    const out = resolveCanonicalTerminalTuple({
      status: "failed",
      outcome: "failed",
      endReason: "unknown",
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.tuple).toEqual({
      status: "failed",
      outcome: "failed",
      endReason: "unknown",
    });
  });

  it("rejects impossible tuples", () => {
    const out = resolveCanonicalTerminalTuple({
      status: "completed",
      outcome: "failed",
      endReason: "agent_end",
    });
    expect(out.ok).toBe(false);
  });
});

describe("canonical call list mapping", () => {
  it("uses explicit shared derivation for tools and failure type", () => {
    const call = buildCall({ failureType: undefined });
    const tools: DerivedTool[] = [
      {
        name: "calendar_lookup",
        success: false,
        error: "calendar timeout",
      },
    ];
    const mapped = mapCallListItem(call, tools);

    expect(mapped.result).toBe("systemFailed");
    expect(mapped.toolErrors).toBe(1);
    expect(mapped.failureType).toBe("calendar timeout");
    expect(mapped.canonical.status).toBe("failed");
    expect(mapped.canonical.outcome).toBe("failed");
    expect(mapped.display.result).toBe("System Failed");
    expect(mapped.classification.failureCategory).toBe("tool_error");
    expect(mapped.classification.actionClass).toBe("engineering_investigate");
  });

  it("keeps unknown explicit for unmapped statuses", () => {
    const mapped = mapCallListItem(
      buildCall({
        status: "mystery_status",
        outcome: undefined,
        endReason: undefined,
      }),
      []
    );

    expect(mapped.result).toBe("unknown");
    expect(mapped.canonical.status).toBe("unknown");
    expect(mapped.canonical.outcome).toBe("unknown");
    expect(mapped.display.result).toBe("Unknown");
    expect(mapped.classification.failureCategory).toBe("unknown");
  });

  it("does not downgrade failed outcome to unknown when evidence is sparse", () => {
    const mapped = mapCallListItem(
      buildCall({
        status: "failed",
        outcome: "failed",
        endReason: "unknown",
        failureType: undefined,
      }),
      [],
    );

    expect(mapped.canonical.status).toBe("failed");
    expect(mapped.canonical.outcome).toBe("failed");
    expect(mapped.result).toBe("systemFailed");
  });

  it("recovers terminal failed end reason from failure type when tuple input is incomplete", () => {
    const mapped = mapCallListItem(
      buildCall({
        status: "failed",
        outcome: undefined,
        endReason: undefined,
        failureType: "carrier timeout",
      }),
      [],
    );

    expect(mapped.canonical.status).toBe("failed");
    expect(mapped.canonical.outcome).toBe("failed");
    expect(mapped.canonical.endReason).toBe("timeout");
  });

  it("normalizes completed+unknown end reason to agent_end for user-facing consistency", () => {
    const mapped = mapCallListItem(
      buildCall({
        status: "completed",
        outcome: "handled",
        endReason: "unknown",
      }),
      [],
    );

    expect(mapped.canonical.status).toBe("completed");
    expect(mapped.canonical.outcome).toBe("handled");
    expect(mapped.canonical.endReason).toBe("agent_end");
    expect(mapped.display.reason).toBe("Agent Ended");
  });

  it("normalizes transferred+unknown end reason to transfer", () => {
    const mapped = mapCallListItem(
      buildCall({
        status: "transferred",
        outcome: "transferred",
        endReason: "unknown",
      }),
      [],
    );

    expect(mapped.canonical.status).toBe("transferred");
    expect(mapped.canonical.outcome).toBe("transferred");
    expect(mapped.canonical.endReason).toBe("transfer");
    expect(mapped.display.reason).toBe("Transfer");
  });
});

describe("timeline mapping", () => {
  it("returns unknown for unmapped timeline event types", () => {
    expect(mapTimelineType("something_new", {})).toBe("unknown");
  });
});

describe("canonical failure derivation", () => {
  it("falls back to canonical end reason when failed and no tool errors exist", () => {
    const canonical = deriveCanonicalCallView(buildCall({ endReason: "quota_denied" }));
    expect(deriveFailureType(canonical, undefined, [])).toBe("quota_denied");
  });
});
