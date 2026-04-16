// env MUST be the first import — loads .env before any other module reads process.env
import "./env";

import { createLogger } from "@rezovo/logging";
import { createInMemoryEventBus, createRedisEventBus } from "@rezovo/event-bus";
import { env } from "./env";
import { ConfigChangedPayload, TypedEventEnvelope } from "@rezovo/core-types";
import { setDefaultOpenAIKey } from "@openai/agents";

import { ConfigCache, makeDefaultSnapshot } from "./config-cache/cache";
import { fetchConfigSnapshot } from "./config-cache/fetcher";
import { EventPublisher } from "./events/eventPublisher";
import { BillingQuotaClient } from "./billingClient";
import { RtpBridgeClient } from "./media/rtpBridgeClient";
import { CallController } from "./telephony/callController";
import { startWebhookServer, WEBHOOK_LISTEN_PORT } from "./webhookServer";

const logger = createLogger({ service: "realtime-core", module: "bootstrap" });

function printEnvDiagnostics(): void {
  logger.info("─── realtime-core startup diagnostics ───");

  // LLM
  logger.info("LLM config", {
    provider: env.LLM_PROVIDER,
    model: env.LLM_MODEL,
    maxTokens: env.LLM_MAX_TOKENS,
    conversationEngine: env.CONVERSATION_ENGINE,
    OPENAI_API_KEY: env.OPENAI_API_KEY ? "***set***" : "(NOT SET — agent calls will fail)",
  });

  // STT
  logger.info("STT config", {
    provider: env.STT_PROVIDER,
    model: env.STT_MODEL,
    endpointingMs: env.LEGACY_STT_ENDPOINTING_MS,
    utteranceEndMs: env.LEGACY_STT_UTTERANCE_END_MS,
    finalDebounceMs: env.LEGACY_FINAL_DEBOUNCE_MS,
    STT_API_KEY: env.STT_API_KEY ? "***set***" : "(NOT SET — transcription will fail)",
  });
  if (env.STT_PROVIDER === "mock") {
    logger.warn("STT_PROVIDER=mock — no real transcription, set STT_PROVIDER=deepgram for live calls");
  }

  // TTS
  logger.info("TTS config", {
    ELEVEN_API_KEY: env.ELEVEN_API_KEY ? "***set***" : "(NOT SET — voice synthesis will fail)",
    ELEVEN_VOICE_ID: env.ELEVEN_VOICE_ID || "(NOT SET — no voice selected)",
    ELEVEN_MODEL_ID: env.ELEVEN_MODEL_ID || "(default: eleven_flash_v2_5)",
    chunkMinChars: env.LEGACY_TTS_MIN_CHUNK_CHARS,
    chunkMaxChars: env.LEGACY_TTS_MAX_CHUNK_CHARS,
    chunkWaitMs: env.LEGACY_TTS_MAX_CHUNK_WAIT_MS,
  });

  // RTP Bridge
  logger.info("RTP Bridge", {
    RTP_BRIDGE_URL: env.RTP_BRIDGE_URL || "(NOT SET — will use mock media)",
    mode: env.RTP_BRIDGE_URL ? "live" : "mock",
  });

  // Platform API
  logger.info("Platform API", {
    PLATFORM_API_URL: env.PLATFORM_API_URL,
    INTERNAL_SERVICE_TOKEN: env.INTERNAL_SERVICE_TOKEN ? "***set***" : "(NOT SET — internal API calls will 401 in Clerk mode)",
  });

  // Infrastructure
  logger.info("infrastructure", {
    REDIS_ENABLED: env.REDIS_ENABLED,
    KAFKA_ENABLED: env.KAFKA_ENABLED,
    CONCURRENCY_LIMIT: env.CONCURRENCY_LIMIT,
    NODE_ENV: env.NODE_ENV,
  });
}

async function bootstrap(): Promise<void> {
  // Configure OpenAI auth for Agents SDK before any agent is used.
  // Use SDK-managed client construction to avoid cross-version OpenAI type conflicts.
  if (env.OPENAI_API_KEY.trim()) {
    setDefaultOpenAIKey(env.OPENAI_API_KEY);
  }

  printEnvDiagnostics();

  const bus =
    env.EVENT_BUS_IMPL === "redis"
      ? createRedisEventBus(env.REDIS_URL)
      : createInMemoryEventBus();
  logger.info("event bus", { impl: env.EVENT_BUS_IMPL });
  const cache = new ConfigCache();
  const events = new EventPublisher(bus);

  // Bootstrap cache from platform-api; fall back to default snapshot if unavailable.
  logger.info("hydrating config cache from platform-api...", { url: env.PLATFORM_API_URL });
  try {
    const snapshot = await fetchConfigSnapshot(env.REALTIME_BOOTSTRAP_ORG_ID, "default");
    cache.replaceFromSnapshot(snapshot);

    // Log what we got
    const phoneCount = snapshot.phoneNumbers?.length ?? 0;
    logger.info("cache hydrated from platform-api", {
      orgId: snapshot.orgId,
      lob: snapshot.lob,
      version: snapshot.version,
      agentConfigId: snapshot.agentConfig?.id,
      llmModel: snapshot.agentConfig?.llmProfileId,
      phoneNumbers: phoneCount,
      phones: snapshot.phoneNumbers?.map((p: any) => p.did) ?? [],
    });

    if (phoneCount === 0) {
      logger.warn("cache has 0 phone numbers — inbound calls will require lazy fetch from platform-api");
    }
  } catch (err) {
    logger.warn("failed to hydrate from platform-api, using default snapshot", { error: (err as Error).message });
    cache.hydrate(makeDefaultSnapshot(env.REALTIME_BOOTSTRAP_ORG_ID, "default", env.LLM_MODEL));
  }

  await bus.subscribe("ConfigChanged", async (event: TypedEventEnvelope<"ConfigChanged">) => {
    const payload = event.payload as ConfigChangedPayload;
    try {
      const snapshot = await fetchConfigSnapshot(event.org_id, payload.lob ?? "default");
      cache.replaceFromSnapshot(snapshot);
      logger.info("refreshed cache from ConfigChanged", {
        event_id: event.event_id,
        lob: snapshot.lob,
        version: snapshot.version
      });
    } catch (err) {
      logger.error("failed to refresh cache on ConfigChanged", { error: (err as Error).message, event_id: event.event_id });
    }
  });

  const billing = new BillingQuotaClient();
  const rtpBridge = new RtpBridgeClient({ mock: !env.RTP_BRIDGE_URL });
  const callController = new CallController({
    cache,
    events,
    billing,
    media: rtpBridge,
    elevenApiKey: env.ELEVEN_API_KEY || undefined,
    elevenVoiceId: env.ELEVEN_VOICE_ID || undefined,
  });

  await startWebhookServer(callController);

  logger.info("─── realtime-core READY ───", {
    webhookPort: WEBHOOK_LISTEN_PORT,
    conversationEngine: env.CONVERSATION_ENGINE,
    stt: env.STT_PROVIDER,
    tts: env.ELEVEN_API_KEY ? "elevenlabs" : "disabled",
    rtpBridge: env.RTP_BRIDGE_URL ? "live" : "mock",
    platformApi: env.PLATFORM_API_URL,
  });

  // Wait for shutdown signal
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });

  logger.info("shutting down realtime-core");
}

bootstrap().catch((err) => {
  logger.error("realtime-core bootstrap failed", { error: err });
  process.exit(1);
});
