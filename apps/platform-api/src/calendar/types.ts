export type CalendarProviderType = "google_calendar" | "calendly";

export type CalendarBookingStatus = "confirmed" | "canceled" | "pending" | "failed";

export type CalendarBookingSource =
  | "local_manual"
  | "voice_agent"
  | "provider_synced"
  | "provider_reconciled";

export type CalendarResourceRecord = {
  id: string;
  orgId: string;
  name: string;
  timezone: string;
  slotIntervalMin: number;
  capacityPerSlot: number;
  providerBinding: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CalendarBookingRecord = {
  id: string;
  orgId: string;
  resourceId: string;
  status: CalendarBookingStatus;
  startsAt: string;
  endsAt: string;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  partySize: number;
  notes?: string | null;
  source: CalendarBookingSource;
  providerType?: CalendarProviderType | null;
  providerEventId?: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type CalendarOAuthAccountRecord = {
  id: string;
  orgId: string;
  provider: CalendarProviderType;
  accountId?: string | null;
  accountEmail?: string | null;
  encryptedAccessToken: string;
  encryptedRefreshToken?: string | null;
  tokenExpiresAt?: string | null;
  scopes: string[];
  metadata: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

/**
 * Same shape as CalendarOAuthAccountRecord but `accessToken` and
 * `refreshToken` are the plaintext values decrypted from at-rest storage.
 * Adapters should depend on this type, never on the encrypted record.
 */
export type CalendarOAuthAccountAuthorized = Omit<
  CalendarOAuthAccountRecord,
  "encryptedAccessToken" | "encryptedRefreshToken"
> & {
  accessToken: string;
  refreshToken: string | null;
};

export type CalendarAvailabilitySlot = {
  startsAt: string;
  endsAt: string;
  remainingCapacity: number;
  providerAvailable: boolean;
};

export type CreateCalendarBookingInput = {
  resourceId?: string;
  startsAt: string;
  endsAt: string;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  partySize?: number;
  notes?: string | null;
  source?: CalendarBookingSource;
  metadata?: Record<string, unknown>;
};

export type UpdateCalendarBookingInput = Partial<{
  resourceId: string;
  startsAt: string;
  endsAt: string;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  partySize: number;
  notes: string | null;
  metadata: Record<string, unknown>;
}>;

export type ProviderBookingPayload = {
  bookingId?: string;
  startsAt: string;
  endsAt: string;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  partySize: number;
  notes?: string | null;
  resource: CalendarResourceRecord;
  binding: Record<string, unknown>;
  providerEventId?: string | null;
};

export type ProviderBookingResult = {
  providerEventId: string;
  providerPayload?: Record<string, unknown>;
};

export type ProviderCancelResult = {
  providerPayload?: Record<string, unknown>;
};
