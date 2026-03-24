import { createLogger } from "@rezovo/logging";

const logger = createLogger({ service: "realtime-core", module: "calendly" });

const BASE_URL = "https://api.calendly.com";

let cachedEventTypeUri: string | null = null;
let cachedOrgUri: string | null = null;

class CalendlyApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly bodySnippet?: string;

  constructor(params: { status: number; statusText: string; path: string; bodySnippet?: string }) {
    super(`Calendly API ${params.status}: ${params.statusText}`);
    this.name = "CalendlyApiError";
    this.status = params.status;
    this.path = params.path;
    this.bodySnippet = params.bodySnippet;
  }
}

function getCalendlyErrorMeta(err: unknown): { status?: number; path?: string; message: string } {
  if (err instanceof CalendlyApiError) {
    return { status: err.status, path: err.path, message: err.message };
  }
  if (err instanceof Error) return { message: err.message };
  return { message: String(err) };
}

export type CalendlyAvailableTime = {
  status: string;
  start_time: string;
  invitees_remaining: number;
  scheduling_url?: string;
};

export type CalendlyEventType = {
  uri: string;
  name: string;
  slug: string;
  active: boolean;
  duration: number;
  kind: string;
  scheduling_url: string;
};

export type CalendlyInvitee = {
  uri: string;
  email: string;
  name: string;
  status: string;
  timezone: string;
  event: string;
  cancel_url: string;
  reschedule_url: string;
  created_at: string;
  updated_at: string;
};

export type CalendlyScheduledEvent = {
  uri: string;
  name: string;
  status: string;
  start_time: string;
  end_time: string;
  event_type: string;
  location?: { type: string; location?: string };
  cancel_url?: string;
  reschedule_url?: string;
};

async function calendlyFetch<T>(
  path: string,
  accessToken: string,
  options?: RequestInit
): Promise<T> {
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const bodySnippet = body.slice(0, 500);
    logger.error("calendly api error", { status: res.status, path, body: bodySnippet });
    throw new CalendlyApiError({
      status: res.status,
      statusText: res.statusText,
      path,
      bodySnippet,
    });
  }

  return (await res.json()) as T;
}

/**
 * Resolve the organization URI for this token. Cached after first call.
 */
export async function resolveOrganizationUri(accessToken: string): Promise<string> {
  if (cachedOrgUri) return cachedOrgUri;

  try {
    const userRes = await calendlyFetch<{ resource: { uri: string; current_organization: string } }>(
      "/users/me",
      accessToken
    );
    cachedOrgUri = userRes.resource.current_organization;
    logger.info("calendly org resolved", { org: cachedOrgUri });
    return cachedOrgUri;
  } catch (err) {
    const meta = getCalendlyErrorMeta(err);
    logger.error("resolveOrganizationUri failed", meta);
    throw err;
  }
}

/**
 * Auto-discover the first active event type URI for this account.
 * Cached after first resolution so subsequent calls are instant.
 */
export async function resolveEventTypeUri(accessToken: string): Promise<string> {
  if (cachedEventTypeUri) return cachedEventTypeUri;

  try {
    const orgUri = await resolveOrganizationUri(accessToken);
    const types = await getEventTypes(accessToken, orgUri);

    if (types.length === 0) {
      throw new Error("No active event types found on this Calendly account. Create one in Calendly settings.");
    }

    cachedEventTypeUri = types[0].uri;
    logger.info("calendly event type auto-resolved", {
      name: types[0].name,
      duration: types[0].duration,
      uri: cachedEventTypeUri,
      totalActive: types.length,
    });
    return cachedEventTypeUri;
  } catch (err) {
    const meta = getCalendlyErrorMeta(err);
    logger.error("resolveEventTypeUri failed", meta);
    throw err;
  }
}

export async function getEventTypes(
  accessToken: string,
  organizationUri?: string
): Promise<CalendlyEventType[]> {
  try {
    const orgUri = organizationUri || await resolveOrganizationUri(accessToken);

    const res = await calendlyFetch<{ collection: CalendlyEventType[] }>(
      `/event_types?organization=${encodeURIComponent(orgUri)}&active=true`,
      accessToken
    );

    return res.collection;
  } catch (err) {
    const meta = getCalendlyErrorMeta(err);
    logger.error("getEventTypes failed", meta);
    throw err;
  }
}

export async function getAvailableTimes(
  accessToken: string,
  eventTypeUri: string,
  startTime: string,
  endTime: string
): Promise<CalendlyAvailableTime[]> {
  try {
    const params = new URLSearchParams({
      event_type: eventTypeUri,
      start_time: startTime,
      end_time: endTime,
    });

    const res = await calendlyFetch<{ collection: CalendlyAvailableTime[] }>(
      `/event_type_available_times?${params.toString()}`,
      accessToken
    );

    return res.collection.filter((t) => t.status === "available");
  } catch (err) {
    const meta = getCalendlyErrorMeta(err);
    logger.error("getAvailableTimes failed", meta);
    throw err;
  }
}

export async function createInvitee(
  accessToken: string,
  params: {
    eventTypeUri: string;
    startTime: string;
    inviteeName: string;
    inviteeEmail: string;
    inviteeTimezone: string;
    locationKind?: string;
    locationValue?: string;
    phoneNumber?: string;
    eventGuests?: string[];
  }
): Promise<CalendlyInvitee> {
  try {
    const body: Record<string, unknown> = {
      event_type: params.eventTypeUri,
      start_time: params.startTime,
      invitee: {
        name: params.inviteeName,
        email: params.inviteeEmail,
        timezone: params.inviteeTimezone,
      },
    };

    if (params.locationKind) {
      body.location = {
        kind: params.locationKind,
        ...(params.locationValue ? { location: params.locationValue } : {}),
      };
    }

    if (params.phoneNumber) {
      (body.invitee as Record<string, unknown>).text_reminder_number = params.phoneNumber;
    }

    if (params.eventGuests?.length) {
      body.event_guests = params.eventGuests.map((email) => ({ email }));
    }

    body.tracking = { utm_source: "rezovo_ai_agent" };

    const res = await calendlyFetch<{ resource: CalendlyInvitee }>(
      "/invitees",
      accessToken,
      { method: "POST", body: JSON.stringify(body) }
    );

    logger.info("calendly booking created", {
      invitee: params.inviteeName,
      event: res.resource.event,
    });

    return res.resource;
  } catch (err) {
    const meta = getCalendlyErrorMeta(err);
    logger.error("createInvitee failed", meta);
    throw err;
  }
}

export async function getScheduledEvent(
  accessToken: string,
  eventUri: string
): Promise<CalendlyScheduledEvent> {
  try {
    const res = await calendlyFetch<{ resource: CalendlyScheduledEvent }>(
      eventUri,
      accessToken
    );
    return res.resource;
  } catch (err) {
    const meta = getCalendlyErrorMeta(err);
    logger.error("getScheduledEvent failed", meta);
    throw err;
  }
}

export async function cancelEvent(
  accessToken: string,
  eventUri: string,
  reason?: string
): Promise<void> {
  try {
    await calendlyFetch<unknown>(
      `${eventUri}/cancellation`,
      accessToken,
      {
        method: "POST",
        body: JSON.stringify({ reason: reason || "Cancelled by AI agent on caller request" }),
      }
    );

    logger.info("calendly event cancelled", { eventUri });
  } catch (err) {
    const meta = getCalendlyErrorMeta(err);
    logger.error("cancelEvent failed", meta);
    throw err;
  }
}

/**
 * Fetch a user's availability schedule by UUID.
 * GET https://api.calendly.com/user_availability_schedules/{uuid}
 */
export async function getUserAvailabilitySchedule(
  accessToken: string,
  uuid: string
): Promise<unknown> {
  const path = `/user_availability_schedules/${encodeURIComponent(uuid)}`;
  try {
    return await calendlyFetch<unknown>(path, accessToken);
  } catch (err) {
    const meta = getCalendlyErrorMeta(err);
    logger.error("getUserAvailabilitySchedule failed", { uuid, ...meta });
    throw err;
  }
}
