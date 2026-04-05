import { resolve } from "path";
import { config } from "dotenv";

const envPath = resolve(__dirname, "../.env");
const result = config({ path: envPath });

if (result.error && process.env.NODE_ENV !== "production") {
  if (process.env.VITEST === "true") {
    console.warn(
      `[env] Vitest: no .env at ${envPath} (${result.error.message}) — using process.env only`
    );
  } else {
    console.error(`[env] Failed to load .env from ${envPath}: ${result.error.message}`);
    console.error("[env] Create apps/platform-api/.env -- see apps/platform-api/.env.example");
    process.exit(1);
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[env] Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function optionalBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v === "true";
}

function resolveClerkAuthEnabled(): boolean {
  const mode = (process.env.AUTH_MODE || "").trim().toLowerCase();
  if (mode === "clerk") {
    if (process.env.CLERK_AUTH_ENABLED === "false") {
      console.error("[env] AUTH_MODE=clerk conflicts with CLERK_AUTH_ENABLED=false");
      process.exit(1);
    }
    return true;
  }
  if (mode === "dev_jwt") {
    if (process.env.CLERK_AUTH_ENABLED === "true") {
      console.error("[env] AUTH_MODE=dev_jwt conflicts with CLERK_AUTH_ENABLED=true");
      process.exit(1);
    }
    return false;
  }
  if (mode !== "") {
    console.error(`[env] Invalid AUTH_MODE="${process.env.AUTH_MODE}" (use dev_jwt or clerk)`);
    process.exit(1);
  }
  return optionalBool("CLERK_AUTH_ENABLED", false);
}

const clerkAuthEnabledResolved = resolveClerkAuthEnabled();

export const env = {
  PORT: parseInt(optional("PORT", "3001"), 10),
  NODE_ENV: optional("NODE_ENV", "development") as "development" | "production" | "test",
  /** When true, query `tenantId` may override JWT tenant even in production (use sparingly). */
  ALLOW_DEV_TENANT_QUERY_OVERRIDE: optionalBool("ALLOW_DEV_TENANT_QUERY_OVERRIDE", false),

  /**
   * Optional single switch: `dev_jwt` | `clerk`. When set, must agree with `CLERK_AUTH_ENABLED`.
   * If unset, `CLERK_AUTH_ENABLED` alone controls Clerk vs dev JWT.
   */
  AUTH_MODE: optional("AUTH_MODE", "") as "" | "dev_jwt" | "clerk",
  /** Derived from `AUTH_MODE` or `CLERK_AUTH_ENABLED`. */
  AUTH_MODE_EFFECTIVE: clerkAuthEnabledResolved ? ("clerk" as const) : ("dev_jwt" as const),

  DATABASE_URL: optional("DATABASE_URL", "postgresql://rezovo:rezovo_local@localhost:5432/rezovo"),
  DB_POOL_MAX: parseInt(optional("DB_POOL_MAX", "5"), 10),
  DB_SSL: optionalBool("DB_SSL", false),

  // Clerk
  CLERK_AUTH_ENABLED: clerkAuthEnabledResolved,
  CLERK_SECRET_KEY: optional("CLERK_SECRET_KEY", ""),
  CLERK_PUBLISHABLE_KEY: optional("CLERK_PUBLISHABLE_KEY", ""),
  CLERK_JWT_AUDIENCE: optional("CLERK_JWT_AUDIENCE", ""),
  CLERK_JWT_ISSUER: optional("CLERK_JWT_ISSUER", ""),
  CLERK_JWT_PUBLIC_KEY: optional("CLERK_JWT_PUBLIC_KEY", ""),
  CLERK_DEFAULT_TENANT_ID: optional("CLERK_DEFAULT_TENANT_ID", "test-tenant"),
  /** Svix signing secret from Clerk Dashboard → Webhooks → Endpoint → Signing Secret */
  CLERK_WEBHOOK_SECRET: optional("CLERK_WEBHOOK_SECRET", ""),
  /**
   * When true (default), first API request with a valid Clerk JWT but no DB user triggers
   * a Clerk API lookup (org membership → tenant) and upserts `users`. Webhook remains canonical for normal sync.
   */
  CLERK_BOOTSTRAP_ON_AUTH: optionalBool("CLERK_BOOTSTRAP_ON_AUTH", true),

  // CORS
  CORS_ORIGINS: optional("CORS_ORIGINS", ""),

  // Redis
  REDIS_ENABLED: optionalBool("REDIS_ENABLED", false),
  REDIS_URL: optional("REDIS_URL", "redis://localhost:6379"),
  /** `memory` (default) or `redis` — use `redis` for cross-process events (requires `REDIS_ENABLED=true`). */
  EVENT_BUS_IMPL: optional("EVENT_BUS_IMPL", "memory") as "memory" | "redis",

  // Kafka
  KAFKA_ENABLED: optionalBool("KAFKA_ENABLED", false),
  KAFKA_BROKERS: optional("KAFKA_BROKERS", "localhost:9092"),

  // API Keys
  OPENAI_API_KEY: optional("OPENAI_API_KEY", ""),
  STT_API_KEY: optional("STT_API_KEY", ""),
  ELEVEN_API_KEY: optional("ELEVEN_API_KEY", ""),
  ELEVEN_VOICE_ID: optional("ELEVEN_VOICE_ID", ""),

  // Auth
  JWT_SECRET: optional("JWT_SECRET", "dev-secret-change-me"),

  // Twilio
  TWILIO_ACCOUNT_SID: optional("TWILIO_ACCOUNT_SID", ""),
  TWILIO_AUTH_TOKEN: optional("TWILIO_AUTH_TOKEN", ""),

  // Internal service URLs
  RTP_BRIDGE_PUBLIC_URL: optional("RTP_BRIDGE_PUBLIC_URL", ""),
  REALTIME_CORE_URL: optional("REALTIME_CORE_URL", "http://localhost:3002"),
  PLATFORM_API_URL: optional("PLATFORM_API_URL", "http://localhost:3001"),

  // Calendly
  CALENDLY_ACCESS_TOKEN: optional("CALENDLY_ACCESS_TOKEN", ""),
  CALENDLY_EVENT_TYPE_URI: optional("CALENDLY_EVENT_TYPE_URI", ""),
  CALENDLY_TIMEZONE: optional("CALENDLY_TIMEZONE", "America/New_York"),
} as const;

if (env.REDIS_ENABLED && !env.REDIS_URL) {
  console.error("[env] REDIS_ENABLED=true but REDIS_URL is not set");
  process.exit(1);
}

if (env.EVENT_BUS_IMPL === "redis" && !env.REDIS_ENABLED) {
  console.error("[env] EVENT_BUS_IMPL=redis requires REDIS_ENABLED=true and a reachable REDIS_URL");
  process.exit(1);
}

if (env.KAFKA_ENABLED && !env.KAFKA_BROKERS) {
  console.error("[env] KAFKA_ENABLED=true but KAFKA_BROKERS is not set");
  process.exit(1);
}

/** Clerk mode: Bearer tokens are Clerk session JWTs; dev JWT and ?tenantId override are disabled for data reads. */
export function assertClerkEnvIfEnabled(): void {
  if (!env.CLERK_AUTH_ENABLED) return;
  if (process.env.VITEST === "true") return;

  const missing: string[] = [];
  if (!env.CLERK_SECRET_KEY?.trim()) missing.push("CLERK_SECRET_KEY");
  if (!env.CLERK_JWT_PUBLIC_KEY?.trim()) missing.push("CLERK_JWT_PUBLIC_KEY");
  if (!env.CLERK_WEBHOOK_SECRET?.trim()) missing.push("CLERK_WEBHOOK_SECRET");

  if (missing.length > 0) {
    console.error(
      `[env] CLERK_AUTH_ENABLED=true but required Clerk variables are missing: ${missing.join(", ")}. ` +
        "See docs/AUTH_CLERK.md"
    );
    process.exit(1);
  }
}

assertClerkEnvIfEnabled();
