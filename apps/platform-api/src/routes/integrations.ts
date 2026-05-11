import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createLogger } from "@rezovo/logging";
import { resolvedAuthHook, resolvedAuthOrInternalHook } from "../auth/jwt";
import { requireOrgForRequest } from "../auth/orgScope";
import { sendData, sendError } from "../lib/responses";
import { PersistenceStore } from "../persistence/store";
import { CalendarDomainError, CalendarService } from "../calendar/service";
import { CalendarProviderType, CalendarOAuthAccountRecord } from "../calendar/types";
import { isProvider } from "../calendar/providers";
import { env } from "../env";

const logger = createLogger({ service: "platform-api", module: "integrationRoutes" });
const persistence = new PersistenceStore();
const calendar = new CalendarService();

const PROVIDERS: Array<{
  id: string;
  name: string;
  requiredFields: Array<{ key: string; label: string; type: "text" | "password" }>;
  icon: string;
  supportsOAuth?: boolean;
}> = [
  {
    id: "calendly",
    name: "Calendly",
    icon: "📅",
    supportsOAuth: true,
    requiredFields: [
      { key: "apiKey", label: "API Key", type: "password" },
      { key: "eventType", label: "Event Type", type: "text" },
    ],
  },
  {
    id: "google_calendar",
    name: "Google Calendar",
    icon: "📆",
    supportsOAuth: true,
    requiredFields: [
      { key: "accessToken", label: "Access Token", type: "password" },
      { key: "calendarId", label: "Calendar ID", type: "text" },
    ],
  },
  {
    id: "twilio",
    name: "Twilio",
    icon: "🔌",
    supportsOAuth: false,
    requiredFields: [
      { key: "accountSid", label: "Account SID", type: "text" },
      { key: "authToken", label: "Auth Token", type: "password" },
      { key: "from", label: "From Number", type: "text" },
    ],
  },
];

function resolveOrgId(
  request: FastifyRequest,
  reply: FastifyReply,
  queryOrgIdRaw: unknown,
  bodyOrgIdRaw?: unknown,
): string | null {
  if (request.internalServiceAuth) {
    const queryOrg = typeof queryOrgIdRaw === "string" ? queryOrgIdRaw.trim() : "";
    const bodyOrg = typeof bodyOrgIdRaw === "string" ? bodyOrgIdRaw.trim() : "";
    const orgId = bodyOrg || queryOrg;
    if (!orgId) {
      sendError(reply, 400, "bad_request", "orgId is required for internal integration requests");
      return null;
    }
    return orgId;
  }
  return requireOrgForRequest(request, reply, queryOrgIdRaw);
}

function mapCalendarAccount(account: CalendarOAuthAccountRecord | undefined) {
  if (!account) {
    return {
      connected: false,
      isActive: false,
    };
  }

  return {
    connected: true,
    isActive: account.isActive,
    accountId: account.accountId ?? null,
    accountEmail: account.accountEmail ?? null,
    expiresAt: account.tokenExpiresAt ?? null,
    scopes: account.scopes,
    updatedAt: account.updatedAt,
  };
}

function providerFromParam(raw: string): CalendarProviderType | null {
  if (!isProvider(raw)) return null;
  return raw;
}

function domainError(reply: FastifyReply, error: unknown): void {
  if (error instanceof CalendarDomainError) {
    sendError(reply, error.status, error.code, error.message);
    return;
  }

  logger.error("integration route failure", {
    error: error instanceof Error ? error.message : String(error),
  });
  sendError(reply, 500, "internal_error", "Integration request failed");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function oauthPopupHtml(params: {
  ok: boolean;
  provider: string;
  redirectUrl: string;
  message: string;
}): string {
  const safeMessage = escapeHtml(params.message);
  const safeProvider = escapeHtml(params.provider);
  const safeRedirect = escapeHtml(params.redirectUrl);
  const payload = JSON.stringify({
    type: "rezovo:oauth:complete",
    ok: params.ok,
    provider: params.provider,
  }).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Integration OAuth</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 24px; color: #111827; }
      .card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; max-width: 520px; }
      .hint { color: #6b7280; margin-top: 8px; }
      a { color: #2563eb; }
    </style>
  </head>
  <body>
    <div class="card">
      <h2>${params.ok ? "Calendar connected" : "Calendar connection failed"}</h2>
      <p>${safeMessage}</p>
      <p class="hint">Provider: ${safeProvider}</p>
      <p class="hint"><a href="${safeRedirect}">Return to Integrations</a></p>
    </div>
    <script>
      (function() {
        var payload = ${payload};
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(payload, "*");
          }
        } catch (_e) {}
        setTimeout(function () {
          try { window.close(); } catch (_e) {}
          try { window.location.href = ${JSON.stringify(params.redirectUrl)}; } catch (_e) {}
        }, 250);
      })();
    </script>
  </body>
</html>`;
}

export function registerIntegrationsRoutes(app: FastifyInstance) {
  const preHandler = resolvedAuthHook(["admin", "editor", "viewer"]);

  app.get("/integrations", { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;

    const accounts = await calendar.listProviderAccounts(orgId);
    const accountByProvider = new Map(accounts.map((account) => [account.provider, account]));
    const activeCalendarProvider =
      accounts.find((account) => account.isActive)?.provider ?? null;

    const rows = await Promise.all(
      PROVIDERS.map(async (provider) => {
        const credentials = await persistence.loadCredentials(orgId, provider.id);
        const hasCredentials = !!credentials && Object.keys(credentials).length > 0;
        const calendarAccount =
          provider.id === "calendly" || provider.id === "google_calendar"
            ? accountByProvider.get(provider.id as CalendarProviderType)
            : undefined;
        const hasOAuth = !!calendarAccount;
        const connected = hasOAuth || hasCredentials;

        return {
          id: provider.id,
          name: provider.name,
          description: `${provider.name} integration`,
          icon: provider.icon,
          status: connected ? "connected" : "disconnected",
          requiredFields: provider.requiredFields,
          supportsOAuth: provider.supportsOAuth ?? false,
          oauth: mapCalendarAccount(calendarAccount),
          activeProvider: activeCalendarProvider === provider.id,
          activeCalendarProvider,
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
    const calendarProvider = providerFromParam(provider);
    if (calendarProvider) {
      // Keep row for audit but deactivate credentials/tokens.
      await calendar.disconnectProvider(orgId, calendarProvider).catch(() => undefined);
    }
    sendData(reply, { ok: true });
  });

  app.post("/integrations/:provider/test", { preHandler: resolvedAuthHook(["admin", "editor"]) }, async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
    if (!orgId) return;
    const { provider } = request.params as { provider: string };

    if (isProvider(provider)) {
      const account = (await calendar.listProviderAccounts(orgId)).find((row) => row.provider === provider);
      sendData(reply, {
        ok: true,
        valid: !!account,
        message: account
          ? `${provider} OAuth account is connected.`
          : `${provider} OAuth account is not connected.`,
      });
      return;
    }

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

  app.post(
    "/integrations/:provider/oauth/start",
    { preHandler: resolvedAuthHook(["admin", "editor"]) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
      if (!orgId) return;
      const { provider } = request.params as { provider: string };
      const normalized = providerFromParam(provider);
      if (!normalized) {
        sendError(reply, 400, "bad_request", "OAuth is only supported for calendar providers");
        return;
      }

      try {
        const started = await calendar.startOAuth(orgId, normalized);
        sendData(reply, { ok: true, ...started });
      } catch (error) {
        domainError(reply, error);
      }
    },
  );

  app.get(
    "/integrations/:provider/oauth/callback",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { provider } = request.params as { provider: string };
      const queryInput = (request.query ?? {}) as { state?: string; code?: string; format?: string };
      const normalized = providerFromParam(provider);
      if (!normalized) {
        sendError(reply, 400, "bad_request", "OAuth callback is only supported for calendar providers");
        return;
      }
      if (!queryInput.state || !queryInput.code) {
        sendError(reply, 400, "bad_request", "Missing state or code");
        return;
      }

      const uiBaseUrl = env.DASHBOARD_UI_URL.trim().replace(/\/+$/, "") || "http://localhost:3000";
      const redirectUrl = `${uiBaseUrl}/integrations?oauth=${encodeURIComponent("complete")}&provider=${encodeURIComponent(normalized)}`;
      const jsonMode = (queryInput.format ?? "").toLowerCase() === "json";

      try {
        const account = await calendar.handleOAuthCallback(normalized, queryInput.state, queryInput.code);
        const payload = {
          ok: true,
          provider: normalized,
          account: mapCalendarAccount(account),
        };
        if (jsonMode) {
          sendData(reply, payload);
          return;
        }
        reply.type("text/html; charset=utf-8").send(oauthPopupHtml({
          ok: true,
          provider: normalized,
          redirectUrl,
          message: "OAuth completed successfully. This window will close automatically.",
        }));
      } catch (error) {
        if (jsonMode) {
          domainError(reply, error);
          return;
        }
        const message =
          error instanceof CalendarDomainError
            ? error.message
            : (error instanceof Error ? error.message : "OAuth callback failed");
        reply.type("text/html; charset=utf-8").status(500).send(oauthPopupHtml({
          ok: false,
          provider: normalized,
          redirectUrl,
          message,
        }));
      }
    },
  );

  app.post(
    "/integrations/:provider/oauth/refresh",
    { preHandler: resolvedAuthOrInternalHook(["admin", "editor"]) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { provider } = request.params as { provider: string };
      const body = (request.body ?? {}) as { orgId?: string };
      const queryInput = (request.query ?? {}) as { orgId?: string };
      const orgId = resolveOrgId(request, reply, queryInput.orgId, body.orgId);
      if (!orgId) return;

      const normalized = providerFromParam(provider);
      if (!normalized) {
        sendError(reply, 400, "bad_request", "OAuth refresh is only supported for calendar providers");
        return;
      }

      try {
        const account = await calendar.refreshProviderToken(orgId, normalized);
        sendData(reply, {
          ok: true,
          provider: normalized,
          account: mapCalendarAccount(account),
        });
      } catch (error) {
        domainError(reply, error);
      }
    },
  );

  app.post(
    "/integrations/calendar/active-provider",
    { preHandler: resolvedAuthHook(["admin", "editor"]) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const orgId = requireOrgForRequest(request, reply, (request.query as any).orgId);
      if (!orgId) return;
      const body = (request.body ?? {}) as { provider?: string };
      if (!body.provider || !isProvider(body.provider)) {
        sendError(reply, 400, "bad_request", "provider must be one of: google_calendar, calendly");
        return;
      }

      try {
        const account = await calendar.setActiveProvider(orgId, body.provider);
        sendData(reply, {
          ok: true,
          provider: account.provider,
          account: mapCalendarAccount(account),
        });
      } catch (error) {
        domainError(reply, error);
      }
    },
  );

  app.post(
    "/integrations/calendar/oauth/refresh-expiring",
    { preHandler: resolvedAuthOrInternalHook(["admin", "editor"]) },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await calendar.refreshExpiringTokens();
        sendData(reply, { ok: true, ...result });
      } catch (error) {
        domainError(reply, error);
      }
    },
  );

  app.post(
    "/integrations/calendar/reconcile-google",
    { preHandler: resolvedAuthOrInternalHook(["admin", "editor"]) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as { orgId?: string };
      const queryInput = (request.query ?? {}) as { orgId?: string };
      let scopeOrgId: string | undefined;
      if (request.internalServiceAuth) {
        const fromBody = typeof body.orgId === "string" ? body.orgId.trim() : "";
        const fromQuery = typeof queryInput.orgId === "string" ? queryInput.orgId.trim() : "";
        scopeOrgId = fromBody || fromQuery || undefined;
      } else {
        const orgId = requireOrgForRequest(request, reply, queryInput.orgId);
        if (!orgId) return;
        scopeOrgId = orgId;
      }

      try {
        const result = await calendar.reconcileGoogleBookings(scopeOrgId ?? undefined);
        sendData(reply, { ok: true, ...result });
      } catch (error) {
        domainError(reply, error);
      }
    },
  );
}
