// env MUST be the first import — loads .env before any other module reads process.env
import "./env";

import { createInMemoryEventBus, createRedisEventBus } from "@rezovo/event-bus";
import { createLogger } from "@rezovo/logging";
import { env } from "./env";
import { buildServer } from "./server";
import { callStore } from "./persistence/callStore";
import { ping } from "./persistence/dbClient";
import { runClerkDirectorySyncOnStartup } from "./auth/clerkDirectorySync";

const logger = createLogger({ service: "platform-api", module: "bootstrap" });

async function printStartupDiagnostics(): Promise<void> {
  logger.info("─── platform-api startup diagnostics ───");

  // 1. Environment
  logger.info("env", {
    NODE_ENV: env.NODE_ENV,
    PORT: env.PORT,
    DATABASE_URL: env.DATABASE_URL ? env.DATABASE_URL.replace(/\/\/(.{4}).*@/, "//$1***@") : "(not set)",
    REDIS_ENABLED: env.REDIS_ENABLED,
    KAFKA_ENABLED: env.KAFKA_ENABLED,
    TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID ? `${env.TWILIO_ACCOUNT_SID.slice(0, 8)}...` : "(not set)",
    TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN ? "***set***" : "(not set)",
    RTP_BRIDGE_PUBLIC_URL: env.RTP_BRIDGE_PUBLIC_URL || "(not set)",
    REALTIME_CORE_URL: env.REALTIME_CORE_URL,
    OPENAI_API_KEY: env.OPENAI_API_KEY ? "***set***" : "(not set)",
    STT_API_KEY: env.STT_API_KEY ? "***set***" : "(not set)",
    ELEVEN_API_KEY: env.ELEVEN_API_KEY ? "***set***" : "(not set)",
    ELEVEN_VOICE_ID: env.ELEVEN_VOICE_ID || "(not set)",
  });

  // 2. Database connection + phone numbers
  const dbOk = await ping();
  if (!dbOk) {
    logger.error("DATABASE connection FAILED — check DATABASE_URL and ensure Postgres is running");
  } else {
    logger.info("DATABASE connection OK");

    // Query phone_numbers table
    try {
      const phoneNumbers = await callStore.getAllPhoneNumbers();
      if (phoneNumbers.length === 0) {
        logger.warn("phone_numbers table returned 0 rows — run setup_complete.sql and insert your numbers");
      } else {
        logger.info(`found ${phoneNumbers.length} phone number(s):`, {
          numbers: phoneNumbers.map(pn => ({
            phone: pn.phoneNumber,
            organization: pn.orgId,
            route: pn.routeType,
            status: pn.status,
          })),
        });
        const organizations = [...new Set(phoneNumbers.map(pn => pn.orgId))];
        logger.info("organizations with phone numbers", { organizations });
      }
    } catch (err) {
      logger.error("FAILED to query phone_numbers", {
        error: (err as Error).message,
        hint: "Check DATABASE_URL — you may need to run setup_complete.sql",
      });
    }
  }

  // 3. Service URLs
  if (!env.RTP_BRIDGE_PUBLIC_URL) {
    logger.warn("RTP_BRIDGE_PUBLIC_URL is not set — Twilio TwiML will not include a media stream URL");
  }
  if (!env.REALTIME_CORE_URL) {
    logger.warn("REALTIME_CORE_URL is not set — cannot forward inbound calls");
  }

  logger.info("─── diagnostics complete ───");
}

async function bootstrap(): Promise<void> {
  await printStartupDiagnostics();
  await runClerkDirectorySyncOnStartup();

  const bus =
    env.EVENT_BUS_IMPL === "redis"
      ? createRedisEventBus(env.REDIS_URL)
      : createInMemoryEventBus();
  logger.info("event bus", { impl: env.EVENT_BUS_IMPL, authMode: "clerk" });
  const app = buildServer(bus);
  const port = env.PORT;
  const host = "0.0.0.0";

  await app.listen({ port, host });
  logger.info("platform-api server READY", { port, host, url: `http://${host}:${port}` });
}

bootstrap().catch((err) => {
  logger.error("platform-api bootstrap failed", { error: err });
  process.exit(1);
});
