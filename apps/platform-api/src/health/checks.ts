import { createLogger } from "@rezovo/logging";
import { ping } from "../persistence/dbClient";
import { getRedisClient, isRedisEnabled } from "../redis/client";
import { env } from "../env";

const logger = createLogger({ service: "platform-api", module: "health" });

export type HealthStatus = "ok" | "degraded" | "error" | "disabled";

export interface ServiceHealth {
  status: HealthStatus;
  latencyMs?: number;
  message?: string;
  details?: Record<string, unknown>;
}

export interface HealthCheckResult {
  overall: HealthStatus;
  services: Record<string, ServiceHealth>;
  timestamp: string;
}

const TIMEOUT_MS = 5000;

/**
 * Timeout wrapper for health checks
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  name: string
): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`${name} timeout after ${timeoutMs}ms`)), timeoutMs)
  );
  return Promise.race([promise, timeout]);
}

/**
 * Check PostgreSQL database connectivity
 */
export async function checkDatabase(): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    const ok = await withTimeout(ping(), TIMEOUT_MS, "Database");
    const latencyMs = Date.now() - start;
    if (ok) {
      return { status: "ok", latencyMs, message: "PostgreSQL connection healthy" };
    }
    return { status: "error", latencyMs, message: "Database ping returned false" };
  } catch (err) {
    return {
      status: "error",
      latencyMs: Date.now() - start,
      message: (err as Error).message,
    };
  }
}

/**
 * Check Redis connectivity
 */
export async function checkRedis(): Promise<ServiceHealth> {
  if (!isRedisEnabled) {
    return { status: "disabled", message: "Redis not enabled" };
  }

  const start = Date.now();
  try {
    const redis = getRedisClient();
    await withTimeout(redis.ping(), TIMEOUT_MS, "Redis");
    const latencyMs = Date.now() - start;

    return {
      status: "ok",
      latencyMs,
      message: "Redis connection healthy",
    };
  } catch (err) {
    return {
      status: "error",
      latencyMs: Date.now() - start,
      message: (err as Error).message,
    };
  }
}

/**
 * Check Kafka/event bus connectivity
 */
export async function checkKafka(): Promise<ServiceHealth> {
  if (!env.KAFKA_ENABLED) {
    return { status: "disabled", message: "Kafka not enabled" };
  }

  const start = Date.now();
  try {
    const brokers = env.KAFKA_BROKERS.split(",").filter(Boolean);
    if (brokers.length === 0) {
      return { status: "error", message: "KAFKA_BROKERS not configured" };
    }
    const latencyMs = Date.now() - start;
    return {
      status: "ok",
      latencyMs,
      message: "Kafka configured",
      details: { brokers },
    };
  } catch (err) {
    return {
      status: "error",
      latencyMs: Date.now() - start,
      message: (err as Error).message,
    };
  }
}

/**
 * Check OpenAI API connectivity
 */
export async function checkOpenAI(): Promise<ServiceHealth> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    return { status: "error", message: "OPENAI_API_KEY not configured" };
  }

  const start = Date.now();
  try {
    const response = await withTimeout(
      fetch("https://api.openai.com/v1/models", {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      }),
      TIMEOUT_MS,
      "OpenAI"
    );
    const latencyMs = Date.now() - start;
    if (response.ok) {
      return { status: "ok", latencyMs, message: "OpenAI API accessible" };
    }
    return { status: "error", latencyMs, message: `OpenAI API returned ${response.status}: ${response.statusText}` };
  } catch (err) {
    return { status: "error", latencyMs: Date.now() - start, message: (err as Error).message };
  }
}

/**
 * Check STT (Deepgram) API
 */
export async function checkSTT(): Promise<ServiceHealth> {
  const apiKey = env.STT_API_KEY;
  if (!apiKey) {
    return { status: "disabled", message: "STT_API_KEY not configured" };
  }

  const start = Date.now();
  try {
    const response = await withTimeout(
      fetch("https://api.deepgram.com/v1/projects", {
        method: "GET",
        headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
      }),
      TIMEOUT_MS,
      "Deepgram"
    );
    const latencyMs = Date.now() - start;
    if (response.ok) {
      return { status: "ok", latencyMs, message: "Deepgram STT API accessible" };
    }
    return { status: "error", latencyMs, message: `Deepgram API returned ${response.status}: ${response.statusText}` };
  } catch (err) {
    return { status: "error", latencyMs: Date.now() - start, message: (err as Error).message };
  }
}

/**
 * Check TTS (ElevenLabs) API
 */
export async function checkTTS(): Promise<ServiceHealth> {
  const apiKey = env.ELEVEN_API_KEY;
  if (!apiKey) {
    return { status: "disabled", message: "ELEVEN_API_KEY not configured" };
  }

  const start = Date.now();
  try {
    const response = await withTimeout(
      fetch("https://api.elevenlabs.io/v1/voices", {
        method: "GET",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      }),
      TIMEOUT_MS,
      "ElevenLabs"
    );
    const latencyMs = Date.now() - start;
    if (response.ok) {
      return { status: "ok", latencyMs, message: "ElevenLabs TTS API accessible" };
    }
    return { status: "error", latencyMs, message: `ElevenLabs API returned ${response.status}: ${response.statusText}` };
  } catch (err) {
    return { status: "error", latencyMs: Date.now() - start, message: (err as Error).message };
  }
}

/**
 * Check Twilio API
 */
export async function checkTwilio(): Promise<ServiceHealth> {
  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authToken = env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    return { status: "disabled", message: "Twilio credentials not configured" };
  }

  const start = Date.now();
  try {
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const response = await withTimeout(
      fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`, {
        method: "GET",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      }),
      TIMEOUT_MS,
      "Twilio"
    );
    const latencyMs = Date.now() - start;
    if (response.ok) {
      const data = (await response.json()) as { status?: string };
      return { status: "ok", latencyMs, message: "Twilio API accessible", details: { accountStatus: data.status } };
    }
    return { status: "error", latencyMs, message: `Twilio API returned ${response.status}: ${response.statusText}` };
  } catch (err) {
    return { status: "error", latencyMs: Date.now() - start, message: (err as Error).message };
  }
}

/**
 * Run all health checks in parallel
 */
export async function runHealthChecks(): Promise<HealthCheckResult> {
  logger.info("running health checks");

  const checks = await Promise.allSettled([
    checkDatabase(),
    checkRedis(),
    checkKafka(),
    checkOpenAI(),
    checkSTT(),
    checkTTS(),
    checkTwilio(),
  ]);

  const services: Record<string, ServiceHealth> = {
    database: checks[0].status === "fulfilled" ? checks[0].value : { status: "error", message: "Check failed" },
    redis: checks[1].status === "fulfilled" ? checks[1].value : { status: "error", message: "Check failed" },
    kafka: checks[2].status === "fulfilled" ? checks[2].value : { status: "error", message: "Check failed" },
    openai: checks[3].status === "fulfilled" ? checks[3].value : { status: "error", message: "Check failed" },
    stt: checks[4].status === "fulfilled" ? checks[4].value : { status: "error", message: "Check failed" },
    tts: checks[5].status === "fulfilled" ? checks[5].value : { status: "error", message: "Check failed" },
    twilio: checks[6].status === "fulfilled" ? checks[6].value : { status: "error", message: "Check failed" },
  };

  const statuses = Object.values(services).map(s => s.status);
  let overall: HealthStatus = "ok";
  if (statuses.some(s => s === "error")) {
    const criticalServices = ["database", "openai", "stt", "tts"];
    const criticalErrors = criticalServices.filter(name => services[name].status === "error");
    if (criticalErrors.length > 0) {
      overall = "degraded";
    }
  }

  logger.info("health checks completed", { overall, services: Object.keys(services) });

  return { overall, services, timestamp: new Date().toISOString() };
}
