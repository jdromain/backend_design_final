import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolvedAuthHook } from "../auth/jwt";
import { requireOrgForRequest } from "../auth/orgScope";
import { sendData, sendError } from "../lib/responses";
import { PersistenceStore } from "../persistence/store";

const persistence = new PersistenceStore();

const PROVIDERS: Array<{ id: string; name: string; requiredFields: Array<{ key: string; label: string; type: "text" | "password" }> }> = [
  {
    id: "calendly",
    name: "Calendly",
    requiredFields: [
      { key: "apiKey", label: "API Key", type: "password" },
      { key: "eventType", label: "Event Type", type: "text" },
    ],
  },
  {
    id: "google_calendar",
    name: "Google Calendar",
    requiredFields: [
      { key: "accessToken", label: "Access Token", type: "password" },
      { key: "calendarId", label: "Calendar ID", type: "text" },
    ],
  },
  {
    id: "twilio",
    name: "Twilio",
    requiredFields: [
      { key: "accountSid", label: "Account SID", type: "text" },
      { key: "authToken", label: "Auth Token", type: "password" },
      { key: "from", label: "From Number", type: "text" },
    ],
  },
];

export function registerIntegrationsRoutes(app: FastifyInstance) {
  const preHandler = resolvedAuthHook(["admin", "editor", "viewer"]);

  app.get("/integrations", { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;

    const rows = await Promise.all(
      PROVIDERS.map(async (provider) => {
        const credentials = await persistence.loadCredentials(orgId, provider.id);
        const hasCredentials = !!credentials && Object.keys(credentials).length > 0;
        return {
          id: provider.id,
          name: provider.name,
          description: `${provider.name} integration`,
          icon: "🔌",
          status: hasCredentials ? "connected" : "disconnected",
          requiredFields: provider.requiredFields,
        };
      }),
    );
    sendData(reply, rows);
  });

  app.post("/integrations/:provider", { preHandler: resolvedAuthHook(["admin", "editor"]) }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;
    const { provider } = request.params as { provider: string };
    const body = (request.body ?? {}) as { credentials?: Record<string, string> };
    if (!body.credentials || typeof body.credentials !== "object") {
      return sendError(reply, 400, "bad_request", "credentials are required");
    }

    await persistence.saveCredentials({ orgId, provider, data: body.credentials });
    sendData(reply, { ok: true });
  });

  app.delete("/integrations/:provider", { preHandler: resolvedAuthHook(["admin", "editor"]) }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;
    const { provider } = request.params as { provider: string };
    await persistence.saveCredentials({ orgId, provider, data: {} });
    sendData(reply, { ok: true });
  });

  app.post("/integrations/:provider/test", { preHandler: resolvedAuthHook(["admin", "editor"]) }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;
    const { provider } = request.params as { provider: string };
    const credentials = await persistence.loadCredentials(orgId, provider);
    const hasCredentials = !!credentials && Object.keys(credentials).length > 0;
    sendData(reply, {
      ok: true,
      valid: hasCredentials,
      message: hasCredentials ? "Credentials are present and ready for provider checks." : "No credentials configured",
    });
  });

  app.get("/integrations/:provider/logs", { preHandler }, async (_request: FastifyRequest, reply: FastifyReply) => {
    sendData(reply, []);
  });
}

