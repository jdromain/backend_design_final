// API client for Rezovo backend
import type {
  LoginResponse,
  AgentConfig,
  CallRecord,
  AnalyticsAggregation,
  HealthStatus,
  KBDocument,
  KBDocumentStatus,
  ToolCredential,
  BillingQuota,
  PaginatedResponse,
  CallsQueryParams,
} from "./types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

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

// Base fetch wrapper with auth and error handling
async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Merge any existing headers
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

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

// Retry wrapper for resilience
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
        await new Promise((resolve) => setTimeout(resolve, delay * (attempt + 1)));
      }
    }
  }

  throw lastError;
}

// Authentication endpoints
export const auth = {
  login: async (email: string, password: string): Promise<LoginResponse> => {
    // Backend only uses email for dev authentication (no password validation)
    const response = await apiFetch<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    if (response.token) {
      setAuthToken(response.token);
    }
    // Mock user response since backend doesn't return user object
    return {
      token: response.token,
      user: {
        id: "user-1",
        email,
        roles: ["admin"],
        tenantId: "tenant-default",
      },
    };
  },

  logout: () => {
    setAuthToken(null);
  },
};

// Configuration endpoints
export const config = {
  getAgents: (): Promise<AgentConfig[]> => apiFetch("/config/agents"),

  getTenant: (): Promise<Record<string, unknown>> => apiFetch("/config/tenant"),

  updateTenant: (config: Record<string, unknown>): Promise<void> =>
    apiFetch("/config/tenant", {
      method: "PUT",
      body: JSON.stringify(config),
    }),

  createAgent: (
    name: string,
    config: Record<string, unknown>
  ): Promise<AgentConfig> =>
    apiFetch("/config/agents", {
      method: "POST",
      body: JSON.stringify({ name, config }),
    }),

  updateAgent: (
    agentId: string,
    name: string,
    config: Record<string, unknown>
  ): Promise<AgentConfig> =>
    apiFetch(`/config/agents/${agentId}`, {
      method: "PUT",
      body: JSON.stringify({ name, config }),
    }),

  deleteAgent: (agentId: string): Promise<void> =>
    apiFetch(`/config/agents/${agentId}`, {
      method: "DELETE",
    }),
};

// Analytics endpoints
export const analytics = {
  getAggregate: async (
    startDate?: string,
    endDate?: string
  ): Promise<AnalyticsAggregation> => {
    // Backend /analytics/calls returns: { calls, totalDurationMs, transfers, voicemail }
    const response = await withRetry(() => 
      apiFetch<{ calls: number; totalDurationMs: number; transfers: number; voicemail: number }>(
        `/analytics/calls?tenantId=tenant-default`
      )
    );
    
    const totalCalls = response.calls || 0;
    const avgDuration = totalCalls > 0 ? response.totalDurationMs / totalCalls : 0;
    
    // Backend doesn't track success/fail separately, so estimate
    const successfulCalls = Math.floor(totalCalls * 0.85); // Assume 85% success
    const failedCalls = totalCalls - successfulCalls - (response.transfers || 0) - (response.voicemail || 0);
    
    return {
      totalCalls,
      successfulCalls: Math.max(0, successfulCalls),
      failedCalls: Math.max(0, failedCalls),
      averageDuration: avgDuration,
      successRate: totalCalls > 0 ? successfulCalls / totalCalls : 0,
      activeNow: 0, // Backend doesn't track active calls in analytics
      toolInvocations: 0, // Would need to fetch from /analytics/tools
    };
  },

  getCalls: async (params: CallsQueryParams = {}): Promise<CallRecord[]> => {
    // Generate mock data for testing until backend endpoint is ready
    const mockCalls: CallRecord[] = [];
    const limit = params.limit || 10;
    const now = Date.now();
    
    for (let i = 0; i < Math.min(limit, 20); i++) {
      const startedAt = new Date(now - (i * 3600000) - Math.random() * 3600000);
      const duration = Math.floor(Math.random() * 300) + 30; // 30-330 seconds
      const endedAt = new Date(startedAt.getTime() + duration * 1000);
      const outcomes: CallRecord["outcome"][] = ["completed", "completed", "completed", "failed", "voicemail"];
      
      mockCalls.push({
        id: `call-${i + 1}`,
        callSid: `CA${Math.random().toString(36).substring(2, 15)}`,
        tenantId: "tenant-default",
        phoneNumber: "+15551234567",
        callerNumber: `+1555${Math.floor(Math.random() * 9000000) + 1000000}`,
        direction: i % 3 === 0 ? "outbound" : "inbound",
        status: i < 2 ? "in-progress" : "completed",
        outcome: i < 2 ? undefined : outcomes[Math.floor(Math.random() * outcomes.length)],
        startedAt: startedAt.toISOString(),
        endedAt: i < 2 ? undefined : endedAt.toISOString(),
        durationSeconds: i < 2 ? undefined : duration,
        toolsUsed: i % 2 === 0 ? ["calendar", "sms"] : undefined,
        transferredTo: i % 5 === 0 ? "+15559876543" : undefined,
        recordingUrl: i % 3 === 0 ? `https://api.twilio.com/recordings/RE${i}` : undefined,
      });
    }
    
    return mockCalls;
  },
};

// Knowledge Base endpoints
export const kb = {
  ingestDocument: (
    namespace: string,
    text: string,
    metadata?: Record<string, unknown>
  ): Promise<{ docId: string; status: string }> =>
    apiFetch("/kb/docs", {
      method: "POST",
      body: JSON.stringify({ namespace, text, metadata }),
    }),

  getStatus: (): Promise<KBDocumentStatus[]> => apiFetch("/kb/status"),

  retrieve: (
    namespace: string,
    query: string,
    topK = 5
  ): Promise<{ results: Array<{ text: string; score: number }> }> =>
    apiFetch("/kb/retrieve", {
      method: "POST",
      body: JSON.stringify({ namespace, query, top_k: topK }),
    }),
};

// Tool endpoints
export const tools = {
  saveCredentials: (
    provider: string,
    credentials: Record<string, unknown>
  ): Promise<void> =>
    apiFetch("/tool/credentials", {
      method: "POST",
      body: JSON.stringify({ provider, credentials }),
    }),

  call: (
    toolName: string,
    args: Record<string, unknown>,
    idempotencyKey?: string,
    provider?: string
  ): Promise<{ ok: boolean; fromCache?: boolean; result?: unknown }> =>
    apiFetch("/tool/call", {
      method: "POST",
      body: JSON.stringify({ tool_name: toolName, args, idempotency_key: idempotencyKey, provider }),
    }),
};

// Billing endpoints
export const billing = {
  canStartCall: (tenantId: string): Promise<BillingQuota> =>
    apiFetch("/billing-quota/can-start-call", {
      method: "POST",
      body: JSON.stringify({ tenantId }),
    }),
};

// Health endpoint
export const health = {
  get: (): Promise<HealthStatus> => withRetry(() => apiFetch("/health")),
};

// Default export with all API modules
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

