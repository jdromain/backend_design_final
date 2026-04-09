import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Type, Static } from "@sinclair/typebox";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { createLogger } from "@rezovo/logging";
import { PersistenceStore } from "../persistence/store";
import { resolvedAuthHook } from "../auth/jwt";
import { requireTenantForRequest } from "../auth/tenantScope";

const logger = createLogger({ service: "platform-api", module: "credentials" });
const credPreHandler = resolvedAuthHook(["admin", "editor"]);
const persistence = new PersistenceStore();

// Schema definitions
const SaveCredentialsSchema = Type.Object({
  provider: Type.String({ description: "Provider name (e.g., calendly, google_calendar, twilio)" }),
  credentials: Type.Record(Type.String(), Type.String(), { description: "Key-value pairs of credentials" })
});

const GetCredentialsSchema = Type.Object({
  provider: Type.String({ description: "Provider name" })
});

const ListProvidersResponseSchema = Type.Object({
  ok: Type.Boolean(),
  providers: Type.Array(Type.Object({
    provider: Type.String(),
    name: Type.String(),
    requiredFields: Type.Array(Type.String()),
    optionalFields: Type.Array(Type.String()),
    docs: Type.String()
  }))
});

type SaveCredentialsBody = Static<typeof SaveCredentialsSchema>;
type GetCredentialsParams = Static<typeof GetCredentialsSchema>;

// Supported providers with their required credential fields
const PROVIDERS = {
  calendly: {
    name: "Calendly",
    requiredFields: ["apiKey", "eventType"],
    optionalFields: ["defaultInviteeEmail"],
    docs: "https://developer.calendly.com/api-docs"
  },
  google_calendar: {
    name: "Google Calendar",
    requiredFields: ["accessToken", "calendarId"],
    optionalFields: ["refreshToken", "defaultInviteeEmail"],
    docs: "https://developers.google.com/calendar/api"
  },
  twilio: {
    name: "Twilio",
    requiredFields: ["accountSid", "authToken", "from"],
    optionalFields: [],
    docs: "https://www.twilio.com/docs/usage/api"
  },
  hubspot: {
    name: "HubSpot",
    requiredFields: ["accessToken"],
    optionalFields: ["apiKey"],
    docs: "https://developers.hubspot.com/docs/api/overview"
  },
  stripe: {
    name: "Stripe",
    requiredFields: ["secretKey"],
    optionalFields: ["webhookSecret"],
    docs: "https://stripe.com/docs/api"
  }
};

export function credentialsRoutes(app: FastifyInstance): void {
  const typedApp = app.withTypeProvider<TypeBoxTypeProvider>();

  // List all supported providers
  typedApp.get("/credentials/providers", {
    schema: {
      response: {
        200: ListProvidersResponseSchema
      }
    }
  }, async (_request: FastifyRequest, _reply: FastifyReply) => {
    return {
      ok: true,
      providers: Object.entries(PROVIDERS).map(([key, config]) => ({
        provider: key,
        name: config.name,
        requiredFields: config.requiredFields,
        optionalFields: config.optionalFields,
        docs: config.docs
      }))
    };
  });

  // Save/update credentials for a provider
  typedApp.post<{ Params: { tenantId: string }, Body: SaveCredentialsBody }>("/credentials/:tenantId", {
    preHandler: credPreHandler,
    schema: {
      params: Type.Object({
        tenantId: Type.String()
      }),
      body: SaveCredentialsSchema,
      response: {
        200: Type.Object({
          ok: Type.Boolean(),
          provider: Type.String(),
          message: Type.String()
        }),
        400: Type.Object({
          ok: Type.Boolean(),
          error: Type.String()
        })
      }
    }
  }, async (request: FastifyRequest<{ Params: { tenantId: string }, Body: SaveCredentialsBody }>, reply: FastifyReply) => {
    const tenantId = requireTenantForRequest(request, reply, request.params.tenantId);
    if (!tenantId) return;
    const { provider, credentials } = request.body;

    // Validate provider exists
    if (!PROVIDERS[provider as keyof typeof PROVIDERS]) {
      reply.status(400);
      return {
        ok: false,
        error: `Unknown provider: ${provider}. Supported: ${Object.keys(PROVIDERS).join(", ")}`
      };
    }

    // Validate required fields
    const providerConfig = PROVIDERS[provider as keyof typeof PROVIDERS];
    const missingFields = providerConfig.requiredFields.filter(field => !credentials[field]);
    if (missingFields.length > 0) {
      reply.status(400);
      return {
        ok: false,
        error: `Missing required fields for ${provider}: ${missingFields.join(", ")}`
      };
    }

    try {
      await persistence.saveCredentials({
        tenantId,
        provider,
        data: credentials
      });

      logger.info("credentials saved", { tenantId, provider });

      return {
        ok: true,
        provider,
        message: `Credentials for ${provider} saved successfully`
      };
    } catch (err) {
      logger.error("failed to save credentials", { error: (err as Error).message, tenantId, provider });
      reply.status(500);
      return {
        ok: false,
        error: "Failed to save credentials"
      };
    }
  });

  // Get credentials for a provider (returns masked version)
  typedApp.get<{ Params: { tenantId: string; provider: string } }>("/credentials/:tenantId/:provider", {
    preHandler: credPreHandler,
    schema: {
      params: Type.Object({
        tenantId: Type.String(),
        provider: Type.String()
      }),
      response: {
        200: Type.Object({
          ok: Type.Boolean(),
          provider: Type.String(),
          hasCredentials: Type.Boolean(),
          maskedCredentials: Type.Optional(Type.Record(Type.String(), Type.String()))
        }),
        404: Type.Object({
          ok: Type.Boolean(),
          error: Type.String()
        })
      }
    }
  }, async (request: FastifyRequest<{ Params: { tenantId: string; provider: string } }>, reply: FastifyReply) => {
    const tenantId = requireTenantForRequest(request, reply, request.params.tenantId);
    if (!tenantId) return;
    const { provider } = request.params;

    try {
      const credentials = await persistence.loadCredentials(tenantId, provider);

      if (!credentials) {
        reply.status(404);
        return {
          ok: false,
          error: `No credentials found for provider: ${provider}`
        };
      }

      // Mask sensitive values
      const masked: Record<string, string> = {};
      for (const [key, value] of Object.entries(credentials)) {
        if (value && value.length > 4) {
          masked[key] = `${value.slice(0, 4)}${"*".repeat(8)}`;
        } else {
          masked[key] = "****";
        }
      }

      return {
        ok: true,
        provider,
        hasCredentials: true,
        maskedCredentials: masked
      };
    } catch (err) {
      logger.error("failed to load credentials", { error: (err as Error).message, tenantId, provider });
      reply.status(500);
      return {
        ok: false,
        error: "Failed to load credentials"
      };
    }
  });

  // Delete credentials for a provider
  typedApp.delete<{ Params: { tenantId: string; provider: string } }>("/credentials/:tenantId/:provider", {
    preHandler: credPreHandler,
    schema: {
      params: Type.Object({
        tenantId: Type.String(),
        provider: Type.String()
      }),
      response: {
        200: Type.Object({
          ok: Type.Boolean(),
          message: Type.String()
        })
      }
    }
  }, async (request: FastifyRequest<{ Params: { tenantId: string; provider: string } }>, reply: FastifyReply) => {
    const tenantId = requireTenantForRequest(request, reply, request.params.tenantId);
    if (!tenantId) return;
    const { provider } = request.params;

    try {
      // Save empty credentials to effectively delete
      await persistence.saveCredentials({
        tenantId,
        provider,
        data: {}
      });

      logger.info("credentials deleted", { tenantId, provider });

      return {
        ok: true,
        message: `Credentials for ${provider} deleted successfully`
      };
    } catch (err) {
      logger.error("failed to delete credentials", { error: (err as Error).message, tenantId, provider });
      reply.status(500);
      return {
        ok: false,
        error: "Failed to delete credentials"
      };
    }
  });

  // Test credentials by making a simple API call
  typedApp.post<{ Params: { tenantId: string; provider: string } }>("/credentials/:tenantId/:provider/test", {
    preHandler: credPreHandler,
    schema: {
      params: Type.Object({
        tenantId: Type.String(),
        provider: Type.String()
      }),
      response: {
        200: Type.Object({
          ok: Type.Boolean(),
          provider: Type.String(),
          valid: Type.Boolean(),
          message: Type.String(),
          details: Type.Optional(Type.Any())
        })
      }
    }
  }, async (request: FastifyRequest<{ Params: { tenantId: string; provider: string } }>, reply: FastifyReply) => {
    const tenantId = requireTenantForRequest(request, reply, request.params.tenantId);
    if (!tenantId) return;
    const { provider } = request.params;

    try {
      const credentials = await persistence.loadCredentials(tenantId, provider);

      if (!credentials) {
        return {
          ok: true,
          provider,
          valid: false,
          message: "No credentials found"
        };
      }

      // Test based on provider
      let testResult = { valid: false, message: "Test not implemented", details: {} };

      switch (provider) {
        case "calendly":
          testResult = await testCalendlyCredentials(credentials);
          break;
        case "twilio":
          testResult = await testTwilioCredentials(credentials);
          break;
        case "google_calendar":
          testResult = await testGoogleCalendarCredentials(credentials);
          break;
        default:
          testResult = { valid: false, message: `Test not implemented for ${provider}`, details: {} };
      }

      return {
        ok: true,
        provider,
        ...testResult
      };
    } catch (err) {
      logger.error("credential test failed", { error: (err as Error).message, tenantId, provider });
      return {
        ok: true,
        provider,
        valid: false,
        message: `Test failed: ${(err as Error).message}`
      };
    }
  });
}

// Test helper functions
async function testCalendlyCredentials(credentials: Record<string, string>) {
  try {
    const token = credentials.apiKey ?? credentials.personalToken ?? credentials.token;
    const res = await fetch("https://api.calendly.com/users/me", {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (res.ok) {
      const data = await res.json() as { resource?: { name?: string } };
      return {
        valid: true,
        message: "Credentials are valid",
        details: { name: data.resource?.name }
      };
    }

    return {
      valid: false,
      message: `API returned ${res.status}: ${res.statusText}`,
      details: {}
    };
  } catch (err) {
    return {
      valid: false,
      message: (err as Error).message,
      details: {}
    };
  }
}

async function testTwilioCredentials(credentials: Record<string, string>) {
  try {
    const { accountSid, authToken } = credentials;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`, {
      headers: { Authorization: `Basic ${auth}` }
    });

    if (res.ok) {
      const data = await res.json() as { friendly_name?: string; status?: string };
      return {
        valid: true,
        message: "Credentials are valid",
        details: { friendlyName: data.friendly_name, status: data.status }
      };
    }

    return {
      valid: false,
      message: `API returned ${res.status}: ${res.statusText}`,
      details: {}
    };
  } catch (err) {
    return {
      valid: false,
      message: (err as Error).message,
      details: {}
    };
  }
}

async function testGoogleCalendarCredentials(credentials: Record<string, string>) {
  try {
    const { accessToken } = credentials;
    const res = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (res.ok) {
      const data = await res.json() as { items?: unknown[] };
      return {
        valid: true,
        message: "Credentials are valid",
        details: { calendars: data.items?.length ?? 0 }
      };
    }

    if (res.status === 401) {
      return {
        valid: false,
        message: "Access token expired or invalid. Please refresh.",
        details: {}
      };
    }

    return {
      valid: false,
      message: `API returned ${res.status}: ${res.statusText}`,
      details: {}
    };
  } catch (err) {
    return {
      valid: false,
      message: (err as Error).message,
      details: {}
    };
  }
}
