// env MUST be the first import — loads .env before any other module reads process.env
import "./env";

import { createLogger } from "@rezovo/logging";
import { createInMemoryEventBus } from "@rezovo/event-bus";
import { env } from "./env";
import { ConfigChangedPayload, TypedEventEnvelope } from "@rezovo/core-types";

import { ConfigCache, makeDefaultSnapshot } from "./config-cache/cache";
import { fetchConfigSnapshot } from "./config-cache/fetcher";
import { EventPublisher } from "./events/eventPublisher";
import { BillingQuotaClient } from "./billingClient";
import { RtpBridgeClient } from "./media/rtpBridgeClient";
import { CallController } from "./telephony/callController";
import { PbxBridge } from "./telephony/pbxBridge";
import { startWebhookServer } from "./webhookServer";

const logger = createLogger({ service: "realtime-core", module: "bootstrap" });

function printEnvDiagnostics(): void {
  logger.info("─── realtime-core startup diagnostics ───");

  // LLM
  logger.info("LLM config", {
    provider: env.LLM_PROVIDER,
    model: env.LLM_MODEL,
    maxTokens: env.LLM_MAX_TOKENS,
    OPENAI_API_KEY: env.OPENAI_API_KEY ? "***set***" : "(NOT SET — agent calls will fail)",
  });

  // STT
  logger.info("STT config", {
    provider: env.STT_PROVIDER,
    model: env.STT_MODEL,
    STT_API_KEY: env.STT_API_KEY ? "***set***" : "(NOT SET — transcription will fail)",
  });
  if (env.STT_PROVIDER === "mock") {
    logger.warn("STT_PROVIDER=mock — no real transcription, set STT_PROVIDER=deepgram for live calls");
  }

  // TTS
  logger.info("TTS config", {
    ELEVEN_API_KEY: env.ELEVEN_API_KEY ? "***set***" : "(NOT SET — voice synthesis will fail)",
    ELEVEN_VOICE_ID: env.ELEVEN_VOICE_ID || "(NOT SET — no voice selected)",
  });

  // RTP Bridge
  logger.info("RTP Bridge", {
    RTP_BRIDGE_URL: env.RTP_BRIDGE_URL || "(NOT SET — will use mock media)",
    mode: env.RTP_BRIDGE_URL ? "live" : "mock",
  });

  // Platform API
  logger.info("Platform API", {
    PLATFORM_API_URL: env.PLATFORM_API_URL,
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
  printEnvDiagnostics();

  const bus = createInMemoryEventBus();
  const cache = new ConfigCache();
  const events = new EventPublisher(bus);

  // Bootstrap cache from platform-api; fall back to default snapshot if unavailable.
  logger.info("hydrating config cache from platform-api...", { url: env.PLATFORM_API_URL });
  try {
    const snapshot = await fetchConfigSnapshot("tenant-default", "default");
    cache.replaceFromSnapshot(snapshot);

    // Log what we got
    const phoneCount = snapshot.phoneNumbers?.length ?? 0;
    logger.info("cache hydrated from platform-api", {
      tenantId: snapshot.tenantId,
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
    cache.hydrate(makeDefaultSnapshot("tenant-default"));
  }

  await bus.subscribe("ConfigChanged", async (event: TypedEventEnvelope<"ConfigChanged">) => {
    const payload = event.payload as ConfigChangedPayload;
    try {
      const snapshot = await fetchConfigSnapshot(event.tenant_id, payload.lob ?? "default");
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

  const pbxBridge = new PbxBridge();
  pbxBridge.registerHandler(async (call, ctx) => callController.handleInboundCall(call, ctx));
  await pbxBridge.start();

  startWebhookServer(callController, 3002);

  logger.info("─── realtime-core READY ───", {
    webhookPort: 3002,
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
