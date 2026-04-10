// Type definitions matching backend API contracts

export type AuthRole = "admin" | "editor" | "viewer";

export interface User {
  id: string;
  email: string;
  roles: AuthRole[];
  orgId?: string;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface AgentConfig {
  id: string;
  orgId: string;
  name: string;
  version: number;
  config: Record<string, unknown>;
  /** ISO timestamps when the API provides them; omitted by platform-api when not persisted. */
  createdAt?: string;
  updatedAt?: string;
}

export interface CallRecord {
  callId: string;
  orgId: string;
  phoneNumber: string;
  callerNumber?: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  outcome: "handled" | "failed" | "abandoned" | "escalated";
  endReason?: string;
  turnCount?: number;
  toolsUsed?: string[];
}

export interface AnalyticsAggregation {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  averageDuration: number;
  successRate: number;
  activeNow: number;
  toolInvocations: number;
}

export interface HealthStatus {
  status: "ok" | "degraded" | "error";
  services: Record<string, "ok" | "error" | "disabled">;
}

export interface KBDocument {
  docId: string;
  orgId: string;
  namespace: string;
  text: string;
  metadata?: Record<string, unknown>;
  ingestedAt: string;
  embeddedChunks?: number;
}

export interface KBDocumentStatus {
  docId: string;
  namespace: string;
  status: "ingest_requested" | "processing" | "embedded" | "failed";
  embeddedChunks: number;
  totalChunks?: number;
  ingestedAt: string;
}

export interface ToolCredential {
  provider: string;
  credentials: Record<string, unknown>;
}

export interface BillingQuota {
  allowed: boolean;
  reason?: string;
  currentConcurrency?: number;
  limit?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface CallsQueryParams {
  limit?: number;
  offset?: number;
  startDate?: string;
  endDate?: string;
  outcome?: CallRecord["outcome"];
  phoneNumber?: string;
}

