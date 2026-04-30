import { describe, it, expect } from "vitest";
import { normalizeCallRecordForPersistence, type CallRecord } from "./callStore";

function baseCall(overrides: Partial<CallRecord> = {}): CallRecord {
  return {
    callId: "call-test-1",
    orgId: "org_test",
    phoneNumber: "+15550000000",
    callerNumber: "+15551111111",
    status: "in_progress",
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("normalizeCallRecordForPersistence", () => {
  it("accepts valid terminal tuple and preserves explicit unknown reason", () => {
    const normalized = normalizeCallRecordForPersistence(
      baseCall({
        status: "failed",
        outcome: "failed",
        endReason: "unknown",
        terminalStatusSource: "system",
      })
    );

    expect(normalized.status).toBe("failed");
    expect(normalized.outcome).toBe("failed");
    expect(normalized.endReason).toBe("unknown");
    expect(normalized.terminalStatusSource).toBe("system");
  });

  it("rejects impossible terminal tuples", () => {
    expect(() =>
      normalizeCallRecordForPersistence(
        baseCall({
          status: "completed",
          outcome: "failed",
          endReason: "agent_end",
        })
      )
    ).toThrow(/invalid terminal tuple/i);
  });

  it("rejects non-terminal rows with terminal outcome fields", () => {
    expect(() =>
      normalizeCallRecordForPersistence(
        baseCall({
          status: "ringing",
          outcome: "failed",
          endReason: "error",
        })
      )
    ).toThrow(/invalid non-terminal tuple/i);
  });

  it("derives intent confidence band from intent confidence when absent", () => {
    const high = normalizeCallRecordForPersistence(baseCall({ intentConfidence: 0.91 }));
    const medium = normalizeCallRecordForPersistence(baseCall({ intentConfidence: 0.61 }));
    const low = normalizeCallRecordForPersistence(baseCall({ intentConfidence: 0.2 }));
    const unknown = normalizeCallRecordForPersistence(baseCall({ intentConfidence: undefined }));

    expect(high.intentConfidenceBand).toBe("high");
    expect(medium.intentConfidenceBand).toBe("medium");
    expect(low.intentConfidenceBand).toBe("low");
    expect(unknown.intentConfidenceBand).toBe("unknown");
  });
});
