/**
 * Frontend API client tests: **HTTP is mocked** with small JSON fixtures.
 * Assertions check **envelope unwrap and field mapping** only — fixture rows are not
 * “correct product data” and must not be treated as integration truth (Phase F).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api, unwrapData, DEFAULT_TENANT_ID } from "../lib/api";

describe("unwrapData", () => {
  it("unwraps sendData envelope", () => {
    expect(unwrapData<{ x: number }>({ data: { x: 1 } })).toEqual({ x: 1 });
  });

  it("passes through plain JSON", () => {
    expect(unwrapData({ ok: true })).toEqual({ ok: true });
  });
});

describe("api.analytics.getCalls (mocked fetch)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes("/calls?") && !u.includes("/live")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  callId: "c1",
                  startedAt: "2025-01-01T12:00:00.000Z",
                  endedAt: "2025-01-01T12:05:00.000Z",
                  callerNumber: "+15550001",
                  phoneLineNumber: "+15550000",
                  durationMs: 300000,
                  result: "completed",
                  turnCount: 3,
                  toolsUsed: [{ name: "calendar", success: true }],
                },
                {
                  callId: "c2",
                  startedAt: "2025-01-01T13:00:00.000Z",
                  endedAt: "2025-01-01T13:01:00.000Z",
                  callerNumber: "+15550002",
                  phoneLineNumber: "+15550000",
                  durationMs: 60000,
                  result: "systemFailed",
                  toolsUsed: [],
                },
              ],
            }),
          } as Response;
        }
        return {
          ok: false,
          status: 404,
          json: async () => ({}),
        } as Response;
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    global.fetch = originalFetch;
  });

  it("maps API rows to CallRecord with outcomes", async () => {
    const calls = await api.analytics.getCalls({ limit: 10 });
    expect(calls.length).toBe(2);
    expect(calls[0].callId).toBe("c1");
    expect(calls[0].outcome).toBe("handled");
    expect(calls[0].toolsUsed).toEqual(["calendar"]);
    expect(calls[1].outcome).toBe("failed");
  });

  it("respects limit", async () => {
    const calls = await api.analytics.getCalls({ limit: 1 });
    expect(calls.length).toBe(1);
  });
});

describe("api.analytics.getAggregate (mocked fetch)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes("/calls?") && !u.includes("/live")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  callId: "a",
                  startedAt: "2025-01-01T12:00:00.000Z",
                  endedAt: "2025-01-01T12:01:00.000Z",
                  phoneLineNumber: "+1",
                  durationMs: 60000,
                  result: "completed",
                  toolsUsed: [],
                },
                {
                  callId: "b",
                  startedAt: "2025-01-01T13:00:00.000Z",
                  endedAt: "2025-01-01T13:02:00.000Z",
                  phoneLineNumber: "+1",
                  durationMs: 120000,
                  result: "systemFailed",
                  toolsUsed: [],
                },
              ],
            }),
          } as Response;
        }
        if (u.includes("/calls/live")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: [{ callId: "live1", startedAt: new Date().toISOString() }] }),
          } as Response;
        }
        if (u.includes("/analytics/tools")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [{ name: "t1", invocations: 5, successRate: 1, failures: 0, avgLatency: 0 }],
            }),
          } as Response;
        }
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    global.fetch = originalFetch;
  });

  it("derives honest aggregates from calls + live + tools", async () => {
    const stats = await api.analytics.getAggregate();
    expect(stats.totalCalls).toBe(2);
    expect(stats.successfulCalls).toBe(1);
    expect(stats.failedCalls).toBe(1);
    expect(stats.activeNow).toBe(1);
    expect(stats.toolInvocations).toBe(5);
    expect(stats.successRate).toBe(0.5);
    expect(stats.averageDuration).toBe(90000);
  });
});

describe("api.health.get (mocked fetch)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              overall: "degraded",
              telephony: [{ status: "ok" }],
              stt: [{ status: "error" }],
              tts: [{ status: "disabled" }],
              llm: [{ status: "ok" }],
              tools: [{ status: "ok" }],
              integrations: [{ status: "ok" }],
            },
          }),
        } as Response;
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    global.fetch = originalFetch;
  });

  it("maps SystemHealthData to HealthStatus", async () => {
    const health = await api.health.get();
    expect(health.status).toBe("degraded");
    expect(health.services.stt).toBe("error");
    expect(health.services.tts).toBe("disabled");
  });
});

describe("api.analytics.getCallVolumeSeries (mocked fetch)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    vi.unstubAllGlobals();
    global.fetch = originalFetch;
  });

  it("returns empty when API returns no buckets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { totalCalls: [] } }),
        } as Response;
      })
    );
    const r = await api.analytics.getCallVolumeSeries();
    expect(r.empty).toBe(true);
    expect(r.series).toEqual([]);
  });

  it("maps non-empty totalCalls to a series", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { totalCalls: [1, 2] } }),
        } as Response;
      })
    );
    const r = await api.analytics.getCallVolumeSeries();
    expect(r.empty).toBe(false);
    expect(r.series).toHaveLength(2);
    expect(r.series[0]).toMatchObject({ calls: 1 });
    expect(r.series[1]).toMatchObject({ calls: 2 });
  });

  it("returns empty on fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return { ok: false, status: 500, json: async () => ({}) } as Response;
      })
    );
    const r = await api.analytics.getCallVolumeSeries();
    expect(r.empty).toBe(true);
    expect(r.series).toEqual([]);
  });
});

describe("DEFAULT_TENANT_ID", () => {
  it("has a default tenant string", () => {
    expect(typeof DEFAULT_TENANT_ID).toBe("string");
    expect(DEFAULT_TENANT_ID.length).toBeGreaterThan(0);
  });
});
