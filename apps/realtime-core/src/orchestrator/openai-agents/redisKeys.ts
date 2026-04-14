/**
 * Redis key schema for call guardrails + durable conversational state.
 */

export const RedisKeys = {
  warnCount: (callId: string) => `guard:warn:${callId}` as const,
  conversationState: (callId: string) => `conv:state:${callId}` as const,
} as const;

/** Default TTLs in seconds */
export const RedisTTL = {
  GUARDRAIL_WARN: 7200,
  CONVERSATION_STATE: 21_600,
} as const;
