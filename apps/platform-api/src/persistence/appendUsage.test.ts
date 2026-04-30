import { describe, it, expect, vi, beforeEach } from "vitest";
import { PersistenceStore } from "./store";
import { query } from "./dbClient";

vi.mock("./dbClient", () => ({
  query: vi.fn(),
}));

describe("PersistenceStore.appendUsage", () => {
  beforeEach(() => {
    vi.mocked(query).mockClear();
    vi.mocked(query).mockResolvedValue({ rows: [] } as never);
  });

  it("maps callDurationSec to duration_seconds (legacy UsageBreakdown)", async () => {
    const store = new PersistenceStore();
    await store.appendUsage({
      orgId: "org-1",
      callId: "call-1",
      usage: { callDurationSec: 42, phone_number: "+18005550199" },
      callStartedAt: "",
      callEndedAt: "",
    });
    expect(query).toHaveBeenCalled();
    const args = vi.mocked(query).mock.calls[0][1] as unknown[];
    expect(args[3]).toBe(42);
  });

  it("prefers duration_seconds over callDurationSec when both present", async () => {
    const store = new PersistenceStore();
    await store.appendUsage({
      orgId: "org-1",
      callId: "call-1",
      usage: { callDurationSec: 10, duration_seconds: 99 },
      callStartedAt: "",
      callEndedAt: "",
    });
    const args = vi.mocked(query).mock.calls[0][1] as unknown[];
    expect(args[3]).toBe(99);
  });

  it("insert is idempotent per call_id (ON CONFLICT DO NOTHING)", async () => {
    const store = new PersistenceStore();
    await store.appendUsage({
      orgId: "org-1",
      callId: "call-1",
      usage: { duration_seconds: 1 },
      callStartedAt: "",
      callEndedAt: "",
    });
    const sql = vi.mocked(query).mock.calls[0][0] as string;
    expect(sql).toContain("ON CONFLICT (call_id) DO NOTHING");
  });
});
