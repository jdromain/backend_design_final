/**
 * env.ts — MUST be the first import in src/index.ts
 *
 * Loads .env from the app directory and validates all required variables.
 * Exports a typed `env` object so the rest of the codebase never calls
 * process.env directly for critical values.
 */

import { resolve } from "path";
import { config } from "dotenv";

// Load .env from apps/realtime-core/.env
// __dirname resolves to dist/ after build, so we go up one level.
const envPath = resolve(__dirname, "../.env");
const result = config({ path: envPath });

if (result.error && process.env.NODE_ENV !== "production") {
  console.error(`[env] Failed to load .env from ${envPath}: ${result.error.message}`);
  console.error("[env] Create apps/realtime-core/.env — see apps/realtime-core/.env.example");
  process.exit(1);
}

// ─── Helpers ───

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function optionalNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseFloat(v);
  return isNaN(n) ? fallback : n;
}

function optionalInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return isNaN(n) ? fallback : n;
}

function optionalBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v === "true";
}

// ─── Typed env object ───

export const env = {
  // LLM
  LLM_PROVIDER: optional("LLM_PROVIDER", "openai"),
  OPENAI_API_KEY: optional("OPENAI_API_KEY", ""),
  LLM_MODEL: optional("LLM_MODEL", "gpt-5-nano"),
  LLM_MAX_TOKENS: optionalInt("LLM_MAX_TOKENS", 800),
  CONVERSATION_ENGINE: optional("CONVERSATION_ENGINE", "legacy") as
    | "realtime_agents"
    | "legacy",
  REALTIME_LIFECYCLE_FIX_ENABLED: optionalBool("REALTIME_LIFECYCLE_FIX_ENABLED", true),
  REALTIME_CHUNK_QUEUE_V2_ENABLED: optionalBool("REALTIME_CHUNK_QUEUE_V2_ENABLED", true),
  REALTIME_BARGE_CLEAR_PACING_ENABLED: optionalBool("REALTIME_BARGE_CLEAR_PACING_ENABLED", true),
  REALTIME_RAG_RELIABILITY_ENABLED: optionalBool("REALTIME_RAG_RELIABILITY_ENABLED", true),
  REALTIME_CANARY_PERCENT: optionalInt("REALTIME_CANARY_PERCENT", 100),
  MODEL_GUARDRAILS_MAX_HISTORY_ITEMS: optionalInt("MODEL_GUARDRAILS_MAX_HISTORY_ITEMS", 240),
  MODEL_GUARDRAILS_MAX_TOTAL_TEXT_CHARS: optionalInt("MODEL_GUARDRAILS_MAX_TOTAL_TEXT_CHARS", 60_000),
  MODEL_GUARDRAILS_MAX_ITEM_TEXT_CHARS: optionalInt("MODEL_GUARDRAILS_MAX_ITEM_TEXT_CHARS", 4_000),
  AGENT_APPROVAL_TTL_MS: optionalInt("AGENT_APPROVAL_TTL_MS", 120_000),
  AGENT_MAX_BASE_PROMPT_CHARS: optionalInt("AGENT_MAX_BASE_PROMPT_CHARS", 260),
  AGENT_MAX_OPENING_HOURS_CHARS: optionalInt("AGENT_MAX_OPENING_HOURS_CHARS", 180),
  AGENT_MAX_KB_PROMPT_PASSAGES: optionalInt("AGENT_MAX_KB_PROMPT_PASSAGES", 2),
  AGENT_MAX_KB_PROMPT_CHARS: optionalInt("AGENT_MAX_KB_PROMPT_CHARS", 220),
  AGENT_MAX_SLOT_PROMPT_FIELDS: optionalInt("AGENT_MAX_SLOT_PROMPT_FIELDS", 6),
  AGENT_MAX_SLOT_PROMPT_CHARS: optionalInt("AGENT_MAX_SLOT_PROMPT_CHARS", 42),

  // STT (Deepgram)
  STT_PROVIDER: optional("STT_PROVIDER", "mock") as "deepgram" | "mock",
  STT_API_KEY: optional("STT_API_KEY", ""),
  STT_MODEL: optional("STT_MODEL", "nova-2-phonecall"),
  LEGACY_FINAL_DEBOUNCE_MS: optionalInt("LEGACY_FINAL_DEBOUNCE_MS", 400),
  LEGACY_STT_ENDPOINTING_MS: optionalInt("LEGACY_STT_ENDPOINTING_MS", 600),
  LEGACY_STT_UTTERANCE_END_MS: optionalInt("LEGACY_STT_UTTERANCE_END_MS", 1500),

  // TTS (ElevenLabs)
  ELEVEN_API_KEY: optional("ELEVEN_API_KEY", ""),
  ELEVEN_VOICE_ID: optional("ELEVEN_VOICE_ID", ""),
  ELEVEN_MODEL_ID: optional("ELEVEN_MODEL_ID", ""),
  LEGACY_TTS_MIN_CHUNK_CHARS: optionalInt("LEGACY_TTS_MIN_CHUNK_CHARS", 28),
  LEGACY_TTS_MAX_CHUNK_CHARS: optionalInt("LEGACY_TTS_MAX_CHUNK_CHARS", 180),
  LEGACY_TTS_MAX_CHUNK_WAIT_MS: optionalInt("LEGACY_TTS_MAX_CHUNK_WAIT_MS", 300),
  LEGACY_OUTPUT_MODERATION_TIMEOUT_MS: optionalInt("LEGACY_OUTPUT_MODERATION_TIMEOUT_MS", 250),
  LEGACY_KB_CACHE_TTL_MS: optionalInt("LEGACY_KB_CACHE_TTL_MS", 60_000),
  LEGACY_KB_FETCH_TIMEOUT_MS: optionalInt("LEGACY_KB_FETCH_TIMEOUT_MS", 450),
  LEGACY_MAX_KB_PASSAGES: optionalInt("LEGACY_MAX_KB_PASSAGES", 4),
  LEGACY_MAX_KB_PASSAGE_CHARS: optionalInt("LEGACY_MAX_KB_PASSAGE_CHARS", 360),
  LEGACY_MAX_RECENT_USER_TURNS_FOR_RUN: optionalInt("LEGACY_MAX_RECENT_USER_TURNS_FOR_RUN", 3),
  LEGACY_MAX_RUN_WINDOW_ITEMS: optionalInt("LEGACY_MAX_RUN_WINDOW_ITEMS", 36),
  LEGACY_LOG_TEXT_PREVIEW_CHARS: optionalInt("LEGACY_LOG_TEXT_PREVIEW_CHARS", 220),
  LEGACY_INPUT_GUARDRAIL_LONG_INPUT_CHARS: optionalInt("LEGACY_INPUT_GUARDRAIL_LONG_INPUT_CHARS", 260),
  LEGACY_SILENCE_PROMPT_MS: optionalInt("LEGACY_SILENCE_PROMPT_MS", 8_000),
  LEGACY_MAX_SILENCE_PROMPTS: optionalInt("LEGACY_MAX_SILENCE_PROMPTS", 2),
  LEGACY_SILENCE_CHECK_INTERVAL_MS: optionalInt("LEGACY_SILENCE_CHECK_INTERVAL_MS", 2_000),
  LEGACY_CALL_END_POLL_INTERVAL_MS: optionalInt("LEGACY_CALL_END_POLL_INTERVAL_MS", 200),
  LEGACY_DEFAULT_MAX_CALL_DURATION_SEC: optionalInt("LEGACY_DEFAULT_MAX_CALL_DURATION_SEC", 1800),
  GUARDRAILS_MAX_WARNINGS_BEFORE_TRANSFER: optionalInt("GUARDRAILS_MAX_WARNINGS_BEFORE_TRANSFER", 2),
  GUARDRAILS_MODERATION_MODEL: optional("GUARDRAILS_MODERATION_MODEL", "omni-moderation-latest"),
  GUARDRAILS_MODERATION_COOLDOWN_MS: optionalInt("GUARDRAILS_MODERATION_COOLDOWN_MS", 300_000),
  REALTIME_KB_FETCH_TIMEOUT_MS: optionalInt("REALTIME_KB_FETCH_TIMEOUT_MS", 350),
  REALTIME_PERSIST_THROTTLE_MS: optionalInt("REALTIME_PERSIST_THROTTLE_MS", 250),
  REALTIME_EMPTY_RESPONSE_GRACE_MS: optionalInt("REALTIME_EMPTY_RESPONSE_GRACE_MS", 1200),
  REALTIME_TTS_MIN_CHUNK_CHARS: optionalInt("REALTIME_TTS_MIN_CHUNK_CHARS", 28),
  REALTIME_TTS_MAX_CHUNK_CHARS: optionalInt("REALTIME_TTS_MAX_CHUNK_CHARS", 180),
  REALTIME_TTS_MAX_CHUNK_WAIT_MS: optionalInt("REALTIME_TTS_MAX_CHUNK_WAIT_MS", 300),
  REALTIME_OUTPUT_MODERATION_TIMEOUT_MS: optionalInt("REALTIME_OUTPUT_MODERATION_TIMEOUT_MS", 250),

  // Redis
  REDIS_ENABLED: optionalBool("REDIS_ENABLED", false),
  REDIS_URL: optional("REDIS_URL", "redis://localhost:6379"),
  /** `memory` or `redis` — match platform-api / jobs for shared `ConfigChanged` / ingest events. */
  EVENT_BUS_IMPL: optional("EVENT_BUS_IMPL", "memory") as "memory" | "redis",

  // Kafka
  KAFKA_ENABLED: optionalBool("KAFKA_ENABLED", false),
  KAFKA_BROKERS: optional("KAFKA_BROKERS", "localhost:9092"),
  KAFKA_CLIENT_ID: optional("KAFKA_CLIENT_ID", "realtime-core"),

  // RTP Bridge
  RTP_BRIDGE_URL: optional("RTP_BRIDGE_URL", ""),
  RTP_BRIDGE_CONNECT_TIMEOUT_MS: optionalInt("RTP_BRIDGE_CONNECT_TIMEOUT_MS", 5_000),

  // Platform API (internal)
  PLATFORM_API_URL: optional("PLATFORM_API_URL", "http://localhost:3001"),
  /** Shared bearer token for platform-api protected internal routes. */
  INTERNAL_SERVICE_TOKEN: optional("INTERNAL_SERVICE_TOKEN", ""),
  /** First snapshot organization — must match SQL seeds (e.g. org_localdemo). */
  REALTIME_BOOTSTRAP_ORG_ID: optional("REALTIME_BOOTSTRAP_ORG_ID", "org_localdemo"),

  // Twilio
  TWILIO_ACCOUNT_SID: optional("TWILIO_ACCOUNT_SID", ""),
  TWILIO_AUTH_TOKEN: optional("TWILIO_AUTH_TOKEN", ""),

  // Runtime
  CONCURRENCY_LIMIT: optionalInt("CONCURRENCY_LIMIT", 20),
  METRICS_PORT: optionalInt("METRICS_PORT", 9100),
  WEBHOOK_LISTEN_PORT: optionalInt("WEBHOOK_LISTEN_PORT", 3002),
  LOG_LEVEL: optional("LOG_LEVEL", "info"),
  NODE_ENV: optional("NODE_ENV", "development"),
} as const;

// ─── Conditional validation ───

if (env.REDIS_ENABLED && !env.REDIS_URL) {
  console.error("[env] REDIS_ENABLED=true but REDIS_URL is not set");
  process.exit(1);
}

if (env.EVENT_BUS_IMPL === "redis" && !env.REDIS_ENABLED) {
  console.error("[env] EVENT_BUS_IMPL=redis requires REDIS_ENABLED=true and REDIS_URL");
  process.exit(1);
}

if (env.KAFKA_ENABLED && !env.KAFKA_BROKERS) {
  console.error("[env] KAFKA_ENABLED=true but KAFKA_BROKERS is not set");
  process.exit(1);
}

if (!env.LLM_MODEL.trim()) {
  console.error("[env] Missing required environment variable: LLM_MODEL");
  process.exit(1);
}
