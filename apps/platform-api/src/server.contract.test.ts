/**
 * Contract tests: Fastify `inject()` + TypeBox shapes.
 * DB and external health checks are stubbed so CI does not require Postgres or third-party APIs.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { createInMemoryEventBus } from "@rezovo/event-bus";
import twilio from "twilio";

vi.hoisted(() => {
  process.env.CLERK_AUTH_ENABLED = "true";
  process.env.CLERK_SECRET_KEY = "sk_test_contract";
  process.env.CLERK_JWT_PUBLIC_KEY = "pk_test_contract";
  process.env.CLERK_WEBHOOK_SECRET = "whsec_contract";
  process.env.INTERNAL_SERVICE_TOKEN = "contract-internal-service-token";
  process.env.TWILIO_AUTH_TOKEN = "twilio-auth-contract";
});

vi.mock("./auth/clerk", () => ({
  isClerkEnabled: true,
  verifyClerkToken: vi.fn(async (token: string) => {
    const orgId = token.startsWith("organization:") ? token.slice("organization:".length) : "org_testorganization";
    return {
      sub: `clerk-${orgId}`,
      email: `contract+${orgId}@example.com`,
      orgId: orgId,
      orgIdClaim: orgId,
    };
  }),
  getClerkBackendClient: vi.fn(),
}));

vi.mock("./persistence/dbClient", () => {
  const query = vi.fn();
  return {
    query,
    ping: vi.fn().mockResolvedValue(true),
    closePool: vi.fn().mockResolvedValue(undefined),
    getPool: vi.fn(),
    getClient: vi.fn(),
    withTransaction: vi.fn(async (fn: (client: { query: typeof query }) => Promise<unknown>) =>
      fn({ query })),
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

vi.mock("./persistence/store", async () => {
  const actual = await vi.importActual<typeof import("./persistence/store")>("./persistence/store");
  return {
    ...actual,
    PersistenceStore: class extends actual.PersistenceStore {
      async deleteDocument(orgId: string, docId: string) {
        if (docId === "doc-not-found") {
          return {
            ok: false as const,
            docId,
            orgId,
            rowsDeletedDocs: 0,
            rowsDeletedChunks: 0,
            durationMs: 1,
            failureCategory: "not_found" as const,
          };
        }
        return {
          ok: true as const,
          docId,
          orgId,
          rowsDeletedDocs: 1,
          rowsDeletedChunks: 2,
          durationMs: 1,
        };
      }
    },
  };
});

import { query } from "./persistence/dbClient";
import { buildServer } from "./server";
import {
  AnalyticsSummaryEnvelopeSchema,
  BillingQuotaOkSchema,
  CallsListEnvelopeSchema,
  HealthEnvelopeSchema,
} from "./contracts/httpSchemas";

const TEST_ORG_ID = "org_testorganization";

const testOrganizationCallRow = {
  call_id: "call-list-contract-1",
  org_id: TEST_ORG_ID,
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
  failure_type: null,
  slots_collected: {},
  summary: null,
  turn_count: 3,
  llm_tokens_in: 0,
  llm_tokens_out: 0,
  tts_chars: 0,
  stt_seconds: 0,
};

const testOrganizationFailedStatusOnlyRow = {
  ...testOrganizationCallRow,
  call_id: "call-list-contract-2",
  status: "failed",
  outcome: null,
  end_reason: "error",
  failure_type: "busy",
};

const testOrganizationLiveRow = {
  ...testOrganizationCallRow,
  call_id: "call-live-contract-1",
  status: "in_progress",
  ended_at: null,
  duration_sec: null,
  outcome: null,
  started_at: "2026-01-15T14:00:00.000Z",
};

function wireDbMocks() {
  const q = vi.mocked(query);
  q.mockReset();
  q.mockImplementation(async (sql: string, params?: unknown[]) => {
    const s = sql.toLowerCase();
    const p0 = params?.[0];
    if (s.includes("from users") && s.includes("where clerk_id")) {
      return { rows: [] };
    }
    if (s.includes("from users") && s.includes("email")) {
      const rawEmail = typeof p0 === "string" ? p0 : `contract+${TEST_ORG_ID}@example.com`;
      const organizationMatch = /contract\+(.+?)@/.exec(rawEmail);
      const orgId = organizationMatch?.[1] ?? TEST_ORG_ID;
      return {
        rows: [
          {
            id: "user-contract-1",
            org_id: orgId,
            email: rawEmail,
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
    if (s.includes("count(*)::int as c") && s.includes("from calls") && s.includes("in_progress")) {
      if (p0 === TEST_ORG_ID) {
        return { rows: [{ c: "1" }] };
      }
      return { rows: [{ c: "0" }] };
    }
    if (
      (s.includes("from calls") && s.includes("status = any") && s.includes("ended_at is null")) ||
      (s.includes("in ('initiated'") && s.includes("from calls") && s.includes("select *"))
    ) {
      if (p0 === TEST_ORG_ID) {
        return { rows: [testOrganizationLiveRow] };
      }
      return { rows: [] };
    }
    if (
      s.includes("completed_calls") &&
      s.includes("handoff_calls") &&
      s.includes("dropped_calls") &&
      s.includes("from calls") &&
      s.includes("org_id = $1")
    ) {
      return {
        rows: [
          {
            total_calls: "150",
            completed_calls: "100",
            handoff_calls: "30",
            dropped_calls: "10",
            failed_calls: "10",
            total_duration_sec: "12000",
          },
        ],
      };
    }
    if (s.includes("sample_count") && s.includes("agent_spoke") && s.includes("group by c.call_id")) {
      return { rows: [{ sample_count: "2", avg_ms: 240 }] };
    }
    if (s.includes("as active_now")) {
      return { rows: [{ active_now: 1 }] };
    }
    if (s.includes("tool_invocations") && s.includes("tool_called")) {
      return { rows: [{ tool_invocations: 5 }] };
    }
    if (
      (s.includes("from calls c") && s.includes("order by c.started_at desc")) ||
      (s.includes("from calls") && s.includes("limit 100"))
    ) {
      if (p0 === TEST_ORG_ID) {
        return { rows: [testOrganizationCallRow, testOrganizationFailedStatusOnlyRow] };
      }
      return { rows: [] };
    }
    if (s.includes("select * from calls where call_id = $1")) {
      if (p0 === "call-end-existing-duration") {
        return {
          rows: [
            {
              ...testOrganizationCallRow,
              call_id: "call-end-existing-duration",
              org_id: TEST_ORG_ID,
              phone_number: "+18005550999",
              duration_sec: 321,
            },
          ],
        };
      }
      return { rows: [] };
    }
    if (s.includes("delete from kb_chunks where org_id = $1 and doc_id = $2")) {
      return { rowCount: 1, rows: [] };
    }
    if (s.includes("delete from kb_documents where org_id = $1 and doc_id = $2 returning doc_id")) {
      if (p0 === TEST_ORG_ID && params?.[1] === "doc-delete-1") {
        return { rowCount: 1, rows: [{ doc_id: "doc-delete-1" }] };
      }
      return { rowCount: 0, rows: [] };
    }
    if (s.includes("from calls") && s.includes("org_id")) {
      return { rows: [] };
    }
    return { rows: [] };
  });
}

describe("platform-api HTTP contract (inject)", () => {
  let app: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    wireDbMocks();
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

  it("GET /calls?orgId=… returns { data: [] } matching CallsListEnvelopeSchema", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/calls?orgId=${TEST_ORG_ID}`,
      headers: { authorization: `Bearer ${bearerForOrg()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Value.Check(CallsListEnvelopeSchema, body)).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("GET /config/snapshot accepts internal service bearer token", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/config/snapshot?orgId=${TEST_ORG_ID}&lob=default`,
      headers: { authorization: "Bearer contract-internal-service-token" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.orgId).toBe(TEST_ORG_ID);
  });

  it("GET /calls/live?orgId=… returns { data: [] } when no live rows", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/calls/live?orgId=organization-without-live-calls",
      headers: { authorization: `Bearer ${bearerForOrg("organization-without-live-calls")}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("GET /analytics/summary?orgId=… returns numeric summary envelope", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/analytics/summary?orgId=${TEST_ORG_ID}`,
      headers: { authorization: `Bearer ${bearerForOrg()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Value.Check(AnalyticsSummaryEnvelopeSchema, body)).toBe(true);
    expect(body.data.totalCalls).toBe(150);
    expect(body.data.completedCalls).toBe(100);
    expect(body.data.completionRate).toBe(67);
    expect(body.data.handoffRate).toBe(20);
    expect(body.data.avgTimeToAgentSpeechHasData).toBe(true);
    expect(body.data.avgTimeToAgentSpeechMs).toBe(240);
    expect(body.data.toolInvocations).toBe(5);
  });

  it("POST /knowledge/documents/:docId/delete deletes knowledge document via compatibility route", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/knowledge/documents/doc-123/delete",
      headers: { authorization: `Bearer ${bearerForOrg()}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body?.data?.ok).toBe(true);
    expect(body?.data?.diagnostics?.docId).toBe("doc-123");
  });

  it("POST /twilio/voice rejects missing Twilio signature when auth token is configured", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/twilio/voice",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "contract.example.com",
      },
      payload: {
        CallSid: "CA_missing_sig",
        From: "+15551234567",
        To: "+18005550199",
        CallStatus: "ringing",
        Direction: "inbound",
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "invalid_signature" });
  });

  it("POST /twilio/voice accepts valid Twilio signature", async () => {
    vi.spyOn(twilio, "validateRequest").mockReturnValueOnce(true);
    const payload = {
      CallSid: "CA_valid_sig",
      From: "+15551234567",
      To: "+18005550199",
      CallStatus: "ringing",
      Direction: "inbound",
    };

    const res = await app.inject({
      method: "POST",
      url: "/twilio/voice",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "contract.example.com",
        "x-twilio-signature": "test-valid-signature",
      },
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/xml");
  });

  it("GET /kb/status rejects cross-org access", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/kb/status?orgId=some-other-org&docId=doc-1`,
      headers: { authorization: `Bearer ${bearerForOrg(TEST_ORG_ID)}` },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error?.code).toBe("org_mismatch");
  });

  it("POST /calls/end mirrors existing duration when durationSec is omitted", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/calls/end",
      headers: {
        authorization: "Bearer contract-internal-service-token",
        "content-type": "application/json",
      },
      payload: {
        callId: "call-end-existing-duration",
        orgId: TEST_ORG_ID,
        outcome: "handled",
      },
    });
    expect(res.statusCode).toBe(200);

    const usageInsert = vi
      .mocked(query)
      .mock.calls.find((call) => String(call[0]).toLowerCase().includes("insert into usage_records"));
    expect(usageInsert).toBeDefined();
    const usageArgs = usageInsert?.[1] as unknown[];
    expect(usageArgs[0]).toBe(TEST_ORG_ID);
    expect(usageArgs[1]).toBe("call-end-existing-duration");
    expect(usageArgs[2]).toBe("+18005550999");
    expect(usageArgs[3]).toBe(321);

    const callEndedEventInsert = vi
      .mocked(query)
      .mock.calls.find(
        (call) =>
          String(call[0]).toLowerCase().includes("insert into call_events") &&
          (call[1] as unknown[] | undefined)?.[2] === "call_ended",
      );
    expect(callEndedEventInsert).toBeDefined();
    const callEndedParams = callEndedEventInsert?.[1] as unknown[];
    const callEndedPayload = JSON.parse(String(callEndedParams[3] ?? "{}")) as Record<string, unknown>;
    expect(callEndedPayload.endReason).toBe("agent_end");
  });

  it("DELETE /knowledge/documents/:docId deletes KB doc for the authenticated org", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/knowledge/documents/doc-delete-1",
      headers: { authorization: `Bearer ${bearerForOrg(TEST_ORG_ID)}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.ok).toBe(true);
    expect(body.data.diagnostics?.docId).toBe("doc-delete-1");
  });

  it("POST /auth/login is removed in Clerk-first mode", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: "contract-demo@example.com" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /phone-numbers is removed in Clerk-first mode", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/phone-numbers",
      headers: { authorization: `Bearer ${bearerForOrg()}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST /billing-quota/can-start-call returns BillingQuotaOkSchema", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/billing-quota/can-start-call",
      headers: { "content-type": "application/json", authorization: `Bearer ${bearerForOrg()}` },
      payload: { orgId: `quota-${Date.now()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Value.Check(BillingQuotaOkSchema, body)).toBe(true);
    expect(body.allowed).toBe(true);
  });

  function bearerForOrg(orgId = TEST_ORG_ID): string {
    return `organization:${orgId}`;
  }

  it("GET /auth/me returns organization from Bearer Clerk session token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${bearerForOrg()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.orgId).toBe(TEST_ORG_ID);
    expect(body.data.email).toBe(`contract+${TEST_ORG_ID}@example.com`);
  });

  it("GET /calls/live with Bearer JWT returns live rows for that organization", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/calls/live",
      headers: { authorization: `Bearer ${bearerForOrg()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].callId).toBe("call-live-contract-1");
  });

  it("GET /calls with Bearer JWT returns call list for that organization", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/calls",
      headers: { authorization: `Bearer ${bearerForOrg()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Value.Check(CallsListEnvelopeSchema, body)).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.data.some((row: any) => row.callId === "call-list-contract-1")).toBe(true);
    const failed = body.data.find((row: any) => row.callId === "call-list-contract-2");
    expect(failed.result).toBe("systemFailed");
    expect(failed.failureType).toBe("busy");
  });
});
