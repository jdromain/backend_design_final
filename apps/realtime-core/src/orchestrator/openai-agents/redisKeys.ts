/**
 * redisKeys.ts
 *
 * Centralized Redis key schema for the orchestrator.
 * All keys are namespaced, typed, and TTL-documented.
 */

export const RedisKeys = {
  // ─── Conversation State (survives process restarts) ───
  // TTL: 2 hours (max call duration + buffer)
  callState: (callId: string) => `call:${callId}:state` as const,
  callHistory: (callId: string) => `call:${callId}:history` as const,

  // ─── KB Prefetch Per Call (fetched once, reused all turns) ───
  // TTL: 30 minutes
  kbPrefetch: (callId: string) => `call:${callId}:kb_context` as const,

  // ─── Tool Idempotency (prevent duplicate bookings) ───
  // TTL: 1 hour
  idempotency: (key: string) => `idem:${key}` as const,

  // ─── Guardrail State (warn counts survive reconnection) ───
  // TTL: 2 hours
  warnCount: (callId: string) => `guard:warn:${callId}` as const,

  // ─── Rate Limiting ───
  // concurrent calls: SET of active callIds, TTL: auto-managed
  concurrentCalls: (tenantId: string) => `rate:calls:${tenantId}` as const,

  // ─── Config Cache (L2, behind in-memory ConfigCache) ───
  // TTL: 5 minutes
  agentConfig: (agentId: string) => `config:agent:${agentId}` as const,
  phoneRoute: (did: string) => `config:phone:${did}` as const,
} as const;

/** Default TTLs in seconds */
export const RedisTTL = {
  CALL_STATE: 7200,       // 2 hours
  CALL_HISTORY: 7200,     // 2 hours
  KB_PREFETCH: 1800,      // 30 minutes
  IDEMPOTENCY: 3600,      // 1 hour
  GUARDRAIL_WARN: 7200,   // 2 hours
  CONFIG_CACHE: 300,       // 5 minutes
} as const;
