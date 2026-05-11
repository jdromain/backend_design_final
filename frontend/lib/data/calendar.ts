import { appendOrgQuery, get, patch, post } from "@/lib/api-client"

export type CalendarProviderType = "google_calendar" | "calendly"

export type CalendarResource = {
  id: string
  orgId: string
  name: string
  timezone: string
  slotIntervalMin: number
  capacityPerSlot: number
  providerBinding: Record<string, unknown>
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type CalendarBookingStatus = "confirmed" | "canceled" | "pending" | "failed"

export type CalendarBooking = {
  id: string
  orgId: string
  resourceId: string
  status: CalendarBookingStatus
  startsAt: string
  endsAt: string
  customerName?: string | null
  customerPhone?: string | null
  customerEmail?: string | null
  partySize: number
  notes?: string | null
  source: "local_manual" | "voice_agent" | "provider_synced" | "provider_reconciled"
  providerType?: CalendarProviderType | null
  providerEventId?: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type CalendarAvailability = Array<{
  resource: CalendarResource
  slots: Array<{
    startsAt: string
    endsAt: string
    remainingCapacity: number
    providerAvailable: boolean
  }>
}>

export async function getCalendarResources() {
  return get<CalendarResource[]>(appendOrgQuery("/calendar/resources"))
}

export async function createCalendarResource(input: {
  name: string
  timezone?: string
  slotIntervalMin?: number
  capacityPerSlot?: number
  providerBinding?: Record<string, unknown>
  isActive?: boolean
}) {
  return post<CalendarResource>(appendOrgQuery("/calendar/resources"), input)
}

export async function updateCalendarResource(
  resourceId: string,
  input: Partial<{
    name: string
    timezone: string
    slotIntervalMin: number
    capacityPerSlot: number
    providerBinding: Record<string, unknown>
    isActive: boolean
  }>,
) {
  return patch<CalendarResource>(
    appendOrgQuery(`/calendar/resources/${encodeURIComponent(resourceId)}`),
    input,
  )
}

export async function getCalendarBookings(params: {
  from?: string
  to?: string
  resourceId?: string
  status?: string
  customerPhone?: string
  customerName?: string
}) {
  const qs = new URLSearchParams()
  if (params.from) qs.set("from", params.from)
  if (params.to) qs.set("to", params.to)
  if (params.resourceId) qs.set("resourceId", params.resourceId)
  if (params.status) qs.set("status", params.status)
  if (params.customerPhone) qs.set("customerPhone", params.customerPhone)
  if (params.customerName) qs.set("customerName", params.customerName)
  const path = qs.size > 0 ? `/calendar/bookings?${qs.toString()}` : "/calendar/bookings"
  return get<CalendarBooking[]>(appendOrgQuery(path))
}

export async function lookupCalendarBookings(input: {
  name?: string
  phone?: string
  date?: string
  resourceId?: string
  limit?: number
  providerEventId?: string
}) {
  return post<CalendarBooking[]>(
    appendOrgQuery("/calendar/bookings/lookup"),
    input,
  )
}

export async function createCalendarBooking(input: {
  resourceId?: string
  startsAt: string
  endsAt: string
  customerName?: string | null
  customerPhone?: string | null
  customerEmail?: string | null
  partySize?: number
  notes?: string | null
  source?: "local_manual" | "voice_agent" | "provider_synced" | "provider_reconciled"
  metadata?: Record<string, unknown>
}) {
  return post<CalendarBooking>(appendOrgQuery("/calendar/bookings"), input)
}

export async function updateCalendarBooking(
  bookingId: string,
  input: Partial<{
    resourceId: string
    startsAt: string
    endsAt: string
    customerName: string | null
    customerPhone: string | null
    customerEmail: string | null
    partySize: number
    notes: string | null
    metadata: Record<string, unknown>
  }>,
) {
  return patch<CalendarBooking>(
    appendOrgQuery(`/calendar/bookings/${encodeURIComponent(bookingId)}`),
    input,
  )
}

export async function cancelCalendarBooking(bookingId: string, reason?: string) {
  return post<CalendarBooking>(
    appendOrgQuery(`/calendar/bookings/${encodeURIComponent(bookingId)}/cancel`),
    { reason: reason ?? null },
  )
}

export async function getCalendarAvailability(params: {
  date: string
  resourceId?: string
  durationMin?: number
  partySize?: number
}) {
  const qs = new URLSearchParams()
  qs.set("date", params.date)
  if (params.resourceId) qs.set("resourceId", params.resourceId)
  if (typeof params.durationMin === "number") qs.set("durationMin", String(params.durationMin))
  if (typeof params.partySize === "number") qs.set("partySize", String(params.partySize))
  return get<CalendarAvailability>(appendOrgQuery(`/calendar/availability?${qs.toString()}`))
}
