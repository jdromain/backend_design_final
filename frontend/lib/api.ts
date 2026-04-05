// API client for Rezovo backend
import type {
  LoginResponse,
  AgentConfig,
  CallRecord,
  AnalyticsAggregation,
  HealthStatus,
  KBDocumentStatus,
  ToolCredential,
  BillingQuota,
  CallsQueryParams,
} from "./types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

/** Default tenant for demo / dev JWT fallback (must match DB seeds, e.g. test-tenant). */
export const DEFAULT_TENANT_ID =
  process.env.NEXT_PUBLIC_DEFAULT_TENANT_ID || "test-tenant";

/** Matches platform-api billingQuota soft cap. */
export const BILLING_CONCURRENCY_LIMIT = 10;

class APIError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: unknown
  ) {
    super(message);
    this.name = "APIError";
  }
}

// Token management
let authToken: string | null = null;

if (typeof window !== "undefined") {
  authToken = localStorage.getItem("auth_token");
}

export function setAuthToken(token: string | null) {
  authToken = token;
  if (typeof window !== "undefined") {
    if (token) {
      localStorage.setItem("auth_token", token);
    } else {
      localStorage.removeItem("auth_token");
    }
  }
}

export function getAuthToken(): string | null {
  if (typeof window !== "undefined" && !authToken) {
    authToken = localStorage.getItem("auth_token");
  }
  return authToken;
}

/** Unwrap `{ data: T }` from platform-api `sendData` responses. */
export function unwrapData<T>(body: unknown): T {
  if (
    body !== null &&
    typeof body === "object" &&
    "data" in body &&
    (body as { data: unknown }).data !== undefined
  ) {
    return (body as { data: T }).data;
  }
  return body as T;
}

// Base fetch wrapper with auth and error handling (raw JSON body)
async function apiFetchRaw(
  endpoint: string,
  options: RequestInit = {}
): Promise<unknown> {
  const url = `${API_BASE_URL}${endpoint}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (options.headers) {
    const existingHeaders = new Headers(options.headers);
    existingHeaders.forEach((value, key) => {
      headers[key] = value;
    });
  }

  const token = getAuthToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorData: unknown;
    try {
      errorData = await response.json();
    } catch {
      errorData = await response.text();
    }
    throw new APIError(
      response.status,
      `API Error: ${response.statusText}`,
      errorData
    );
  }

  if (response.status === 204) {
    return undefined;
  }

  return response.json();
}

async function apiFetchData<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const body = await apiFetchRaw(endpoint, options);
  return unwrapData<T>(body);
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delay = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, delay * (attempt + 1))
        );
      }
    }
  }

  throw lastError;
}

// --- Call row mapping (GET /calls) ---

type ApiCallRow = {
  callId: string;
  startedAt: string;
  endedAt?: string;
  callerNumber?: string;
  phoneLineNumber?: string;
  phoneLineId?: string;
  direction?: string;
  durationMs?: number;
  result: "completed" | "handoff" | "dropped" | "systemFailed" | "pending";
  endReason?: string;
  turnCount?: number;
  toolsUsed?: Array<{ name: string; success: boolean }>;
};

function mapApiResultToOutcome(
  result: ApiCallRow["result"]
): CallRecord["outcome"] {
  switch (result) {
    case "completed":
      return "handled";
    case "handoff":
      return "escalated";
    case "dropped":
      return "abandoned";
    case "systemFailed":
      return "failed";
    default:
      return "handled";
  }
}

function mapApiCallRow(row: ApiCallRow, tenantId: string): CallRecord {
  return {
    callId: row.callId,
    tenantId,
    phoneNumber: row.phoneLineNumber || row.phoneLineId || "",
    callerNumber: row.callerNumber,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    durationMs: row.durationMs,
    outcome: mapApiResultToOutcome(row.result),
    endReason: row.endReason,
    turnCount: row.turnCount,
    toolsUsed: row.toolsUsed?.map((t) => t.name) ?? [],
  };
}

type ApiLiveCallRow = {
  callId: string;
  callerNumber?: string;
  startedAt: string;
  durationSeconds?: number;
  tools?: Array<{ name: string; status?: string }>;
};

function mapLiveRowToCallRecord(
  row: ApiLiveCallRow,
  tenantId: string
): CallRecord {
  return {
    callId: row.callId,
    tenantId,
    phoneNumber: "",
    callerNumber: row.callerNumber,
    startedAt: row.startedAt,
    durationMs:
      row.durationSeconds !== undefined
        ? row.durationSeconds * 1000
        : undefined,
    outcome: "handled",
    toolsUsed: row.tools?.map((t) => t.name) ?? [],
  };
}

type ApiAgentRow = {
  id: string;
  name: string;
  description?: string;
  status?: string;
  type?: string;
  version: string;
  phoneLines?: string[];
  tools?: unknown[];
  metrics?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
};

function mapApiAgentToAgentConfig(
  row: ApiAgentRow,
  tenantId: string
): AgentConfig {
  const ver = Number.parseInt(String(row.version), 10);
  return {
    id: row.id,
    tenantId,
    name: row.name,
    version: Number.isFinite(ver) ? ver : 0,
    config: {
      description: row.description,
      status: row.status,
      type: row.type,
      phoneLines: row.phoneLines,
      tools: row.tools,
      metrics: row.metrics,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

type SparklinesResponse = {
  totalCalls: number[];
};

export type CallVolumeSeriesResult = {
  /** Hourly points when `/analytics/sparklines` returned buckets. */
  series: Array<{ time: string; calls: number }>;
  /** True when there is no series from the API (failed request or no buckets). */
  empty: boolean;
};

type ToolAnalyticsRow = {
  invocations: number;
};

export type BillingUsagePayload = {
  totalMinutes: number;
  totalCalls: number;
  totalTokens: number;
  agentCount: number;
  kbDocuments: number;
  kbChunks: number;
  plan: null | {
    minutesIncluded: number;
    costPerMinute: number;
    concurrentCallsLimit: number;
  };
};

export type BillingUsageHistoryRow = {
  id: string;
  period: string;
  calls: number;
  minutes: number;
  total: number;
  kind: "usage_month_rollup";
};

function decodeJwtPayload(token: string): {
  sub?: string;
  email?: string;
  tenant_id?: string;
  roles?: string[];
} | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json =
      typeof atob !== "undefined"
        ? atob(b64)
        : Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(json) as {
      sub?: string;
      email?: string;
      tenant_id?: string;
      roles?: string[];
    };
  } catch {
    return null;
  }
}

// Authentication endpoints
export const auth = {
  login: async (email: string, _password?: string): Promise<LoginResponse> => {
    const res = await fetch(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      token?: string;
      error?: string;
      user?: LoginResponse["user"];
    };

    if (!res.ok || !data.ok || !data.token) {
      throw new APIError(
        res.status,
        data.error || "Login failed",
        data
      );
    }

    setAuthToken(data.token);

    let user = data.user;
    if (!user) {
      const claims = decodeJwtPayload(data.token);
      if (!claims?.sub || !claims.email) {
        throw new APIError(
          502,
          "Login succeeded but response omitted user and JWT had no sub/email",
          data
        );
      }
      user = {
        id: claims.sub,
        email: claims.email,
        roles: (claims.roles as LoginResponse["user"]["roles"]) ?? [],
        tenantId: claims.tenant_id ?? DEFAULT_TENANT_ID,
      };
    }

    return { token: data.token, user };
  },

  logout: () => {
    setAuthToken(null);
  },
};

// Configuration endpoints (legacy /config/* where it exists)
export const config = {
  /** Reads agents from `GET /agents` (platform-api), not `/config/agents`. */
  getAgents: async (): Promise<AgentConfig[]> => {
    const rows = await apiFetchData<ApiAgentRow[]>(
      `/agents?tenantId=${encodeURIComponent(DEFAULT_TENANT_ID)}`
    );
    return rows.map((r) => mapApiAgentToAgentConfig(r, DEFAULT_TENANT_ID));
  },

  getTenant: (): Promise<Record<string, unknown>> =>
    apiFetchData(`/config/tenant`),

  updateTenant: (cfg: Record<string, unknown>): Promise<void> =>
    apiFetchRaw(`/config/tenant`, {
      method: "PUT",
      body: JSON.stringify(cfg),
    }) as Promise<void>,

  createAgent: (
    name: string,
    cfg: Record<string, unknown>
  ): Promise<AgentConfig> =>
    apiFetchData(`/config/agents`, {
      method: "POST",
      body: JSON.stringify({ name, config: cfg }),
    }),

  updateAgent: (
    agentId: string,
    name: string,
    cfg: Record<string, unknown>
  ): Promise<AgentConfig> =>
    apiFetchData(`/config/agents/${agentId}`, {
      method: "PUT",
      body: JSON.stringify({ name, config: cfg }),
    }),

  deleteAgent: (agentId: string): Promise<void> =>
    apiFetchRaw(`/config/agents/${agentId}`, { method: "DELETE" }) as Promise<void>,
};

// Analytics endpoints
export const analytics = {
  /**
   * Honest aggregates from `GET /calls`, `GET /calls/live`, and `GET /analytics/tools`.
   */
  getAggregate: async (
    _startDate?: string,
    _endDate?: string
  ): Promise<AnalyticsAggregation> => {
    const tenantId = DEFAULT_TENANT_ID;
    const [callsRows, liveRows, toolRows] = await Promise.all([
      withRetry(() =>
        apiFetchData<ApiCallRow[]>(
          `/calls?tenantId=${encodeURIComponent(tenantId)}`
        )
      ),
      apiFetchData<ApiLiveCallRow[]>(
        `/calls/live?tenantId=${encodeURIComponent(tenantId)}`
      ).catch(() => [] as ApiLiveCallRow[]),
      withRetry(() =>
        apiFetchData<ToolAnalyticsRow[]>(
          `/analytics/tools?tenantId=${encodeURIComponent(tenantId)}`
        )
      ).catch(() => [] as ToolAnalyticsRow[]),
    ]);

    const calls = callsRows.map((r) => mapApiCallRow(r, tenantId));
    const totalCalls = calls.length;
    const successfulCalls = calls.filter((c) => c.outcome === "handled").length;
    const failedCalls = calls.filter((c) => c.outcome === "failed").length;

    const totalDurationMs = calls.reduce(
      (s, c) => s + (c.durationMs ?? 0),
      0
    );
    const averageDuration =
      totalCalls > 0 ? totalDurationMs / totalCalls : 0;
    const successRate =
      totalCalls > 0 ? successfulCalls / totalCalls : 0;

    const toolInvocations = toolRows.reduce(
      (s, r) => s + (r.invocations ?? 0),
      0
    );

    return {
      totalCalls,
      successfulCalls,
      failedCalls,
      averageDuration,
      successRate,
      activeNow: liveRows.length,
      toolInvocations,
    };
  },

  /** Real call list from `GET /calls` (optional client-side limit / filters). */
  getCalls: async (params: CallsQueryParams = {}): Promise<CallRecord[]> => {
    const tenantId = DEFAULT_TENANT_ID;
    const rows = await withRetry(() =>
      apiFetchData<ApiCallRow[]>(
        `/calls?tenantId=${encodeURIComponent(tenantId)}`
      )
    );
    let calls = rows.map((r) => mapApiCallRow(r, tenantId));

    if (params.outcome) {
      calls = calls.filter((c) => c.outcome === params.outcome);
    }
    if (params.phoneNumber) {
      calls = calls.filter(
        (c) => c.phoneNumber && c.phoneNumber.includes(params.phoneNumber!)
      );
    }
    const limit = params.limit ?? 1000;
    const offset = params.offset ?? 0;
    calls = calls.slice(offset, offset + limit);

    return calls;
  },

  /** Active calls from `GET /calls/live`. */
  getLiveCalls: async (): Promise<CallRecord[]> => {
    const tenantId = DEFAULT_TENANT_ID;
    const rows = await apiFetchData<ApiLiveCallRow[]>(
      `/calls/live?tenantId=${encodeURIComponent(tenantId)}`
    );
    return rows.map((r) => mapLiveRowToCallRecord(r, tenantId));
  },

  /**
   * Last-24h hourly totals from `/analytics/sparklines`.
   * If the API returns no buckets or the request fails, `empty` is true — do not fabricate a 24h zero series.
   */
  getCallVolumeSeries: async (): Promise<CallVolumeSeriesResult> => {
    const tenantId = DEFAULT_TENANT_ID;
    let spark: SparklinesResponse;
    try {
      spark = await withRetry(() =>
        apiFetchData<SparklinesResponse>(
          `/analytics/sparklines?tenantId=${encodeURIComponent(tenantId)}`
        )
      );
    } catch {
      return { series: [], empty: true };
    }

    const raw = spark.totalCalls ?? [];
    const n = raw.length;
    if (n === 0) {
      return { series: [], empty: true };
    }

    const series = raw.map((calls, i) => {
      const d = new Date();
      d.setHours(d.getHours() - (n - 1 - i));
      d.setMinutes(0, 0, 0);
      return {
        time: d.getHours().toString().padStart(2, "0") + ":00",
        calls,
      };
    });
    return { series, empty: false };
  },
};

type KnowledgeDocumentsEnvelope = {
  documents: Array<{
    id: string;
    namespace: string;
    name?: string;
    status: string;
    chunks?: number;
    ingestedAt?: string;
  }>;
};

function mapKbDocToStatus(
  d: KnowledgeDocumentsEnvelope["documents"][0]
): KBDocumentStatus {
  const st = d.status;
  let status: KBDocumentStatus["status"] = "processing";
  if (st === "ready") status = "embedded";
  else if (st === "failed") status = "failed";
  else if (st === "chunking") status = "processing";

  return {
    docId: d.id,
    namespace: d.namespace,
    status,
    embeddedChunks: d.chunks ?? 0,
    ingestedAt: d.ingestedAt ?? new Date().toISOString(),
  };
}

// Knowledge Base endpoints
export const kb = {
  ingestDocument: (
    namespace: string,
    text: string,
    metadata?: Record<string, unknown>
  ): Promise<{ docId: string; status: string }> =>
    apiFetchRaw(`/kb/docs`, {
      method: "POST",
      body: JSON.stringify({ namespace, text, metadata }),
    }) as Promise<{ docId: string; status: string }>,

  /** Document list from `GET /knowledge/documents` (Postgres-backed). */
  listDocuments: async (): Promise<KBDocumentStatus[]> => {
    const env = await apiFetchData<KnowledgeDocumentsEnvelope>(
      `/knowledge/documents?tenantId=${encodeURIComponent(DEFAULT_TENANT_ID)}`
    );
    return (env.documents ?? []).map(mapKbDocToStatus);
  },

  getStatus: (): Promise<KBDocumentStatus[]> =>
    apiFetchData(`/kb/status`),

  retrieve: (
    namespace: string,
    query: string,
    topK = 5
  ): Promise<{ results: Array<{ text: string; score: number }> }> =>
    apiFetchRaw(`/kb/retrieve`, {
      method: "POST",
      body: JSON.stringify({ namespace, query, top_k: topK }),
    }) as Promise<{ results: Array<{ text: string; score: number }> }>,
};

// Tool endpoints
export const tools = {
  saveCredentials: (
    provider: string,
    credentials: Record<string, unknown>
  ): Promise<void> =>
    apiFetchRaw(`/tool/credentials`, {
      method: "POST",
      body: JSON.stringify({ provider, credentials }),
    }) as Promise<void>,

  call: (
    toolName: string,
    args: Record<string, unknown>,
    idempotencyKey?: string,
    provider?: string
  ): Promise<{
    ok: boolean;
    fromCache?: boolean;
    /** True when no real external connector ran (mock/stub path or empty creds). */
    mocked?: boolean;
    result?: unknown;
  }> =>
    apiFetchRaw(`/tool/call`, {
      method: "POST",
      body: JSON.stringify({
        tool_name: toolName,
        args,
        idempotency_key: idempotencyKey,
        provider,
      }),
    }) as Promise<{
      ok: boolean;
      fromCache?: boolean;
      mocked?: boolean;
      result?: unknown;
    }>,
};

// Billing endpoints
export const billing = {
  canStartCall: async (tenantId: string): Promise<BillingQuota> => {
    const body = (await apiFetchRaw(`/billing-quota/can-start-call`, {
      method: "POST",
      body: JSON.stringify({ tenantId }),
    })) as {
      allowed?: boolean;
      reason?: string;
      active?: number;
    };

    const allowed = Boolean(body.allowed);
    return {
      allowed,
      reason: body.reason,
      currentConcurrency: typeof body.active === "number" ? body.active : 0,
      limit: BILLING_CONCURRENCY_LIMIT,
    };
  },

  /** Rolled-up usage from Postgres (`/billing/usage`). */
  getUsage: async (
    period?: "7d" | "30d" | "90d"
  ): Promise<BillingUsagePayload> => {
    const q = new URLSearchParams({
      tenantId: DEFAULT_TENANT_ID,
    });
    if (period) q.set("period", period);
    return apiFetchData<BillingUsagePayload>(`/billing/usage?${q.toString()}`);
  },

  /** Monthly rows from `usage_records` (internal metering, not a payment provider). */
  getUsageHistory: async (): Promise<BillingUsageHistoryRow[]> => {
    return apiFetchData<BillingUsageHistoryRow[]>(
      `/billing/invoices?tenantId=${encodeURIComponent(DEFAULT_TENANT_ID)}`
    );
  },
};

type SystemHealthPayload = {
  overall: "operational" | "degraded" | "outage";
  telephony: Array<{ status: string }>;
  stt: Array<{ status: string }>;
  tts: Array<{ status: string }>;
  llm: Array<{ status: string }>;
  tools: Array<{ status: string }>;
  integrations: Array<{ status: string }>;
};

function mapHealthToStatus(data: SystemHealthPayload): HealthStatus {
  const flat: Record<string, "ok" | "error" | "disabled"> = {};

  const push = (prefix: string, arr: Array<{ status: string }>) => {
    arr.forEach((item, i) => {
      const k = arr.length > 1 ? `${prefix}_${i}` : prefix;
      const s = item.status;
      flat[k] =
        s === "ok"
          ? "ok"
          : s === "disabled"
            ? "disabled"
            : "error";
    });
  };

  push("telephony", data.telephony ?? []);
  push("stt", data.stt ?? []);
  push("tts", data.tts ?? []);
  push("llm", data.llm ?? []);
  push("tools", data.tools ?? []);
  push("integrations", data.integrations ?? []);

  let status: HealthStatus["status"] = "ok";
  if (data.overall === "outage") status = "error";
  else if (data.overall === "degraded") status = "degraded";

  return { status, services: flat };
}

// Health endpoint
export const health = {
  get: async (): Promise<HealthStatus> => {
    const raw = await withRetry(() => apiFetchRaw("/health"));
    const data = unwrapData<SystemHealthPayload>(raw);
    return mapHealthToStatus(data);
  },
};

export const api = {
  auth,
  config,
  analytics,
  kb,
  tools,
  billing,
  health,
};

export default api;

export { APIError };
