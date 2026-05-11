import { createHash } from "crypto";
import { createLogger } from "@rezovo/logging";
import { env } from "../env";
import {
  CalendarOAuthAccountRecord,
  CalendarProviderType,
  ProviderBookingPayload,
  ProviderBookingResult,
  ProviderCancelResult,
} from "./types";

const logger = createLogger({ service: "platform-api", module: "calendarProviders" });

type GoogleEventResponse = {
  id?: string;
  htmlLink?: string;
  status?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

type CalendlyAvailabilityResponse = {
  collection?: Array<{ status?: string; start_time?: string }>;
};

type ProviderAvailabilityArgs = {
  date: string;
  durationMin: number;
  intervalMin: number;
  binding: Record<string, unknown>;
  timezone?: string;
};

function normalizeDateBounds(date: string): { startIso: string; endIso: string } {
  const startIso = `${date}T00:00:00.000Z`;
  const endIso = `${date}T23:59:59.999Z`;
  return { startIso, endIso };
}

function slotsForDay(date: string, durationMin: number, intervalMin: number): string[] {
  const { startIso, endIso } = normalizeDateBounds(date);
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  const intervalMs = intervalMin * 60_000;
  const durationMs = durationMin * 60_000;
  const slots: string[] = [];

  for (let t = startMs; t + durationMs <= endMs; t += intervalMs) {
    slots.push(new Date(t).toISOString());
  }

  return slots;
}

function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

async function parseJsonOrText(res: Response): Promise<unknown> {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    return res.json().catch(() => ({}));
  }
  return res.text().catch(() => "");
}

async function providerRequest(
  url: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(url, init);
  const body = await parseJsonOrText(res);
  return { ok: res.ok, status: res.status, body };
}

function providerError(provider: CalendarProviderType, status: number, body: unknown): Error {
  const detail =
    typeof body === "string"
      ? body
      : body && typeof body === "object"
        ? JSON.stringify(body).slice(0, 400)
        : String(body);
  return new Error(`${provider} request failed (${status}): ${detail}`);
}

function resolveGoogleCalendarId(
  binding: Record<string, unknown>,
  account: CalendarOAuthAccountRecord,
): string {
  const fromBinding = binding.calendarId;
  if (typeof fromBinding === "string" && fromBinding.trim().length > 0) {
    return fromBinding.trim();
  }
  const metaCalendar = account.metadata?.calendarId;
  if (typeof metaCalendar === "string" && metaCalendar.trim().length > 0) {
    return metaCalendar.trim();
  }
  return "primary";
}

function resolveCalendlyEventTypeUri(
  binding: Record<string, unknown>,
  account: CalendarOAuthAccountRecord,
): string {
  const fromBinding = binding.eventTypeUri;
  if (typeof fromBinding === "string" && fromBinding.trim().length > 0) {
    return fromBinding.trim();
  }
  const meta = account.metadata?.eventTypeUri;
  if (typeof meta === "string" && meta.trim().length > 0) {
    return meta.trim();
  }
  if (env.CALENDLY_EVENT_TYPE_URI.trim()) {
    return env.CALENDLY_EVENT_TYPE_URI.trim();
  }
  throw new Error("Calendly event type URI is not configured");
}

function resolveCalendlyEventUri(providerEventId: string): string {
  if (providerEventId.startsWith("http://") || providerEventId.startsWith("https://")) {
    return providerEventId;
  }
  return `https://api.calendly.com/scheduled_events/${providerEventId}`;
}

export interface CalendarProviderAdapter {
  readonly provider: CalendarProviderType;
  createBooking(
    account: CalendarOAuthAccountRecord,
    payload: ProviderBookingPayload,
  ): Promise<ProviderBookingResult>;
  updateBooking(
    account: CalendarOAuthAccountRecord,
    payload: ProviderBookingPayload,
  ): Promise<ProviderBookingResult>;
  cancelBooking(
    account: CalendarOAuthAccountRecord,
    payload: ProviderBookingPayload,
  ): Promise<ProviderCancelResult>;
  listAvailability(
    account: CalendarOAuthAccountRecord,
    args: ProviderAvailabilityArgs,
  ): Promise<string[]>;
}

class GoogleCalendarAdapter implements CalendarProviderAdapter {
  readonly provider: CalendarProviderType = "google_calendar";

  async createBooking(
    account: CalendarOAuthAccountRecord,
    payload: ProviderBookingPayload,
  ): Promise<ProviderBookingResult> {
    const calendarId = resolveGoogleCalendarId(payload.binding, account);
    const summary = payload.customerName
      ? `Booking - ${payload.customerName}`
      : "Booking";
    const attendees = payload.customerEmail ? [{ email: payload.customerEmail }] : [];
    const response = await providerRequest(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${account.encryptedAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary,
          description: payload.notes ?? undefined,
          start: { dateTime: payload.startsAt },
          end: { dateTime: payload.endsAt },
          attendees,
        }),
      },
    );

    if (!response.ok) {
      throw providerError(this.provider, response.status, response.body);
    }

    const event = response.body as GoogleEventResponse;
    return {
      providerEventId: event.id || createHash("sha1").update(`${payload.startsAt}:${payload.endsAt}`).digest("hex"),
      providerPayload: event as Record<string, unknown>,
    };
  }

  async updateBooking(
    account: CalendarOAuthAccountRecord,
    payload: ProviderBookingPayload,
  ): Promise<ProviderBookingResult> {
    if (!payload.providerEventId) {
      throw new Error("Missing provider_event_id for Google update");
    }
    const calendarId = resolveGoogleCalendarId(payload.binding, account);
    const response = await providerRequest(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(payload.providerEventId)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${account.encryptedAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary: payload.customerName ? `Booking - ${payload.customerName}` : "Booking",
          description: payload.notes ?? undefined,
          start: { dateTime: payload.startsAt },
          end: { dateTime: payload.endsAt },
          attendees: payload.customerEmail ? [{ email: payload.customerEmail }] : undefined,
        }),
      },
    );

    if (!response.ok) {
      throw providerError(this.provider, response.status, response.body);
    }

    const event = response.body as GoogleEventResponse;
    return {
      providerEventId: event.id || payload.providerEventId,
      providerPayload: event as Record<string, unknown>,
    };
  }

  async cancelBooking(
    account: CalendarOAuthAccountRecord,
    payload: ProviderBookingPayload,
  ): Promise<ProviderCancelResult> {
    if (!payload.providerEventId) {
      throw new Error("Missing provider_event_id for Google cancel");
    }
    const calendarId = resolveGoogleCalendarId(payload.binding, account);
    const response = await providerRequest(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(payload.providerEventId)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${account.encryptedAccessToken}`,
        },
      },
    );

    if (!response.ok && response.status !== 410 && response.status !== 404) {
      throw providerError(this.provider, response.status, response.body);
    }

    return { providerPayload: { status: response.status } };
  }

  async listAvailability(
    account: CalendarOAuthAccountRecord,
    args: ProviderAvailabilityArgs,
  ): Promise<string[]> {
    const calendarId = resolveGoogleCalendarId(args.binding, account);
    const { startIso, endIso } = normalizeDateBounds(args.date);
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    );
    url.searchParams.set("timeMin", startIso);
    url.searchParams.set("timeMax", endIso);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "250");

    const response = await providerRequest(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${account.encryptedAccessToken}` },
    });
    if (!response.ok) {
      throw providerError(this.provider, response.status, response.body);
    }

    const raw = response.body as { items?: GoogleEventResponse[] };
    const busyWindows: Array<{ start: number; end: number }> = [];
    for (const item of raw.items ?? []) {
      const start = item.start?.dateTime ?? (item.start?.date ? `${item.start.date}T00:00:00.000Z` : undefined);
      const end = item.end?.dateTime ?? (item.end?.date ? `${item.end.date}T23:59:59.999Z` : undefined);
      if (!start || !end) continue;
      const startMs = new Date(start).getTime();
      const endMs = new Date(end).getTime();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
      busyWindows.push({ start: startMs, end: endMs });
    }

    const slots = slotsForDay(args.date, args.durationMin, args.intervalMin);
    return slots.filter((slot) => {
      const startMs = new Date(slot).getTime();
      const endMs = startMs + args.durationMin * 60_000;
      return !busyWindows.some((busy) => overlap(startMs, endMs, busy.start, busy.end));
    });
  }
}

class CalendlyAdapter implements CalendarProviderAdapter {
  readonly provider: CalendarProviderType = "calendly";

  async createBooking(
    account: CalendarOAuthAccountRecord,
    payload: ProviderBookingPayload,
  ): Promise<ProviderBookingResult> {
    const eventTypeUri = resolveCalendlyEventTypeUri(payload.binding, account);
    if (!payload.customerEmail || !payload.customerName) {
      throw new Error("Calendly booking requires customer_name and customer_email");
    }
    const response = await providerRequest("https://api.calendly.com/invitees", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${account.encryptedAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_type: eventTypeUri,
        start_time: payload.startsAt,
        invitee: {
          name: payload.customerName,
          email: payload.customerEmail,
          timezone: payload.resource.timezone || "America/New_York",
        },
      }),
    });
    if (!response.ok) {
      throw providerError(this.provider, response.status, response.body);
    }
    const body = response.body as { resource?: { event?: string; uri?: string } };
    const eventUri = body.resource?.event || body.resource?.uri;
    if (!eventUri) {
      throw new Error("Calendly booking created without event URI");
    }
    return {
      providerEventId: eventUri,
      providerPayload: body as Record<string, unknown>,
    };
  }

  async updateBooking(
    account: CalendarOAuthAccountRecord,
    payload: ProviderBookingPayload,
  ): Promise<ProviderBookingResult> {
    // Calendly does not expose a straightforward patch for invitee start time.
    // We perform provider-first cancel + recreate to preserve confirmation guarantees.
    if (payload.providerEventId) {
      await this.cancelBooking(account, payload);
    }
    return this.createBooking(account, payload);
  }

  async cancelBooking(
    account: CalendarOAuthAccountRecord,
    payload: ProviderBookingPayload,
  ): Promise<ProviderCancelResult> {
    if (!payload.providerEventId) {
      throw new Error("Missing provider_event_id for Calendly cancel");
    }
    const eventUri = resolveCalendlyEventUri(payload.providerEventId);
    const response = await providerRequest(`${eventUri}/cancellation`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${account.encryptedAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reason: "Cancelled by Rezovo calendar backbone" }),
    });
    if (!response.ok && response.status !== 410 && response.status !== 404) {
      throw providerError(this.provider, response.status, response.body);
    }
    return { providerPayload: response.body as Record<string, unknown> };
  }

  async listAvailability(
    account: CalendarOAuthAccountRecord,
    args: ProviderAvailabilityArgs,
  ): Promise<string[]> {
    const eventTypeUri = resolveCalendlyEventTypeUri(args.binding, account);
    const { startIso, endIso } = normalizeDateBounds(args.date);
    const url = new URL("https://api.calendly.com/event_type_available_times");
    url.searchParams.set("event_type", eventTypeUri);
    url.searchParams.set("start_time", startIso);
    url.searchParams.set("end_time", endIso);

    const response = await providerRequest(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${account.encryptedAccessToken}` },
    });
    if (!response.ok) {
      throw providerError(this.provider, response.status, response.body);
    }
    const body = response.body as CalendlyAvailabilityResponse;
    return (body.collection ?? [])
      .filter((slot) => slot.status === "available" && typeof slot.start_time === "string")
      .map((slot) => slot.start_time as string);
  }
}

const adapters: Record<CalendarProviderType, CalendarProviderAdapter> = {
  google_calendar: new GoogleCalendarAdapter(),
  calendly: new CalendlyAdapter(),
};

export function providerAdapter(provider: CalendarProviderType): CalendarProviderAdapter {
  return adapters[provider];
}

export function isProvider(provider: string): provider is CalendarProviderType {
  return provider === "google_calendar" || provider === "calendly";
}

export function providerScopes(provider: CalendarProviderType): string[] {
  if (provider === "google_calendar") {
    return env.GOOGLE_OAUTH_SCOPES.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  }
  return env.CALENDLY_OAUTH_SCOPES.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
}

export function providerAuthConfig(provider: CalendarProviderType): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authUrl: string;
  tokenUrl: string;
} {
  if (provider === "google_calendar") {
    return {
      clientId: env.GOOGLE_OAUTH_CLIENT_ID.trim(),
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET.trim(),
      redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI.trim(),
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
    };
  }
  return {
    clientId: env.CALENDLY_OAUTH_CLIENT_ID.trim(),
    clientSecret: env.CALENDLY_OAUTH_CLIENT_SECRET.trim(),
    redirectUri: env.CALENDLY_OAUTH_REDIRECT_URI.trim(),
    authUrl: "https://auth.calendly.com/oauth/authorize",
    tokenUrl: "https://auth.calendly.com/oauth/token",
  };
}

export async function providerIdentity(
  provider: CalendarProviderType,
  accessToken: string,
): Promise<{ accountId?: string; accountEmail?: string; metadata?: Record<string, unknown> }> {
  if (provider === "google_calendar") {
    const response = await providerRequest("https://www.googleapis.com/oauth2/v3/userinfo", {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      logger.warn("google userinfo failed", { status: response.status });
      return {};
    }
    const body = response.body as Record<string, unknown>;
    return {
      accountId: typeof body.sub === "string" ? body.sub : undefined,
      accountEmail: typeof body.email === "string" ? body.email : undefined,
      metadata: {
        name: typeof body.name === "string" ? body.name : undefined,
      },
    };
  }

  const response = await providerRequest("https://api.calendly.com/users/me", {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    logger.warn("calendly users/me failed", { status: response.status });
    return {};
  }
  const body = response.body as {
    resource?: { uri?: string; email?: string; name?: string; current_organization?: string };
  };
  const resource = body.resource ?? {};
  return {
    accountId: typeof resource.uri === "string" ? resource.uri : undefined,
    accountEmail: typeof resource.email === "string" ? resource.email : undefined,
    metadata: {
      name: typeof resource.name === "string" ? resource.name : undefined,
      organizationUri:
        typeof resource.current_organization === "string"
          ? resource.current_organization
          : undefined,
    },
  };
}
