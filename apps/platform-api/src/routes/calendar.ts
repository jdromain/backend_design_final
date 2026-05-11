import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createLogger } from "@rezovo/logging";
import { resolvedAuthHook, resolvedAuthOrInternalHook } from "../auth/jwt";
import { requireOrgForRequest } from "../auth/orgScope";
import { sendData, sendError } from "../lib/responses";
import { CalendarDomainError, CalendarService } from "../calendar/service";

const logger = createLogger({ service: "platform-api", module: "calendarRoutes" });
const calendar = new CalendarService();

function resolveOrgId(
  request: FastifyRequest,
  reply: FastifyReply,
  queryOrgIdRaw: unknown,
  bodyOrgIdRaw?: unknown,
): string | null {
  if (request.internalServiceAuth) {
    const bodyOrg = typeof bodyOrgIdRaw === "string" ? bodyOrgIdRaw.trim() : "";
    const queryOrg = typeof queryOrgIdRaw === "string" ? queryOrgIdRaw.trim() : "";
    const orgId = bodyOrg || queryOrg;
    if (!orgId) {
      sendError(reply, 400, "bad_request", "orgId is required for internal calendar requests");
      return null;
    }
    return orgId;
  }

  return requireOrgForRequest(request, reply, queryOrgIdRaw);
}

function domainError(reply: FastifyReply, error: unknown): void {
  if (error instanceof CalendarDomainError) {
    sendError(reply, error.status, error.code, error.message);
    return;
  }

  logger.error("calendar route failure", {
    error: error instanceof Error ? error.message : String(error),
  });
  sendError(reply, 500, "internal_error", "Calendar request failed");
}

export function registerCalendarRoutes(app: FastifyInstance): void {
  app.get(
    "/calendar/resources",
    { preHandler: resolvedAuthOrInternalHook(["admin", "editor", "viewer"]) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const queryInput = (request.query ?? {}) as { orgId?: string };
      const orgId = resolveOrgId(request, reply, queryInput.orgId);
      if (!orgId) return;

      try {
        const resources = await calendar.listResources(orgId);
        sendData(reply, resources);
      } catch (error) {
        domainError(reply, error);
      }
    },
  );

  app.post(
    "/calendar/resources",
    { preHandler: resolvedAuthOrInternalHook(["admin", "editor"]) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const queryInput = (request.query ?? {}) as { orgId?: string };
      const body = (request.body ?? {}) as {
        orgId?: string;
        name?: string;
        timezone?: string;
        slotIntervalMin?: number;
        capacityPerSlot?: number;
        providerBinding?: Record<string, unknown>;
        isActive?: boolean;
      };
      const orgId = resolveOrgId(request, reply, queryInput.orgId, body.orgId);
      if (!orgId) return;

      try {
        const created = await calendar.createResource(orgId, {
          name: body.name ?? "",
          timezone: body.timezone,
          slotIntervalMin: body.slotIntervalMin,
          capacityPerSlot: body.capacityPerSlot,
          providerBinding: body.providerBinding,
          isActive: body.isActive,
        });
        sendData(reply, created, 201);
      } catch (error) {
        domainError(reply, error);
      }
    },
  );

  app.patch(
    "/calendar/resources/:resourceId",
    { preHandler: resolvedAuthOrInternalHook(["admin", "editor"]) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const queryInput = (request.query ?? {}) as { orgId?: string };
      const params = request.params as { resourceId: string };
      const body = (request.body ?? {}) as {
        orgId?: string;
        name?: string;
        timezone?: string;
        slotIntervalMin?: number;
        capacityPerSlot?: number;
        providerBinding?: Record<string, unknown>;
        isActive?: boolean;
      };
      const orgId = resolveOrgId(request, reply, queryInput.orgId, body.orgId);
      if (!orgId) return;

      try {
        const updated = await calendar.updateResource(orgId, params.resourceId, body);
        sendData(reply, updated);
      } catch (error) {
        domainError(reply, error);
      }
    },
  );

  app.get(
    "/calendar/bookings",
    { preHandler: resolvedAuthOrInternalHook(["admin", "editor", "viewer"]) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const queryInput = (request.query ?? {}) as {
        orgId?: string;
        from?: string;
        to?: string;
        resourceId?: string;
        status?: string;
        customerPhone?: string;
        customerName?: string;
      };
      const orgId = resolveOrgId(request, reply, queryInput.orgId);
      if (!orgId) return;

      try {
        const bookings = await calendar.listBookings(orgId, {
          from: queryInput.from,
          to: queryInput.to,
          resourceId: queryInput.resourceId,
          status: queryInput.status,
          customerPhone: queryInput.customerPhone,
          customerName: queryInput.customerName,
        });
        sendData(reply, bookings);
      } catch (error) {
        domainError(reply, error);
      }
    },
  );

  app.post(
    "/calendar/bookings/lookup",
    { preHandler: resolvedAuthOrInternalHook(["admin", "editor", "viewer"]) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const queryInput = (request.query ?? {}) as { orgId?: string };
      const body = (request.body ?? {}) as {
        orgId?: string;
        name?: string;
        phone?: string;
        date?: string;
        resourceId?: string;
        limit?: number;
        providerEventId?: string;
      };
      const orgId = resolveOrgId(request, reply, queryInput.orgId, body.orgId);
      if (!orgId) return;

      try {
        const matches = await calendar.lookupBookings(orgId, {
          name: body.name,
          phone: body.phone,
          date: body.date,
          resourceId: body.resourceId,
          limit: body.limit,
          providerEventId: body.providerEventId,
        });
        sendData(reply, matches);
      } catch (error) {
        domainError(reply, error);
      }
    },
  );

  app.post(
    "/calendar/bookings",
    { preHandler: resolvedAuthOrInternalHook(["admin", "editor"]) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const queryInput = (request.query ?? {}) as { orgId?: string };
      const body = (request.body ?? {}) as {
        orgId?: string;
        resourceId?: string;
        startsAt?: string;
        endsAt?: string;
        customerName?: string | null;
        customerPhone?: string | null;
        customerEmail?: string | null;
        partySize?: number;
        notes?: string | null;
        source?: "local_manual" | "voice_agent" | "provider_synced" | "provider_reconciled";
        metadata?: Record<string, unknown>;
      };
      const orgId = resolveOrgId(request, reply, queryInput.orgId, body.orgId);
      if (!orgId) return;

      try {
        const booking = await calendar.createBooking(orgId, {
          resourceId: body.resourceId,
          startsAt: body.startsAt ?? "",
          endsAt: body.endsAt ?? "",
          customerName: body.customerName,
          customerPhone: body.customerPhone,
          customerEmail: body.customerEmail,
          partySize: body.partySize,
          notes: body.notes,
          source: body.source,
          metadata: body.metadata,
        });
        sendData(reply, booking, 201);
      } catch (error) {
        domainError(reply, error);
      }
    },
  );

  app.patch(
    "/calendar/bookings/:bookingId",
    { preHandler: resolvedAuthOrInternalHook(["admin", "editor"]) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const queryInput = (request.query ?? {}) as { orgId?: string };
      const params = request.params as { bookingId: string };
      const body = (request.body ?? {}) as {
        orgId?: string;
        resourceId?: string;
        startsAt?: string;
        endsAt?: string;
        customerName?: string | null;
        customerPhone?: string | null;
        customerEmail?: string | null;
        partySize?: number;
        notes?: string | null;
        metadata?: Record<string, unknown>;
      };
      const orgId = resolveOrgId(request, reply, queryInput.orgId, body.orgId);
      if (!orgId) return;

      try {
        const booking = await calendar.updateBooking(orgId, params.bookingId, {
          resourceId: body.resourceId,
          startsAt: body.startsAt,
          endsAt: body.endsAt,
          customerName: body.customerName,
          customerPhone: body.customerPhone,
          customerEmail: body.customerEmail,
          partySize: body.partySize,
          notes: body.notes,
          metadata: body.metadata,
        });
        sendData(reply, booking);
      } catch (error) {
        domainError(reply, error);
      }
    },
  );

  app.post(
    "/calendar/bookings/:bookingId/cancel",
    { preHandler: resolvedAuthOrInternalHook(["admin", "editor"]) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const queryInput = (request.query ?? {}) as { orgId?: string };
      const params = request.params as { bookingId: string };
      const body = (request.body ?? {}) as { orgId?: string; reason?: string };
      const orgId = resolveOrgId(request, reply, queryInput.orgId, body.orgId);
      if (!orgId) return;

      try {
        const canceled = await calendar.cancelBooking(orgId, params.bookingId, body.reason);
        sendData(reply, canceled);
      } catch (error) {
        domainError(reply, error);
      }
    },
  );

  app.get(
    "/calendar/availability",
    { preHandler: resolvedAuthOrInternalHook(["admin", "editor", "viewer"]) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const queryInput = (request.query ?? {}) as {
        orgId?: string;
        date?: string;
        resourceId?: string;
        durationMin?: string | number;
        partySize?: string | number;
      };
      const orgId = resolveOrgId(request, reply, queryInput.orgId);
      if (!orgId) return;
      if (!queryInput.date) {
        sendError(reply, 400, "bad_request", "date is required");
        return;
      }

      const durationMinRaw =
        typeof queryInput.durationMin === "number"
          ? queryInput.durationMin
          : Number.parseInt(String(queryInput.durationMin ?? ""), 10);
      const partySizeRaw =
        typeof queryInput.partySize === "number"
          ? queryInput.partySize
          : Number.parseInt(String(queryInput.partySize ?? ""), 10);

      try {
        const availability = await calendar.getAvailability(orgId, {
          date: queryInput.date,
          resourceId: queryInput.resourceId,
          durationMin: Number.isFinite(durationMinRaw) ? durationMinRaw : undefined,
          partySize: Number.isFinite(partySizeRaw) ? partySizeRaw : undefined,
        });
        sendData(reply, availability);
      } catch (error) {
        domainError(reply, error);
      }
    },
  );

  app.post(
    "/calendar/oauth/refresh-expiring",
    { preHandler: resolvedAuthOrInternalHook(["admin", "editor"]) },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const refreshed = await calendar.refreshExpiringTokens();
        sendData(reply, refreshed);
      } catch (error) {
        domainError(reply, error);
      }
    },
  );

  app.post(
    "/calendar/reconcile/google",
    { preHandler: resolvedAuthOrInternalHook(["admin", "editor"]) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const queryInput = (request.query ?? {}) as { orgId?: string };
      const body = (request.body ?? {}) as { orgId?: string };
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
        sendData(reply, result);
      } catch (error) {
        domainError(reply, error);
      }
    },
  );
}
