import fastify, { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyUnderPressure from "@fastify/under-pressure";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyCors from "@fastify/cors";
import { register as promRegister } from "prom-client";
import { Type, TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import fastifyFormbody from "@fastify/formbody";

import { createEventEnvelope, EventBusClient } from "@rezovo/event-bus";
import { createLogger } from "@rezovo/logging";
import { withTimeout } from "@rezovo/utils";
import { EventPayloadByType } from "@rezovo/core-types";

import { buildConfigChangedEvent, getSchema, getTemplates, validateConfig } from "./config/data";
import { ConfigStore } from "./config/store";
import { canStartCallHandler, registerUsageIngest } from "./billingQuota";
import { toolCallHandler } from "./toolbus";
import { kbRetrieveHandler, kbIngestHandler, kbStatusHandler } from "./kb";
import { authHook, loginHandler } from "./auth/jwt";
import { AnalyticsStore } from "./analytics/store";
import { registerAnalyticsConsumer } from "./analytics/consumer";
import { analyticsRoutes } from "./analytics/routes";
import { calendlyWebhookHandler } from "./webhooks/calendly";
import { PersistenceStore } from "./persistence/store";
import { registerTwilioRoutes } from "./routes/twilio";
import { registerCallRoutes } from "./routes/calls";
import { credentialsRoutes } from "./credentials/routes";
import { runHealthChecks } from "./health/checks";
import { env } from "./env";
import WebSocket from "ws";

// In testing/dev mode, skip auth entirely
const isProduction = env.NODE_ENV === "production";
const devNoOp = undefined; // No preHandler = no auth

const logger = createLogger({ service: "platform-api", module: "http" });

export function buildServer(eventBus: EventBusClient): FastifyInstance<any, any, any, any, TypeBoxTypeProvider> {
  const app = fastify().withTypeProvider<TypeBoxTypeProvider>();
  
  // Enable CORS for frontend
  app.register(fastifyCors, {
    origin: [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://10.0.0.212:3000' // Network address from start script
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']
  });

  // Parse form data from Twilio webhooks
  app.register(fastifyFormbody);
  
  const persistence = new PersistenceStore();
  const configStore = new ConfigStore(persistence);
  const analyticsStore = new AnalyticsStore();
  // Hydrate analytics from persistence on startup.
  persistence
    .loadAnalytics()
    .then((records) => analyticsStore.hydrateCalls(records))
    .catch(() => undefined);
  persistence
    .loadToolUsage()
    .then((records) => analyticsStore.hydrateTools(records))
    .catch(() => undefined);
  registerAnalyticsConsumer(eventBus, analyticsStore);

  // Expose eventBus to request handlers that need to emit without re-plumbing.
  (app as any).eventsBus = eventBus;

  app.register(fastifyRateLimit, {
    max: 100,
    timeWindow: "1 minute",
    hook: "onRequest",
    keyGenerator: (req: FastifyRequest) => `${req.headers["x-tenant-id"] ?? "anon"}::${req.ip}`
  });
  app.register(fastifyUnderPressure, {
    maxEventLoopDelay: 250,
    maxHeapUsedBytes: 256 * 1024 * 1024,
    maxRssBytes: 512 * 1024 * 1024,
    pressureHandler: (_req: FastifyRequest, reply: FastifyReply) => {
      reply.status(503).send({ error: "overloaded" });
    }
  });
  
  // Prometheus metrics endpoint
  app.get("/metrics", async () => {
    return promRegister.metrics();
  });

  // Simple health endpoint (fast, for load balancers)
  app.get("/health", async () => {
    const services: Record<string, string> = {};
    const persistenceReady = await persistence.isReady();
    services.persistence = persistenceReady ? "ok" : "error";
    services.redis = env.REDIS_ENABLED ? "ok" : "disabled";
    services.kafka = env.KAFKA_ENABLED ? "ok" : "disabled";
    return {
      status: Object.values(services).every((status) => status === "ok" || status === "disabled") ? "ok" : "degraded",
      services
    };
  });

  // Comprehensive health check endpoint (includes external services)
  app.get("/health/detailed", {
    schema: {
      description: "Detailed health check including all external dependencies",
      tags: ["Health"],
      response: {
        200: Type.Object({
          overall: Type.String(),
          services: Type.Record(Type.String(), Type.Object({
            status: Type.String(),
            latencyMs: Type.Optional(Type.Number()),
            message: Type.Optional(Type.String()),
            details: Type.Optional(Type.Record(Type.String(), Type.Any()))
          })),
          timestamp: Type.String()
        })
      }
    }
  }, async () => {
    return await runHealthChecks();
  });
  
  app.post("/auth/login", loginHandler);

  app.get(
    "/config/schema",
    {
      schema: {
        querystring: Type.Object({
          lob: Type.Optional(Type.String())
        })
      },
      preHandler: isProduction ? authHook(["admin", "editor"]) : devNoOp
    },
    async (request) => {
      const { lob } = request.query as { lob?: string };
      return { lob: lob ?? "default", schema: getSchema(lob) };
    }
  );

  app.get(
    "/config/templates",
    {
      schema: {
        querystring: Type.Object({
          lob: Type.Optional(Type.String())
        })
      },
      preHandler: isProduction ? authHook(["admin", "editor"]) : devNoOp
    },
    async (request) => {
      const { lob } = request.query as { lob?: string };
      return { lob: lob ?? "default", templates: getTemplates(lob) };
    }
  );

  app.get(
    "/config/snapshot",
    {
      schema: {
        querystring: Type.Object({
          tenantId: Type.String(),
          lob: Type.Optional(Type.String())
        })
      },
      preHandler: isProduction ? authHook(["admin", "editor", "viewer"]) : devNoOp
    },
    async (request) => {
      const { tenantId, lob } = request.query as { tenantId: string; lob?: string };
      return await configStore.getSnapshot(tenantId, lob ?? "default");
    }
  );

  app.post(
    "/config/validate",
    {
      schema: {
        body: Type.Object({
          lob: Type.Optional(Type.String()),
          config: Type.Record(Type.String(), Type.Any())
        })
      },
      preHandler: isProduction ? authHook(["admin", "editor"]) : devNoOp
    },
    async (request, reply) => {
      const { lob, config } = request.body as { lob?: string; config: unknown };
      const result = validateConfig({ lob, config: config as any });
      reply.status(result.ok ? 200 : 400);
      return result;
    }
  );

  app.post(
    "/config/publish",
    {
      schema: {
        body: Type.Object({
          tenantId: Type.String(),
          lob: Type.Optional(Type.String()),
          version: Type.Number(),
          entity: Type.Union([
            Type.Literal("PhoneNumber"),
            Type.Literal("AgentConfig"),
            Type.Literal("Plan"),
            Type.Literal("Business")
          ]),
          entity_id: Type.String(),
          status: Type.Union([Type.Literal("draft"), Type.Literal("published")]),
          config: Type.Optional(Type.Record(Type.String(), Type.Any()))
        })
      },
      preHandler: isProduction ? authHook(["admin", "editor"]) : devNoOp
    },
    async (request, reply) => {
      const body = request.body as {
        tenantId: string;
        lob?: string;
        version: number;
        entity: "PhoneNumber" | "AgentConfig" | "Plan" | "Business";
        entity_id: string;
        status: "draft" | "published";
        config?: unknown;
      };

      if (body.config) {
        const validation = validateConfig({ lob: body.lob, config: body.config as any });
        if (!validation.ok) {
          reply.status(400);
          return validation;
        }
        const stored = configStore.upsertConfig({
          tenantId: body.tenantId,
          lob: body.lob,
          agentConfig: (body.config as any).agentConfig,
          phoneNumbers: (body.config as any).phoneNumbers,
          plan: (body.config as any).plan,
          status: body.status
        });
        body.version = stored.version;
      } else {
        configStore.publishConfig({
          tenantId: body.tenantId,
          lob: body.lob,
          version: body.version,
          status: body.status
        });
      }

      const envelope = buildConfigChangedEvent({
        tenantId: body.tenantId,
        lob: body.lob,
        version: body.version,
        entity: body.entity,
        entity_id: body.entity_id,
        status: body.status
      });

      await withTimeout(eventBus.publish(envelope), 500, "publish ConfigChanged");
      return { ok: true, event_id: envelope.event_id };
    }
  );

  // Billing quota and usage ingest — internal service calls, no auth in dev
  app.post("/billing-quota/can-start-call", { 
    preHandler: isProduction ? authHook(["admin", "editor", "viewer"]) : devNoOp, 
    handler: canStartCallHandler 
  });
  app.post("/usage/ingest", { 
    preHandler: isProduction ? authHook(["admin", "editor", "viewer"]) : devNoOp, 
    handler: registerUsageIngest(eventBus) 
  });

  // Toolbus and KB endpoints — internal service calls, no auth in dev
  app.post("/tool/call", {
    preHandler: isProduction ? authHook(["admin", "editor"]) : devNoOp,
    handler: toolCallHandler(eventBus)
  });
  app.post("/kb/retrieve", { preHandler: isProduction ? authHook(["admin", "editor", "viewer"]) : devNoOp, handler: kbRetrieveHandler });
  app.post("/kb/docs", {
    preHandler: isProduction ? authHook(["admin", "editor"]) : devNoOp,
    handler: (req, reply) => kbIngestHandler(eventBus, req as any, reply)
  });
  app.get("/kb/status", { preHandler: isProduction ? authHook(["admin", "editor", "viewer"]) : devNoOp, handler: kbStatusHandler });

  // Analytics routes
  const analytics = analyticsRoutes(analyticsStore);
  app.get("/analytics/calls", { preHandler: isProduction ? authHook(["admin", "editor", "viewer"]) : devNoOp, handler: analytics.calls });
  app.get("/analytics/tools", { preHandler: isProduction ? authHook(["admin", "editor", "viewer"]) : devNoOp, handler: analytics.tools });

  // Credentials management routes
  credentialsRoutes(app as any);

  // Webhooks
  app.post("/webhooks/calendly", (req, reply) => calendlyWebhookHandler(eventBus, req as any, reply));

  // Call lifecycle routes (calls, transcript, events, phone-numbers)
  registerCallRoutes(app as any);

  // Twilio routes (voice + status webhooks)
  registerTwilioRoutes(app as any);

  app.setErrorHandler((error, _request, reply) => {
    logger.error("platform-api error", { error: (error as Error).message });
    reply.status(500).send({ error: "internal_error" });
  });

  return app;
}

