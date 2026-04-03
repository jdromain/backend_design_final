/**
 * Contract tests: Fastify `inject()` + TypeBox shapes.
 * DB and external health checks are stubbed so CI does not require Postgres or third-party APIs.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { Value } from "@sinclair/typebox/value";
import jwt from "jsonwebtoken";
import { createInMemoryEventBus } from "@rezovo/event-bus";

const { CONTRACT_JWT_SECRET } = vi.hoisted(() => {
  const secret = "contract-test-jwt-secret";
  process.env.CLERK_AUTH_ENABLED = "false";
  process.env.JWT_SECRET = secret;
  return { CONTRACT_JWT_SECRET: secret };
});

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

const testTenantCallRow = {
  call_id: "call-list-contract-1",
  tenant_id: "test-tenant",
  phone_number: "+18005550199",
  caller_number: "+15551234567",
  twilio_call_sid: "CAcontract",
  direction: "inbound",
  classified_intent: "support",
  intent_confidence: null,
  final_intent: null,
  agent_config_id: "agent-contract",
  agent_config_ver: 1,
  status: "completed",
  started_at: "2026-01-15T12:00:00.000Z",
  answered_at: null,
  ended_at: "2026-01-15T12:05:00.000Z",
  duration_sec: 120,
  end_reason: null,
  outcome: "handled",
  slots_collected: {},
  summary: null,
  turn_count: 3,
  llm_tokens_in: 0,
  llm_tokens_out: 0,
  tts_chars: 0,
  stt_seconds: 0,
};

const testTenantLiveRow = {
  ...testTenantCallRow,
  call_id: "call-live-contract-1",
  status: "in_progress",
  ended_at: null,
  duration_sec: null,
  outcome: null,
  started_at: "2026-01-15T14:00:00.000Z",
};

function wireDbMocks() {
  const q = vi.mocked(query);
  q.mockImplementation(async (sql: string, params?: unknown[]) => {
    const s = sql.toLowerCase();
    const p0 = params?.[0];
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
    if (s.includes("select * from call_transcript")) {
      return { rows: [] };
    }
    if (
      s.includes("from call_events") &&
      s.includes("call_id") &&
      s.includes("order by occurred_at") &&
      !s.includes("tool_called")
    ) {
      return { rows: [] };
    }
    if (s.includes("select call_id, payload") && s.includes("tool_called")) {
      return { rows: [] };
    }
    if (s.includes("in ('initiated'") && s.includes("from calls")) {
      if (p0 === "test-tenant") {
        return { rows: [testTenantLiveRow] };
      }
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
    if (s.includes("tool_invocations") && s.includes("tool_called")) {
      return { rows: [{ tool_invocations: 5 }] };
    }
    if (s.includes("from calls") && s.includes("limit 100")) {
      if (p0 === "test-tenant") {
        return { rows: [testTenantCallRow] };
      }
      return { rows: [] };
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
    process.env.JWT_SECRET = CONTRACT_JWT_SECRET;
    process.env.CLERK_AUTH_ENABLED = "false"; // dev JWT path; ignore local .env Clerk flag
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

  function bearerTestTenant(): string {
    return jwt.sign(
      {
        sub: "jwt-contract-user",
        tenant_id: "test-tenant",
        email: "contract-tenant@example.com",
        roles: ["viewer"],
      },
      CONTRACT_JWT_SECRET,
      { expiresIn: "1h" }
    );
  }

  it("GET /auth/me returns tenant from Bearer JWT (dev JWT path)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${bearerTestTenant()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.tenantId).toBe("test-tenant");
    expect(body.data.email).toBe("contract-tenant@example.com");
  });

  it("GET /calls/live with Bearer JWT returns live rows for that tenant", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/calls/live",
      headers: { authorization: `Bearer ${bearerTestTenant()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].callId).toBe("call-live-contract-1");
  });

  it("GET /calls with Bearer JWT returns call list for that tenant", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/calls",
      headers: { authorization: `Bearer ${bearerTestTenant()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Value.Check(CallsListEnvelopeSchema, body)).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].callId).toBe("call-list-contract-1");
  });
});
