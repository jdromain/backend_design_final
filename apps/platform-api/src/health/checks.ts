import { createLogger } from "@rezovo/logging";
import { ping } from "../persistence/dbClient";
import { getRedisClient, isRedisEnabled } from "../redis/client";
import { env } from "../env";

const logger = createLogger({ service: "platform-api", module: "health" });

export type HealthStatus = "ok" | "degraded" | "error" | "disabled";

export interface ServiceHealth {
  name: string;
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

export interface SystemHealthData {
  overall: "operational" | "degraded" | "outage";
  telephony: ServiceHealth[];
  stt: ServiceHealth[];
  tts: ServiceHealth[];
  llm: ServiceHealth[];
  tools: ServiceHealth[];
  integrations: ServiceHealth[];
}

const TIMEOUT_MS = 5000;

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

export async function checkDatabase(): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    const ok = await withTimeout(ping(), TIMEOUT_MS, "Database");
    const latencyMs = Date.now() - start;
    if (ok) {
      return { name: "PostgreSQL", status: "ok", latencyMs, message: "PostgreSQL connection healthy" };
    }
    return { name: "PostgreSQL", status: "error", latencyMs, message: "Database ping returned false" };
  } catch (err) {
    return { name: "PostgreSQL", status: "error", latencyMs: Date.now() - start, message: (err as Error).message };
  }
}

export async function checkRedis(): Promise<ServiceHealth> {
  if (!isRedisEnabled) {
    return { name: "Redis", status: "disabled", message: "Redis not enabled" };
  }
  const start = Date.now();
  try {
    const redis = getRedisClient();
    await withTimeout(redis.ping(), TIMEOUT_MS, "Redis");
    return { name: "Redis", status: "ok", latencyMs: Date.now() - start, message: "Redis connection healthy" };
  } catch (err) {
    return { name: "Redis", status: "error", latencyMs: Date.now() - start, message: (err as Error).message };
  }
}

export async function checkKafka(): Promise<ServiceHealth> {
  if (!env.KAFKA_ENABLED) {
    return { name: "Kafka", status: "disabled", message: "Kafka not enabled" };
  }
  const start = Date.now();
  try {
    const brokers = env.KAFKA_BROKERS.split(",").filter(Boolean);
    if (brokers.length === 0) {
      return { name: "Kafka", status: "error", message: "KAFKA_BROKERS not configured" };
    }
    return { name: "Kafka", status: "ok", latencyMs: Date.now() - start, message: "Kafka configured", details: { brokers } };
  } catch (err) {
    return { name: "Kafka", status: "error", latencyMs: Date.now() - start, message: (err as Error).message };
  }
}

export async function checkOpenAI(): Promise<ServiceHealth> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    return { name: "OpenAI", status: "error", message: "OPENAI_API_KEY not configured" };
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
      return { name: "OpenAI", status: "ok", latencyMs, message: "OpenAI API accessible" };
    }
    return { name: "OpenAI", status: "error", latencyMs, message: `OpenAI API returned ${response.status}` };
  } catch (err) {
    return { name: "OpenAI", status: "error", latencyMs: Date.now() - start, message: (err as Error).message };
  }
}

export async function checkSTT(): Promise<ServiceHealth> {
  const apiKey = env.STT_API_KEY;
  if (!apiKey) {
    return { name: "Deepgram STT", status: "disabled", message: "STT_API_KEY not configured" };
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
      return { name: "Deepgram STT", status: "ok", latencyMs, message: "Deepgram STT API accessible" };
    }
    return { name: "Deepgram STT", status: "error", latencyMs, message: `Deepgram API returned ${response.status}` };
  } catch (err) {
    return { name: "Deepgram STT", status: "error", latencyMs: Date.now() - start, message: (err as Error).message };
  }
}

export async function checkTTS(): Promise<ServiceHealth> {
  const apiKey = env.ELEVEN_API_KEY;
  if (!apiKey) {
    return { name: "ElevenLabs TTS", status: "disabled", message: "ELEVEN_API_KEY not configured" };
  }
  const start = Date.now();
  try {
    const response = await withTimeout(
      fetch("https://api.elevenlabs.io/v2/voices?page_size=1", {
        method: "GET",
        headers: { "xi-api-key": apiKey },
      }),
      TIMEOUT_MS,
      "ElevenLabs"
    );
    const latencyMs = Date.now() - start;
    if (response.ok) {
      return { name: "ElevenLabs TTS", status: "ok", latencyMs, message: "ElevenLabs TTS API accessible" };
    }
    if (response.status === 401) {
      // Distinguish a scoped key (missing_permissions) from a truly invalid key.
      // A scoped key that lacks voices_read still authenticates correctly for TTS synthesis.
      let body: { detail?: { status?: string; message?: string } } = {};
      try { body = await response.json(); } catch { /* ignore */ }
      const detail = body?.detail;
      if (detail?.status === "missing_permissions") {
        return {
          name: "ElevenLabs TTS",
          status: "ok",
          latencyMs,
          message: `ElevenLabs key authenticated (scoped — ${detail.message ?? "voices_read not granted"})`,
        };
      }
      return { name: "ElevenLabs TTS", status: "error", latencyMs, message: "ElevenLabs API key invalid (401)" };
    }
    return { name: "ElevenLabs TTS", status: "error", latencyMs, message: `ElevenLabs API returned ${response.status}` };
  } catch (err) {
    return { name: "ElevenLabs TTS", status: "error", latencyMs: Date.now() - start, message: (err as Error).message };
  }
}

export async function checkTwilio(): Promise<ServiceHealth> {
  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authToken = env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    return { name: "Twilio", status: "disabled", message: "Twilio credentials not configured" };
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
      return { name: "Twilio", status: "ok", latencyMs, message: "Twilio API accessible" };
    }
    return { name: "Twilio", status: "error", latencyMs, message: `Twilio API returned ${response.status}` };
  } catch (err) {
    return { name: "Twilio", status: "error", latencyMs: Date.now() - start, message: (err as Error).message };
  }
}

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
    database: checks[0].status === "fulfilled" ? checks[0].value : { name: "PostgreSQL", status: "error", message: "Check failed" },
    redis: checks[1].status === "fulfilled" ? checks[1].value : { name: "Redis", status: "error", message: "Check failed" },
    kafka: checks[2].status === "fulfilled" ? checks[2].value : { name: "Kafka", status: "error", message: "Check failed" },
    openai: checks[3].status === "fulfilled" ? checks[3].value : { name: "OpenAI", status: "error", message: "Check failed" },
    stt: checks[4].status === "fulfilled" ? checks[4].value : { name: "Deepgram STT", status: "error", message: "Check failed" },
    tts: checks[5].status === "fulfilled" ? checks[5].value : { name: "ElevenLabs TTS", status: "error", message: "Check failed" },
    twilio: checks[6].status === "fulfilled" ? checks[6].value : { name: "Twilio", status: "error", message: "Check failed" },
  };

  const statuses = Object.values(services).map((s) => s.status);
  let overall: HealthStatus = "ok";
  if (statuses.some((s) => s === "error")) {
    const criticalServices = ["database", "openai", "stt", "tts"];
    const criticalErrors = criticalServices.filter((name) => services[name].status === "error");
    if (criticalErrors.length > 0) {
      overall = "degraded";
    }
  }

  return { overall, services, timestamp: new Date().toISOString() };
}

export async function getSystemHealthData(): Promise<SystemHealthData> {
  const checks = await Promise.allSettled([
    checkTwilio(),
    checkSTT(),
    checkTTS(),
    checkOpenAI(),
    checkDatabase(),
    checkRedis(),
    checkKafka(),
  ]);

  const get = (idx: number) =>
    checks[idx].status === "fulfilled" ? checks[idx].value : { name: "unknown", status: "error" as HealthStatus, message: "Check failed" };

  const allStatuses = checks.map((c) => (c.status === "fulfilled" ? c.value.status : "error"));
  let overall: "operational" | "degraded" | "outage" = "operational";
  if (allStatuses.includes("error")) {
    overall = allStatuses.filter((s) => s === "error").length >= 3 ? "outage" : "degraded";
  }

  return {
    overall,
    telephony: [get(0)],
    stt: [get(1)],
    tts: [get(2)],
    llm: [get(3)],
    tools: [get(4)],
    integrations: [get(5), get(6)],
  };
}
