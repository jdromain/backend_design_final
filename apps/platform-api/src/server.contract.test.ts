/**
 * Contract tests: Fastify `inject()` + TypeBox shapes.
 * DB and external health checks are stubbed so CI does not require Postgres or third-party APIs.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { createInMemoryEventBus } from "@rezovo/event-bus";

vi.mock("./persistence/dbClient", () => {
  const query = vi.fn();
  return {
    query,
    ping: vi.fn().mockResolvedValue(true),
    closePool: vi.fn().mockResolvedValue(undefined),
    getPool: vi.fn(),
    getClient: vi.fn(),
    withTransaction: vi.fn(),
  };
});

vi.mock("./health/checks", () => ({
  getSystemHealthData: vi.fn().mockResolvedValue({
    overall: "operational" as const,
    telephony: [{ name: "Twilio", status: "disabled" }],
    stt: [{ name: "Deepgram STT", status: "disabled" }],
    tts: [{ name: "ElevenLabs TTS", status: "disabled" }],
    llm: [{ name: "OpenAI", status: "disabled" }],
    tools: [{ name: "PostgreSQL", status: "disabled" }],
    integrations: [
      { name: "Redis", status: "disabled" },
      { name: "Kafka", status: "disabled" },
    ],
  }),
  runHealthChecks: vi.fn(),
}));

import { query } from "./persistence/dbClient";
import { buildServer } from "./server";
import {
  AnalyticsSummaryEnvelopeSchema,
  BillingQuotaOkSchema,
  CallsListEnvelopeSchema,
  HealthEnvelopeSchema,
  LoginOkSchema,
} from "./contracts/httpSchemas";

function wireDbMocks() {
  const q = vi.mocked(query);
  q.mockImplementation(async (sql: string) => {
    const s = sql.toLowerCase();
    if (s.includes("from users") && s.includes("email")) {
      return {
        rows: [
          {
            id: "user-contract-1",
            tenant_id: "tenant-default",
            email: "contract-demo@example.com",
            roles: ["admin"],
            name: "Contract Demo",
          },
        ],
      };
    }
    // GET /calls/live — full rows (empty for contract test)
    if (s.includes("select * from calls") && s.includes("in_progress")) {
      return { rows: [] };
    }
    if (s.includes("filter (where outcome = 'handled')")) {
      return {
        rows: [
          {
            total_calls: 4,
            successful_calls: 2,
            failed_calls: 1,
            total_duration_sec: "240",
          },
        ],
      };
    }
    if (s.includes("as active_now")) {
      return { rows: [{ active_now: 1 }] };
    }
    if (s.includes("tool_called")) {
      return { rows: [{ tool_invocations: 5 }] };
    }
    if (s.includes("from calls") && s.includes("tenant_id")) {
      return { rows: [] };
    }
    return { rows: [] };
  });
}

describe("platform-api HTTP contract (inject)", () => {
  let app: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    wireDbMocks();
    process.env.JWT_SECRET = process.env.JWT_SECRET || "contract-test-jwt-secret";
    const bus = createInMemoryEventBus();
    app = buildServer(bus);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    wireDbMocks();
  });

  it("GET /health returns { data } matching HealthEnvelopeSchema", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Value.Check(HealthEnvelopeSchema, body)).toBe(true);
  });

  it("GET /calls?tenantId=… returns { data: [] } matching CallsListEnvelopeSchema", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/calls?tenantId=tenant-default",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Value.Check(CallsListEnvelopeSchema, body)).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("GET /calls/live?tenantId=… returns { data: [] } when no live rows", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/calls/live?tenantId=tenant-default",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("GET /analytics/summary?tenantId=… returns numeric summary envelope", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/analytics/summary?tenantId=tenant-default",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Value.Check(AnalyticsSummaryEnvelopeSchema, body)).toBe(true);
    expect(body.data.totalCalls).toBe(4);
    expect(body.data.toolInvocations).toBe(5);
  });

  it("POST /auth/login returns LoginOkSchema for a known user row", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: "contract-demo@example.com" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Value.Check(LoginOkSchema, body)).toBe(true);
    expect(body.user.tenantId).toBe("tenant-default");
  });

  it("POST /billing-quota/can-start-call returns BillingQuotaOkSchema", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/billing-quota/can-start-call",
      headers: { "content-type": "application/json" },
      payload: { tenantId: `quota-${Date.now()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Value.Check(BillingQuotaOkSchema, body)).toBe(true);
    expect(body.allowed).toBe(true);
  });
});
