import { env } from "./env";
import { internalApiHeaders } from "./platformApiAuth";

type CalendarBooking = {
  id: string;
  resourceId: string;
  status: "confirmed" | "canceled" | "pending" | "failed";
  startsAt: string;
  endsAt: string;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  partySize: number;
  notes?: string | null;
  providerType?: "google_calendar" | "calendly" | null;
  providerEventId?: string | null;
};

export type CalendarResource = {
  id: string;
  name: string;
  timezone: string;
  slotIntervalMin: number;
  capacityPerSlot: number;
  isActive: boolean;
};

export type CalendarAvailability = Array<{
  resource: CalendarResource;
  slots: Array<{
    startsAt: string;
    endsAt: string;
    remainingCapacity: number;
    providerAvailable: boolean;
  }>;
}>;

async function api<T>(
  orgId: string,
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
): Promise<T> {
  const url = new URL(path, env.PLATFORM_API_URL);
  url.searchParams.set("orgId", orgId);

  const res = await fetch(url.toString(), {
    method,
    headers: internalApiHeaders({
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    }),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const payload = await res.json().catch(() => ({} as any));
  if (!res.ok) {
    const message =
      payload?.error?.message ??
      `${method} ${path} failed with status ${res.status}`;
    throw new Error(message);
  }

  if (payload && typeof payload === "object" && "data" in payload) {
    return payload.data as T;
  }
  return payload as T;
}

export async function listResources(orgId: string): Promise<CalendarResource[]> {
  return api<CalendarResource[]>(orgId, "GET", "/calendar/resources");
}

export async function getAvailability(
  orgId: string,
  params: { date: string; resourceId?: string; durationMin?: number; partySize?: number },
): Promise<CalendarAvailability> {
  const qs = new URLSearchParams();
  qs.set("date", params.date);
  if (params.resourceId) qs.set("resourceId", params.resourceId);
  if (typeof params.durationMin === "number") qs.set("durationMin", String(params.durationMin));
  if (typeof params.partySize === "number") qs.set("partySize", String(params.partySize));
  return api<CalendarAvailability>(orgId, "GET", `/calendar/availability?${qs.toString()}`);
}

export async function createBooking(
  orgId: string,
  payload: {
    resourceId?: string;
    startsAt: string;
    endsAt: string;
    customerName?: string | null;
    customerPhone?: string | null;
    customerEmail?: string | null;
    partySize?: number;
    notes?: string | null;
    source?: "local_manual" | "voice_agent" | "provider_synced" | "provider_reconciled";
    metadata?: Record<string, unknown>;
  },
): Promise<CalendarBooking> {
  return api<CalendarBooking>(orgId, "POST", "/calendar/bookings", payload);
}

export async function updateBooking(
  orgId: string,
  bookingId: string,
  payload: Partial<{
    resourceId: string;
    startsAt: string;
    endsAt: string;
    customerName: string | null;
    customerPhone: string | null;
    customerEmail: string | null;
    partySize: number;
    notes: string | null;
    metadata: Record<string, unknown>;
  }>,
): Promise<CalendarBooking> {
  return api<CalendarBooking>(
    orgId,
    "PATCH",
    `/calendar/bookings/${encodeURIComponent(bookingId)}`,
    payload,
  );
}

export async function cancelBooking(
  orgId: string,
  bookingId: string,
  reason?: string,
): Promise<CalendarBooking> {
  return api<CalendarBooking>(
    orgId,
    "POST",
    `/calendar/bookings/${encodeURIComponent(bookingId)}/cancel`,
    { reason: reason ?? null },
  );
}

export async function lookupBookings(
  orgId: string,
  payload: {
    name?: string;
    phone?: string;
    date?: string;
    resourceId?: string;
    limit?: number;
    providerEventId?: string;
  },
): Promise<CalendarBooking[]> {
  return api<CalendarBooking[]>(orgId, "POST", "/calendar/bookings/lookup", payload);
}
