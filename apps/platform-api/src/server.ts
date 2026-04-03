import fastify, { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyUnderPressure from "@fastify/under-pressure";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyCors from "@fastify/cors";
import { register as promRegister } from "prom-client";
import { Type, TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  BillingQuotaOkSchema,
  HealthEnvelopeSchema,
  LoginOkSchema,
} from "./contracts/httpSchemas";
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
import { authHook, loginHandler, optionalAuthHook } from "./auth/jwt";
import { isClerkEnabled } from "./auth/clerk";
import { AnalyticsStore } from "./analytics/store";
import { registerAnalyticsConsumer } from "./analytics/consumer";
import { PersistenceStore } from "./persistence/store";
import { registerTwilioRoutes } from "./routes/twilio";
import { registerCallRoutes } from "./routes/calls";
import { credentialsRoutes } from "./credentials/routes";
import { runHealthChecks, getSystemHealthData } from "./health/checks";
import { ping } from "./persistence/dbClient";
import { sendData, sendError } from "./lib/responses";
import { env } from "./env";
import WebSocket from "ws";

// New route modules
import { registerAnalyticsRoutes } from "./routes/analytics";
import { registerAgentRoutes } from "./routes/agents";
import { registerPhoneLineRoutes } from "./routes/phoneLines";
import { registerToolRoutes } from "./routes/tools";
import { registerBillingRoutes } from "./routes/billing";
import { registerActionsRoutes } from "./routes/actions";
import { registerNotificationRoutes } from "./routes/notifications";
import { registerActivityRoutes } from "./routes/activity";
import { registerIncidentRoutes } from "./routes/incidents";
import { registerOnboardingRoutes } from "./routes/onboarding";
import { registerTeamRoutes } from "./routes/team";
import { registerDeveloperRoutes } from "./routes/developer";
import { registerKnowledgeRoutes } from "./routes/knowledge";
import { registerSearchRoutes } from "./routes/search";
import { clerkSyncHandler } from "./webhooks/clerkSync";
import { calendlyWebhookHandler } from "./webhooks/calendly";

const isProduction = env.NODE_ENV === "production";

const logger = createLogger({ service: "platform-api", module: "http" });

export function buildServer(eventBus: EventBusClient): FastifyInstance<any, any, any, any, TypeBoxTypeProvider> {
  const app = fastify().withTypeProvider<TypeBoxTypeProvider>();

  // CORS -- env-driven origins + localhost defaults
  const corsOrigins: string[] = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://10.0.0.212:3000",
  ];
  if (env.CORS_ORIGINS) {
    corsOrigins.push(...env.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean));
  }

  app.register(fastifyCors, {
    origin: corsOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  });

  app.register(fastifyFormbody);

  const persistence = new PersistenceStore();
  const configStore = new ConfigStore(persistence);
  const analyticsStore = new AnalyticsStore();

  persistence
    .loadAnalytics()
    .then((records) => analyticsStore.hydrateCalls(records))
    .catch(() => undefined);
  persistence
    .loadToolUsage()
    .then((records) => analyticsStore.hydrateTools(records))
    .catch(() => undefined);
  registerAnalyticsConsumer(eventBus, analyticsStore);

  (app as any).eventsBus = eventBus;

  app.register(fastifyRateLimit, {
    max: 100,
    timeWindow: "1 minute",
    hook: "onRequest",
    keyGenerator: (req: FastifyRequest) => `${req.headers["x-tenant-id"] ?? "anon"}::${req.ip}`,
  });
  // Under-pressure is noisy in local/dev (false positives on heap/RSS); keep for production only.
  if (isProduction) {
    app.register(fastifyUnderPressure, {
      maxEventLoopDelay: 250,
      maxHeapUsedBytes: 256 * 1024 * 1024,
      maxRssBytes: 512 * 1024 * 1024,
      pressureHandler: (_req: FastifyRequest, reply: FastifyReply) => {
        reply.status(503).send({ error: "overloaded" });
      },
    });
  }

  // Prometheus metrics
  app.get("/metrics", async () => promRegister.metrics());

  // Root — browsers often probe `/`; API lives under named routes (`/health`, etc.)
  app.get("/", async (_request, reply) => {
    reply.status(200).send({
      service: "platform-api",
      docs: "Use GET /health for dashboard status, POST /auth/login (dev JWT) when Clerk is off.",
    });
  });

  // Health -- UI shape (SystemHealthData)
  app.get(
    "/health",
    {
      schema: {
        description: "System health for dashboard header",
        response: { 200: HealthEnvelopeSchema },
      },
    },
    async (_request, reply) => {
      const data = await getSystemHealthData();
      sendData(reply, data);
    }
  );

  // Fast liveness probe (DB ping only)
  app.get("/ready", async (_request, reply) => {
    const ok = await ping();
    reply.status(ok ? 200 : 503).send({ ready: ok });
  });

  // Detailed health -- ops shape (unchanged)
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
            details: Type.Optional(Type.Record(Type.String(), Type.Any())),
          })),
          timestamp: Type.String(),
        }),
      },
    },
  }, async () => runHealthChecks());

  // Auth -- dev-only login route
  if (!isClerkEnabled) {
    app.post(
      "/auth/login",
      {
        schema: {
          body: Type.Object({ email: Type.String() }),
          response: {
            200: LoginOkSchema,
            400: Type.Object({ ok: Type.Literal(false), error: Type.String() }),
            401: Type.Object({ ok: Type.Literal(false), error: Type.String() }),
            503: Type.Object({ ok: Type.Literal(false), error: Type.String() }),
          },
        },
      },
      loginHandler
    );
  }

  // Clerk webhook
  app.post("/webhooks/clerk", clerkSyncHandler);

  const sessionReadPreHandler = isProduction
    ? authHook(["admin", "editor", "viewer"])
    : optionalAuthHook();

  app.get("/auth/me", { preHandler: sessionReadPreHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.auth;
    if (!auth) {
      return sendError(reply, 401, "unauthorized", "sign in required");
    }
    sendData(reply, {
      userId: auth.sub,
      tenantId: auth.tenant_id,
      email: auth.email,
      roles: auth.roles,
    });
  });

  // Config endpoints
  app.get("/config/schema", {
    schema: { querystring: Type.Object({ lob: Type.Optional(Type.String()) }) },
    preHandler: isProduction ? authHook(["admin", "editor"]) : optionalAuthHook(),
  }, async (request) => {
    const { lob } = request.query as { lob?: string };
    return { lob: lob ?? "default", schema: getSchema(lob) };
  });

  app.get("/config/templates", {
    schema: { querystring: Type.Object({ lob: Type.Optional(Type.String()) }) },
    preHandler: isProduction ? authHook(["admin", "editor"]) : optionalAuthHook(),
  }, async (request) => {
    const { lob } = request.query as { lob?: string };
    return { lob: lob ?? "default", templates: getTemplates(lob) };
  });

  app.get("/config/snapshot", {
    schema: {
      querystring: Type.Object({
        tenantId: Type.String(),
        lob: Type.Optional(Type.String()),
      }),
    },
    preHandler: isProduction ? authHook(["admin", "editor", "viewer"]) : optionalAuthHook(),
  }, async (request) => {
    const { tenantId, lob } = request.query as { tenantId: string; lob?: string };
    return await configStore.getSnapshot(tenantId, lob ?? "default");
  });

  app.post("/config/validate", {
    schema: {
      body: Type.Object({
        lob: Type.Optional(Type.String()),
        config: Type.Record(Type.String(), Type.Any()),
      }),
    },
    preHandler: isProduction ? authHook(["admin", "editor"]) : optionalAuthHook(),
  }, async (request, reply) => {
    const { lob, config } = request.body as { lob?: string; config: unknown };
    const result = validateConfig({ lob, config: config as any });
    reply.status(result.ok ? 200 : 400);
    return result;
  });

  app.post("/config/publish", {
    schema: {
      body: Type.Object({
        tenantId: Type.String(),
        lob: Type.Optional(Type.String()),
        version: Type.Number(),
        entity: Type.Union([
          Type.Literal("PhoneNumber"),
          Type.Literal("AgentConfig"),
          Type.Literal("Plan"),
          Type.Literal("Business"),
        ]),
        entity_id: Type.String(),
        status: Type.Union([Type.Literal("draft"), Type.Literal("published")]),
        config: Type.Optional(Type.Record(Type.String(), Type.Any())),
      }),
    },
    preHandler: isProduction ? authHook(["admin", "editor"]) : optionalAuthHook(),
  }, async (request, reply) => {
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
        status: body.status,
      });
      body.version = stored.version;
    } else {
      configStore.publishConfig({
        tenantId: body.tenantId,
        lob: body.lob,
        version: body.version,
        status: body.status,
      });
    }

    const envelope = buildConfigChangedEvent({
      tenantId: body.tenantId,
      lob: body.lob,
      version: body.version,
      entity: body.entity,
      entity_id: body.entity_id,
      status: body.status,
    });

    await withTimeout(eventBus.publish(envelope), 500, "publish ConfigChanged");
    return { ok: true, event_id: envelope.event_id };
  });

  // Billing quota and usage ingest -- internal service calls
  app.post("/billing-quota/can-start-call", {
    schema: {
      body: Type.Object({ tenantId: Type.String() }),
      response: {
        200: BillingQuotaOkSchema,
        400: Type.Object({ allowed: Type.Literal(false), reason: Type.String() }),
      },
    },
    preHandler: isProduction ? authHook(["admin", "editor", "viewer"]) : optionalAuthHook(),
    handler: canStartCallHandler,
  });
  app.post("/usage/ingest", {
    preHandler: isProduction ? authHook(["admin", "editor", "viewer"]) : optionalAuthHook(),
    handler: registerUsageIngest(eventBus),
  });

  // Toolbus and KB endpoints -- internal service calls
  app.post("/tool/call", {
    preHandler: isProduction ? authHook(["admin", "editor"]) : optionalAuthHook(),
    handler: toolCallHandler(eventBus),
  });
  app.post("/kb/retrieve", { preHandler: isProduction ? authHook(["admin", "editor", "viewer"]) : optionalAuthHook(), handler: kbRetrieveHandler });
  app.post("/kb/docs", {
    preHandler: isProduction ? authHook(["admin", "editor"]) : optionalAuthHook(),
    handler: (req, reply) => kbIngestHandler(eventBus, req as any, reply),
  });
  app.get("/kb/status", { preHandler: isProduction ? authHook(["admin", "editor", "viewer"]) : optionalAuthHook(), handler: kbStatusHandler });

  // Credentials management
  credentialsRoutes(app as any);

  // Webhooks
  app.post("/webhooks/calendly", (req, reply) => calendlyWebhookHandler(eventBus, req as any, reply));

  // Call lifecycle routes (internal write + UI read)
  registerCallRoutes(app as any);

  // Twilio routes
  registerTwilioRoutes(app as any);

  // --- New UI-facing route modules ---
  registerAnalyticsRoutes(app as any, configStore);
  registerAgentRoutes(app as any, configStore);
  registerPhoneLineRoutes(app as any);
  registerToolRoutes(app as any, configStore);
  registerBillingRoutes(app as any);
  registerActionsRoutes(app as any);
  registerNotificationRoutes(app as any);
  registerActivityRoutes(app as any);
  registerIncidentRoutes(app as any);
  registerOnboardingRoutes(app as any);
  registerTeamRoutes(app as any);
  registerDeveloperRoutes(app as any);
  registerKnowledgeRoutes(app as any);
  registerSearchRoutes(app as any);

  app.setErrorHandler((error, _request, reply) => {
    logger.error("platform-api error", { error: (error as Error).message });
    reply.status(500).send({ error: "internal_error" });
  });

  return app;
}
