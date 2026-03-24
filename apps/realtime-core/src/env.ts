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
  LLM_MODEL: optional("LLM_MODEL", "gpt-4o-mini"),
  LLM_TEMPERATURE: optionalNum("LLM_TEMPERATURE", 0.7),
  LLM_MAX_TOKENS: optionalInt("LLM_MAX_TOKENS", 500),

  // STT (Deepgram)
  STT_PROVIDER: optional("STT_PROVIDER", "mock") as "deepgram" | "mock",
  STT_API_KEY: optional("STT_API_KEY", ""),
  STT_MODEL: optional("STT_MODEL", "nova-2-phonecall"),

  // TTS (ElevenLabs)
  ELEVEN_API_KEY: optional("ELEVEN_API_KEY", ""),
  ELEVEN_VOICE_ID: optional("ELEVEN_VOICE_ID", ""),

  // Redis
  REDIS_ENABLED: optionalBool("REDIS_ENABLED", false),
  REDIS_URL: optional("REDIS_URL", "redis://localhost:6379"),

  // Kafka
  KAFKA_ENABLED: optionalBool("KAFKA_ENABLED", false),
  KAFKA_BROKERS: optional("KAFKA_BROKERS", "localhost:9092"),
  KAFKA_CLIENT_ID: optional("KAFKA_CLIENT_ID", "realtime-core"),

  // RTP Bridge
  RTP_BRIDGE_URL: optional("RTP_BRIDGE_URL", ""),

  // Platform API (internal)
  PLATFORM_API_URL: optional("PLATFORM_API_URL", "http://localhost:3001"),

  // Twilio
  TWILIO_ACCOUNT_SID: optional("TWILIO_ACCOUNT_SID", ""),
  TWILIO_AUTH_TOKEN: optional("TWILIO_AUTH_TOKEN", ""),

  // Runtime
  CONCURRENCY_LIMIT: optionalInt("CONCURRENCY_LIMIT", 20),
  METRICS_PORT: optionalInt("METRICS_PORT", 9100),
  LOG_LEVEL: optional("LOG_LEVEL", "info"),
  NODE_ENV: optional("NODE_ENV", "development"),
} as const;

// ─── Conditional validation ───

if (env.REDIS_ENABLED && !env.REDIS_URL) {
  console.error("[env] REDIS_ENABLED=true but REDIS_URL is not set");
  process.exit(1);
}

if (env.KAFKA_ENABLED && !env.KAFKA_BROKERS) {
  console.error("[env] KAFKA_ENABLED=true but KAFKA_BROKERS is not set");
  process.exit(1);
}
