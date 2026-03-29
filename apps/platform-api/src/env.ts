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

export const env = {
  PORT: parseInt(optional("PORT", "3001"), 10),
  NODE_ENV: optional("NODE_ENV", "development") as "development" | "production" | "test",

  DATABASE_URL: optional("DATABASE_URL", "postgresql://rezovo:rezovo_local@localhost:5432/rezovo"),
  DB_POOL_MAX: parseInt(optional("DB_POOL_MAX", "5"), 10),
  DB_SSL: optionalBool("DB_SSL", false),

  // Clerk
  CLERK_AUTH_ENABLED: optionalBool("CLERK_AUTH_ENABLED", false),
  CLERK_SECRET_KEY: optional("CLERK_SECRET_KEY", ""),
  CLERK_PUBLISHABLE_KEY: optional("CLERK_PUBLISHABLE_KEY", ""),
  CLERK_JWT_AUDIENCE: optional("CLERK_JWT_AUDIENCE", ""),
  CLERK_JWT_ISSUER: optional("CLERK_JWT_ISSUER", ""),
  CLERK_JWT_PUBLIC_KEY: optional("CLERK_JWT_PUBLIC_KEY", ""),
  CLERK_DEFAULT_TENANT_ID: optional("CLERK_DEFAULT_TENANT_ID", "test-tenant"),
  REZOVO_CLERK_SYNC_SECRET: optional("REZOVO_CLERK_SYNC_SECRET", ""),

  // CORS
  CORS_ORIGINS: optional("CORS_ORIGINS", ""),

  // Redis
  REDIS_ENABLED: optionalBool("REDIS_ENABLED", false),
  REDIS_URL: optional("REDIS_URL", "redis://localhost:6379"),

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

if (env.KAFKA_ENABLED && !env.KAFKA_BROKERS) {
  console.error("[env] KAFKA_ENABLED=true but KAFKA_BROKERS is not set");
  process.exit(1);
}
