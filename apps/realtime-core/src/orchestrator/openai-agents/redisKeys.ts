/**
 * Minimal Redis key schema for active guardrail counters.
 */

export const RedisKeys = {
  warnCount: (callId: string) => `guard:warn:${callId}` as const,
} as const;

/** Default TTLs in seconds */
export const RedisTTL = {
  GUARDRAIL_WARN: 7200,
} as const;
