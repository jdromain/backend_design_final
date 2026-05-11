import { randomBytes, randomUUID, createHash } from "crypto";
import { createLogger } from "@rezovo/logging";
import { query, withTransaction } from "../persistence/dbClient";
import { decryptToken, encryptToken } from "../lib/tokenCrypto";
import {
  isProvider,
  providerAdapter,
  providerAuthConfig,
  providerIdentity,
  providerScopes,
} from "./providers";
import {
  CalendarAvailabilitySlot,
  CalendarBookingRecord,
  CalendarBookingSource,
  CalendarOAuthAccountRecord,
  CalendarProviderType,
  CalendarResourceRecord,
  CreateCalendarBookingInput,
  UpdateCalendarBookingInput,
} from "./types";

const logger = createLogger({ service: "platform-api", module: "calendarService" });

const OAUTH_STATE_TTL_MINUTES = 15;
const TOKEN_REFRESH_WINDOW_SECONDS = 600;
const DEFAULT_SLOT_INTERVAL_MIN = 10;
const DEFAULT_DAY_DURATION_MIN = 30;
const LOCAL_AVAILABILITY_MAX_SLOTS = 600;
const RECONCILE_GOOGLE_LOOKAHEAD_DAYS = 30;

type DomainErrorCode =
  | "bad_request"
  | "not_found"
  | "capacity_exceeded"
  | "provider_error"
  | "oauth_not_configured"
  | "oauth_state_invalid"
  | "oauth_exchange_failed"
  | "refresh_failed"
  | "provider_not_connected";

export class CalendarDomainError extends Error {
  readonly status: number;
  readonly code: DomainErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: DomainErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type DecryptedOAuthAccount = CalendarOAuthAccountRecord & {
  accessToken: string;
  refreshToken?: string | null;
};

function parseIsoOrThrow(value: string, field: string): string {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) {
    throw new CalendarDomainError(400, "bad_request", `Invalid ${field}`);
  }
  return d.toISOString();
}

function normalizeMetadata(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
}

function normalizeDateOnly(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new CalendarDomainError(400, "bad_request", "date must be YYYY-MM-DD");
  }
  return value;
}

function mapResourceRow(row: any): CalendarResourceRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    timezone: row.timezone,
    slotIntervalMin: row.slot_interval_min,
    capacityPerSlot: row.capacity_per_slot,
    providerBinding: normalizeMetadata(row.provider_binding),
    isActive: !!row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBookingRow(row: any): CalendarBookingRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    resourceId: row.resource_id,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    customerEmail: row.customer_email,
    partySize: row.party_size,
    notes: row.notes,
    source: row.source,
    providerType: row.provider_type,
    providerEventId: row.provider_event_id,
    metadata: normalizeMetadata(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapOAuthRow(row: any): CalendarOAuthAccountRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    provider: row.provider,
    accountId: row.account_id,
    accountEmail: row.account_email,
    encryptedAccessToken: row.encrypted_access_token,
    encryptedRefreshToken: row.encrypted_refresh_token,
    tokenExpiresAt: row.token_expires_at,
    scopes: Array.isArray(row.scopes) ? row.scopes.filter((x: unknown) => typeof x === "string") : [],
    metadata: normalizeMetadata(row.metadata),
    isActive: !!row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function oauthChallenge(verifier: string): string {
  const digest = createHash("sha256").update(verifier).digest();
  return digest.toString("base64url");
}

function oauthVerifier(): string {
  return randomBytes(32).toString("base64url");
}

function oauthState(): string {
  return randomBytes(32).toString("base64url");
}

function futureIso(secondsFromNow: number): string {
  return new Date(Date.now() + secondsFromNow * 1000).toISOString();
}

function toMillis(value: string): number {
  return new Date(value).getTime();
}

function slotSeries(date: string, intervalMin: number, durationMin: number): Array<{ startsAt: string; endsAt: string }> {
  const startMs = new Date(`${date}T00:00:00.000Z`).getTime();
  const endMs = new Date(`${date}T23:59:59.999Z`).getTime();
  const intervalMs = intervalMin * 60_000;
  const durationMs = durationMin * 60_000;
  const slots: Array<{ startsAt: string; endsAt: string }> = [];
  for (let t = startMs; t + durationMs <= endMs && slots.length < LOCAL_AVAILABILITY_MAX_SLOTS; t += intervalMs) {
    slots.push({
      startsAt: new Date(t).toISOString(),
      endsAt: new Date(t + durationMs).toISOString(),
    });
  }
  return slots;
}

async function jsonOrText(res: Response): Promise<unknown> {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    return res.json().catch(() => ({}));
  }
  return res.text().catch(() => "");
}

const refreshLocks = new Map<string, Promise<CalendarOAuthAccountRecord>>();

async function withRefreshLock(
  key: string,
  fn: () => Promise<CalendarOAuthAccountRecord>,
): Promise<CalendarOAuthAccountRecord> {
  const existing = refreshLocks.get(key);
  if (existing) return existing;
  const next = fn().finally(() => refreshLocks.delete(key));
  refreshLocks.set(key, next);
  return next;
}

export class CalendarService {
  async listResources(orgId: string): Promise<CalendarResourceRecord[]> {
    const result = await query(
      `SELECT *
       FROM calendar_resources
       WHERE org_id = $1
       ORDER BY created_at DESC`,
      [orgId],
    );
    return result.rows.map(mapResourceRow);
  }

  async createResource(
    orgId: string,
    input: {
      name: string;
      timezone?: string;
      slotIntervalMin?: number;
      capacityPerSlot?: number;
      providerBinding?: Record<string, unknown>;
      isActive?: boolean;
    },
  ): Promise<CalendarResourceRecord> {
    const name = input.name?.trim();
    if (!name) {
      throw new CalendarDomainError(400, "bad_request", "name is required");
    }
    const timezone = input.timezone?.trim() || "America/New_York";
    const slotIntervalMin = Number.isFinite(input.slotIntervalMin) && (input.slotIntervalMin as number) > 0
      ? Math.floor(input.slotIntervalMin as number)
      : DEFAULT_SLOT_INTERVAL_MIN;
    const capacityPerSlot = Number.isFinite(input.capacityPerSlot) && (input.capacityPerSlot as number) > 0
      ? Math.floor(input.capacityPerSlot as number)
      : 1;
    const providerBinding = normalizeMetadata(input.providerBinding);
    const isActive = input.isActive !== false;

    const result = await query(
      `INSERT INTO calendar_resources (
         id, org_id, name, timezone, slot_interval_min, capacity_per_slot, provider_binding, is_active
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        randomUUID(),
        orgId,
        name,
        timezone,
        slotIntervalMin,
        capacityPerSlot,
        JSON.stringify(providerBinding),
        isActive,
      ],
    );
    return mapResourceRow(result.rows[0]);
  }

  async updateResource(
    orgId: string,
    resourceId: string,
    input: Partial<{
      name: string;
      timezone: string;
      slotIntervalMin: number;
      capacityPerSlot: number;
      providerBinding: Record<string, unknown>;
      isActive: boolean;
    }>,
  ): Promise<CalendarResourceRecord> {
    const clauses: string[] = [];
    const values: unknown[] = [orgId, resourceId];
    let i = 3;

    if (typeof input.name === "string" && input.name.trim().length > 0) {
      clauses.push(`name = $${i++}`);
      values.push(input.name.trim());
    }
    if (typeof input.timezone === "string" && input.timezone.trim().length > 0) {
      clauses.push(`timezone = $${i++}`);
      values.push(input.timezone.trim());
    }
    if (typeof input.slotIntervalMin === "number" && Number.isFinite(input.slotIntervalMin) && input.slotIntervalMin > 0) {
      clauses.push(`slot_interval_min = $${i++}`);
      values.push(Math.floor(input.slotIntervalMin));
    }
    if (typeof input.capacityPerSlot === "number" && Number.isFinite(input.capacityPerSlot) && input.capacityPerSlot > 0) {
      clauses.push(`capacity_per_slot = $${i++}`);
      values.push(Math.floor(input.capacityPerSlot));
    }
    if (typeof input.isActive === "boolean") {
      clauses.push(`is_active = $${i++}`);
      values.push(input.isActive);
    }
    if (input.providerBinding && typeof input.providerBinding === "object" && !Array.isArray(input.providerBinding)) {
      clauses.push(`provider_binding = $${i++}::jsonb`);
      values.push(JSON.stringify(input.providerBinding));
    }

    if (clauses.length === 0) {
      throw new CalendarDomainError(400, "bad_request", "No fields to update");
    }

    const result = await query(
      `UPDATE calendar_resources
       SET ${clauses.join(", ")}, updated_at = now()
       WHERE org_id = $1 AND id = $2
       RETURNING *`,
      values,
    );
    if (result.rowCount === 0) {
      throw new CalendarDomainError(404, "not_found", "Resource not found");
    }
    return mapResourceRow(result.rows[0]);
  }

  private async getResource(orgId: string, resourceId: string): Promise<CalendarResourceRecord> {
    const result = await query(
      `SELECT *
       FROM calendar_resources
       WHERE org_id = $1 AND id = $2
       LIMIT 1`,
      [orgId, resourceId],
    );
    if (result.rowCount === 0) {
      throw new CalendarDomainError(404, "not_found", "Resource not found");
    }
    return mapResourceRow(result.rows[0]);
  }

  private async resolveBookingResource(
    orgId: string,
    resourceId?: string,
  ): Promise<CalendarResourceRecord> {
    if (resourceId && resourceId.trim().length > 0) {
      return this.getResource(orgId, resourceId.trim());
    }

    const active = await query(
      `SELECT *
       FROM calendar_resources
       WHERE org_id = $1 AND is_active = true
       ORDER BY created_at ASC
       LIMIT 1`,
      [orgId],
    );
    if (active.rowCount && active.rows[0]) {
      return mapResourceRow(active.rows[0]);
    }

    const anyResource = await query(
      `SELECT *
       FROM calendar_resources
       WHERE org_id = $1
       ORDER BY created_at ASC
       LIMIT 1`,
      [orgId],
    );
    if (anyResource.rowCount && anyResource.rows[0]) {
      return mapResourceRow(anyResource.rows[0]);
    }

    throw new CalendarDomainError(
      400,
      "bad_request",
      "No calendar resource is configured. Create a resource before booking.",
    );
  }

  private async getBooking(orgId: string, bookingId: string): Promise<CalendarBookingRecord> {
    const result = await query(
      `SELECT *
       FROM calendar_bookings
       WHERE org_id = $1 AND id = $2
       LIMIT 1`,
      [orgId, bookingId],
    );
    if (result.rowCount === 0) {
      throw new CalendarDomainError(404, "not_found", "Booking not found");
    }
    return mapBookingRow(result.rows[0]);
  }

  async listBookings(
    orgId: string,
    filters: Partial<{
      from: string;
      to: string;
      resourceId: string;
      status: string;
      customerPhone: string;
      customerName: string;
    }>,
  ): Promise<CalendarBookingRecord[]> {
    const clauses = [`org_id = $1`];
    const values: unknown[] = [orgId];
    let i = 2;
    if (filters.from) {
      clauses.push(`starts_at >= $${i++}::timestamptz`);
      values.push(parseIsoOrThrow(filters.from, "from"));
    }
    if (filters.to) {
      clauses.push(`starts_at <= $${i++}::timestamptz`);
      values.push(parseIsoOrThrow(filters.to, "to"));
    }
    if (filters.resourceId) {
      clauses.push(`resource_id = $${i++}::uuid`);
      values.push(filters.resourceId);
    }
    if (filters.status) {
      clauses.push(`status = $${i++}`);
      values.push(filters.status);
    }
    if (filters.customerPhone) {
      clauses.push(`customer_phone ILIKE $${i++}`);
      values.push(`%${filters.customerPhone.trim()}%`);
    }
    if (filters.customerName) {
      clauses.push(`customer_name ILIKE $${i++}`);
      values.push(`%${filters.customerName.trim()}%`);
    }

    const result = await query(
      `SELECT *
       FROM calendar_bookings
       WHERE ${clauses.join(" AND ")}
       ORDER BY starts_at ASC`,
      values,
    );
    return result.rows.map(mapBookingRow);
  }

  private async activeProvider(orgId: string): Promise<DecryptedOAuthAccount | null> {
    const result = await query(
      `SELECT *
       FROM calendar_oauth_accounts
       WHERE org_id = $1 AND is_active = true
       LIMIT 1`,
      [orgId],
    );
    if (result.rowCount === 0) return null;
    const row = mapOAuthRow(result.rows[0]);
    return {
      ...row,
      accessToken: decryptToken(row.encryptedAccessToken),
      refreshToken: row.encryptedRefreshToken ? decryptToken(row.encryptedRefreshToken) : null,
    };
  }

  private async providerByType(orgId: string, provider: CalendarProviderType): Promise<DecryptedOAuthAccount | null> {
    const result = await query(
      `SELECT *
       FROM calendar_oauth_accounts
       WHERE org_id = $1 AND provider = $2
       LIMIT 1`,
      [orgId, provider],
    );
    if (result.rowCount === 0) return null;
    const row = mapOAuthRow(result.rows[0]);
    return {
      ...row,
      accessToken: decryptToken(row.encryptedAccessToken),
      refreshToken: row.encryptedRefreshToken ? decryptToken(row.encryptedRefreshToken) : null,
    };
  }

  async listProviderAccounts(orgId: string): Promise<CalendarOAuthAccountRecord[]> {
    const result = await query(
      `SELECT *
       FROM calendar_oauth_accounts
       WHERE org_id = $1
       ORDER BY provider ASC`,
      [orgId],
    );
    return result.rows.map(mapOAuthRow);
  }

  async setActiveProvider(orgId: string, provider: CalendarProviderType): Promise<CalendarOAuthAccountRecord> {
    const updated = await withTransaction(async (client) => {
      await client.query(`UPDATE calendar_oauth_accounts SET is_active = false, updated_at = now() WHERE org_id = $1`, [orgId]);
      const result = await client.query(
        `UPDATE calendar_oauth_accounts
         SET is_active = true, updated_at = now()
         WHERE org_id = $1 AND provider = $2
         RETURNING *`,
        [orgId, provider],
      );
      return result.rows[0] ?? null;
    });
    if (!updated) {
      throw new CalendarDomainError(404, "provider_not_connected", "Provider account not connected");
    }
    return mapOAuthRow(updated);
  }

  async disconnectProvider(orgId: string, provider: CalendarProviderType): Promise<void> {
    await query(
      `UPDATE calendar_oauth_accounts
       SET is_active = false,
           encrypted_access_token = '',
           encrypted_refresh_token = NULL,
           token_expires_at = NULL,
           updated_at = now()
       WHERE org_id = $1 AND provider = $2`,
      [orgId, provider],
    );
  }

  private async ensureCapacity(
    orgId: string,
    resourceId: string,
    startsAtIso: string,
    bookingIdToIgnore?: string,
  ): Promise<void> {
    const resource = await this.getResource(orgId, resourceId);
    const params: unknown[] = [orgId, resourceId, startsAtIso];
    let sql =
      `SELECT COUNT(*)::int AS count
       FROM calendar_bookings
       WHERE org_id = $1
         AND resource_id = $2
         AND starts_at = $3::timestamptz
         AND status IN ('confirmed', 'pending')`;
    if (bookingIdToIgnore) {
      params.push(bookingIdToIgnore);
      sql += ` AND id <> $4::uuid`;
    }
    const result = await query(sql, params);
    const count = Number(result.rows[0]?.count ?? 0);
    if (count >= resource.capacityPerSlot) {
      throw new CalendarDomainError(409, "capacity_exceeded", "Requested time is at capacity", {
        resourceId,
        startsAt: startsAtIso,
        capacityPerSlot: resource.capacityPerSlot,
      });
    }
  }

  private async insertBookingEvent(params: {
    bookingId?: string | null;
    orgId: string;
    resourceId?: string | null;
    eventType: "create" | "update" | "cancel" | "sync" | "provider_error" | "oauth_refresh";
    providerType?: CalendarProviderType | null;
    providerLatencyMs?: number;
    totalLatencyMs?: number;
    result: "success" | "failure";
    errorCode?: string;
    errorMessage?: string;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    await query(
      `INSERT INTO calendar_booking_events (
         id, booking_id, org_id, resource_id, event_type, provider_type,
         provider_latency_ms, total_latency_ms, result, error_code, error_message, payload
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb
       )`,
      [
        randomUUID(),
        params.bookingId ?? null,
        params.orgId,
        params.resourceId ?? null,
        params.eventType,
        params.providerType ?? null,
        params.providerLatencyMs ?? null,
        params.totalLatencyMs ?? null,
        params.result,
        params.errorCode ?? null,
        params.errorMessage ?? null,
        JSON.stringify(params.payload ?? {}),
      ],
    );
  }

  async createBooking(orgId: string, input: CreateCalendarBookingInput): Promise<CalendarBookingRecord> {
    const startedAt = Date.now();
    const resource = await this.resolveBookingResource(orgId, input.resourceId);
    const startsAt = parseIsoOrThrow(input.startsAt, "startsAt");
    const endsAt = parseIsoOrThrow(input.endsAt, "endsAt");
    if (toMillis(endsAt) <= toMillis(startsAt)) {
      throw new CalendarDomainError(400, "bad_request", "endsAt must be after startsAt");
    }
    await this.ensureCapacity(orgId, resource.id, startsAt);

    const activeProvider = await this.activeProvider(orgId);
    let providerEventId: string | null = null;
    let providerType: CalendarProviderType | null = null;
    let providerPayload: Record<string, unknown> | undefined;
    let providerLatencyMs = 0;

    const partySize = Math.max(1, Math.floor(input.partySize ?? 1));
    const source: CalendarBookingSource = activeProvider
      ? "provider_synced"
      : (input.source ?? "local_manual");

    if (activeProvider) {
      providerType = activeProvider.provider;
      const adapter = providerAdapter(activeProvider.provider);
      const providerStart = Date.now();
      try {
        const created = await adapter.createBooking(
          {
            ...activeProvider,
            encryptedAccessToken: activeProvider.accessToken,
            encryptedRefreshToken: activeProvider.refreshToken ?? null,
          },
          {
            startsAt,
            endsAt,
            customerName: input.customerName ?? null,
            customerPhone: input.customerPhone ?? null,
            customerEmail: input.customerEmail ?? null,
            partySize,
            notes: input.notes ?? null,
            resource,
            binding: resource.providerBinding,
          },
        );
        providerEventId = created.providerEventId;
        providerPayload = created.providerPayload;
      } catch (error) {
        providerLatencyMs = Date.now() - providerStart;
        await this.insertBookingEvent({
          orgId,
          resourceId: resource.id,
          eventType: "provider_error",
          providerType: activeProvider.provider,
          providerLatencyMs,
          totalLatencyMs: Date.now() - startedAt,
          result: "failure",
          errorCode: "provider_create_failed",
          errorMessage: error instanceof Error ? error.message : String(error),
          payload: { startsAt, endsAt },
        });
        throw new CalendarDomainError(
          502,
          "provider_error",
          error instanceof Error ? error.message : "Provider create failed",
        );
      }
      providerLatencyMs = Date.now() - providerStart;
    }

    const result = await query(
      `INSERT INTO calendar_bookings (
         id, org_id, resource_id, status, starts_at, ends_at,
         customer_name, customer_phone, customer_email, party_size, notes,
         source, provider_type, provider_event_id, metadata
       ) VALUES (
         $1,$2,$3,'confirmed',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb
       )
       RETURNING *`,
      [
        randomUUID(),
        orgId,
        resource.id,
        startsAt,
        endsAt,
        input.customerName ?? null,
        input.customerPhone ?? null,
        input.customerEmail ?? null,
        partySize,
        input.notes ?? null,
        source,
        providerType,
        providerEventId,
        JSON.stringify(input.metadata ?? {}),
      ],
    );

    const booking = mapBookingRow(result.rows[0]);
    await this.insertBookingEvent({
      bookingId: booking.id,
      orgId,
      resourceId: booking.resourceId,
      eventType: "create",
      providerType,
      providerLatencyMs: providerType ? providerLatencyMs : 0,
      totalLatencyMs: Date.now() - startedAt,
      result: "success",
      payload: {
        source,
        providerPayload,
      },
    });

    logger.info("calendar booking created", {
      orgId,
      bookingId: booking.id,
      resourceId: booking.resourceId,
      provider: providerType ?? "none",
      action: "create",
      providerLatencyMs: providerType ? providerLatencyMs : 0,
      totalLatencyMs: Date.now() - startedAt,
      result: "success",
      errorCode: null,
    });
    return booking;
  }

  async updateBooking(
    orgId: string,
    bookingId: string,
    input: UpdateCalendarBookingInput,
  ): Promise<CalendarBookingRecord> {
    const startedAt = Date.now();
    const existing = await this.getBooking(orgId, bookingId);
    const resource = await this.getResource(orgId, input.resourceId ?? existing.resourceId);
    const startsAt = input.startsAt ? parseIsoOrThrow(input.startsAt, "startsAt") : existing.startsAt;
    const endsAt = input.endsAt ? parseIsoOrThrow(input.endsAt, "endsAt") : existing.endsAt;
    if (toMillis(endsAt) <= toMillis(startsAt)) {
      throw new CalendarDomainError(400, "bad_request", "endsAt must be after startsAt");
    }

    if (startsAt !== existing.startsAt || resource.id !== existing.resourceId) {
      await this.ensureCapacity(orgId, resource.id, startsAt, existing.id);
    }

    const partySize = typeof input.partySize === "number" && input.partySize > 0
      ? Math.floor(input.partySize)
      : existing.partySize;
    const customerName = input.customerName !== undefined ? input.customerName : existing.customerName;
    const customerPhone = input.customerPhone !== undefined ? input.customerPhone : existing.customerPhone;
    const customerEmail = input.customerEmail !== undefined ? input.customerEmail : existing.customerEmail;
    const notes = input.notes !== undefined ? input.notes : existing.notes;
    const mergedMetadata = {
      ...existing.metadata,
      ...(input.metadata ?? {}),
    };

    let providerLatencyMs = 0;
    let nextProviderEventId = existing.providerEventId ?? null;
    let providerPayload: Record<string, unknown> | undefined;
    const providerType = existing.providerType ?? null;

    if (providerType) {
      const account = await this.providerByType(orgId, providerType);
      if (!account) {
        throw new CalendarDomainError(409, "provider_not_connected", "Provider account missing for this booking");
      }
      const adapter = providerAdapter(providerType);
      const providerStart = Date.now();
      try {
        const updated = await adapter.updateBooking(
          {
            ...account,
            encryptedAccessToken: account.accessToken,
            encryptedRefreshToken: account.refreshToken ?? null,
          },
          {
            bookingId: existing.id,
            startsAt,
            endsAt,
            customerName,
            customerPhone,
            customerEmail,
            partySize,
            notes,
            resource,
            binding: resource.providerBinding,
            providerEventId: existing.providerEventId ?? null,
          },
        );
        nextProviderEventId = updated.providerEventId;
        providerPayload = updated.providerPayload;
      } catch (error) {
        providerLatencyMs = Date.now() - providerStart;
        await this.insertBookingEvent({
          bookingId: existing.id,
          orgId,
          resourceId: resource.id,
          eventType: "provider_error",
          providerType,
          providerLatencyMs,
          totalLatencyMs: Date.now() - startedAt,
          result: "failure",
          errorCode: "provider_update_failed",
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        throw new CalendarDomainError(
          502,
          "provider_error",
          error instanceof Error ? error.message : "Provider update failed",
        );
      }
      providerLatencyMs = Date.now() - providerStart;
    }

    const updatedResult = await query(
      `UPDATE calendar_bookings
       SET resource_id = $3,
           starts_at = $4,
           ends_at = $5,
           customer_name = $6,
           customer_phone = $7,
           customer_email = $8,
           party_size = $9,
           notes = $10,
           provider_event_id = $11,
           metadata = $12::jsonb,
           updated_at = now()
       WHERE org_id = $1 AND id = $2
       RETURNING *`,
      [
        orgId,
        existing.id,
        resource.id,
        startsAt,
        endsAt,
        customerName ?? null,
        customerPhone ?? null,
        customerEmail ?? null,
        partySize,
        notes ?? null,
        nextProviderEventId,
        JSON.stringify(mergedMetadata),
      ],
    );

    const booking = mapBookingRow(updatedResult.rows[0]);
    await this.insertBookingEvent({
      bookingId: booking.id,
      orgId,
      resourceId: booking.resourceId,
      eventType: "update",
      providerType,
      providerLatencyMs,
      totalLatencyMs: Date.now() - startedAt,
      result: "success",
      payload: { providerPayload },
    });

    logger.info("calendar booking updated", {
      orgId,
      bookingId: booking.id,
      resourceId: booking.resourceId,
      provider: providerType ?? "none",
      action: "update",
      providerLatencyMs,
      totalLatencyMs: Date.now() - startedAt,
      result: "success",
      errorCode: null,
    });

    return booking;
  }

  async cancelBooking(
    orgId: string,
    bookingId: string,
    reason?: string,
  ): Promise<CalendarBookingRecord> {
    const startedAt = Date.now();
    const booking = await this.getBooking(orgId, bookingId);
    if (booking.status === "canceled") {
      return booking;
    }

    const resource = await this.getResource(orgId, booking.resourceId);
    let providerLatencyMs = 0;
    if (booking.providerType && booking.providerEventId) {
      const account = await this.providerByType(orgId, booking.providerType);
      if (!account) {
        throw new CalendarDomainError(409, "provider_not_connected", "Provider account missing for this booking");
      }
      const adapter = providerAdapter(booking.providerType);
      const providerStart = Date.now();
      try {
        await adapter.cancelBooking(
          {
            ...account,
            encryptedAccessToken: account.accessToken,
            encryptedRefreshToken: account.refreshToken ?? null,
          },
          {
            bookingId: booking.id,
            startsAt: booking.startsAt,
            endsAt: booking.endsAt,
            customerName: booking.customerName,
            customerPhone: booking.customerPhone,
            customerEmail: booking.customerEmail,
            partySize: booking.partySize,
            notes: reason ?? booking.notes ?? null,
            resource,
            binding: resource.providerBinding,
            providerEventId: booking.providerEventId,
          },
        );
      } catch (error) {
        providerLatencyMs = Date.now() - providerStart;
        await this.insertBookingEvent({
          bookingId: booking.id,
          orgId,
          resourceId: booking.resourceId,
          eventType: "provider_error",
          providerType: booking.providerType,
          providerLatencyMs,
          totalLatencyMs: Date.now() - startedAt,
          result: "failure",
          errorCode: "provider_cancel_failed",
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        throw new CalendarDomainError(
          502,
          "provider_error",
          error instanceof Error ? error.message : "Provider cancel failed",
        );
      }
      providerLatencyMs = Date.now() - providerStart;
    }

    const result = await query(
      `UPDATE calendar_bookings
       SET status = 'canceled',
           notes = COALESCE($3, notes),
           updated_at = now()
       WHERE org_id = $1 AND id = $2
       RETURNING *`,
      [orgId, booking.id, reason ?? null],
    );

    const canceled = mapBookingRow(result.rows[0]);
    await this.insertBookingEvent({
      bookingId: canceled.id,
      orgId,
      resourceId: canceled.resourceId,
      eventType: "cancel",
      providerType: canceled.providerType,
      providerLatencyMs,
      totalLatencyMs: Date.now() - startedAt,
      result: "success",
      payload: { reason: reason ?? null },
    });

    logger.info("calendar booking canceled", {
      orgId,
      bookingId: canceled.id,
      resourceId: canceled.resourceId,
      provider: canceled.providerType ?? "none",
      action: "cancel",
      providerLatencyMs,
      totalLatencyMs: Date.now() - startedAt,
      result: "success",
      errorCode: null,
    });
    return canceled;
  }

  async getAvailability(orgId: string, params: {
    date: string;
    resourceId?: string;
    durationMin?: number;
    partySize?: number;
    status?: string;
  }): Promise<Array<{ resource: CalendarResourceRecord; slots: CalendarAvailabilitySlot[] }>> {
    const date = normalizeDateOnly(params.date);
    const durationMin = Math.max(5, Math.floor(params.durationMin ?? DEFAULT_DAY_DURATION_MIN));
    const resources = params.resourceId
      ? [await this.getResource(orgId, params.resourceId)]
      : (await this.listResources(orgId)).filter((r) => r.isActive);
    const activeProvider = await this.activeProvider(orgId);

    const output: Array<{ resource: CalendarResourceRecord; slots: CalendarAvailabilitySlot[] }> = [];
    for (const resource of resources) {
      const slots = slotSeries(date, resource.slotIntervalMin || DEFAULT_SLOT_INTERVAL_MIN, durationMin);

      const dayFrom = `${date}T00:00:00.000Z`;
      const dayTo = `${date}T23:59:59.999Z`;
      const bookingRows = await query(
        `SELECT starts_at, COUNT(*)::int AS count
         FROM calendar_bookings
         WHERE org_id = $1
           AND resource_id = $2
           AND starts_at >= $3::timestamptz
           AND starts_at <= $4::timestamptz
           AND status IN ('confirmed', 'pending')
         GROUP BY starts_at`,
        [orgId, resource.id, dayFrom, dayTo],
      );

      const localCount = new Map<string, number>();
      for (const row of bookingRows.rows) {
        localCount.set(new Date(row.starts_at).toISOString(), Number(row.count ?? 0));
      }

      let providerAllowed = new Set<string>(slots.map((s) => s.startsAt));
      if (activeProvider) {
        try {
          const starts = await providerAdapter(activeProvider.provider).listAvailability(
            {
              ...activeProvider,
              encryptedAccessToken: activeProvider.accessToken,
              encryptedRefreshToken: activeProvider.refreshToken ?? null,
            },
            {
              date,
              durationMin,
              intervalMin: resource.slotIntervalMin || DEFAULT_SLOT_INTERVAL_MIN,
              binding: resource.providerBinding,
              timezone: resource.timezone,
            },
          );
          providerAllowed = new Set(starts.map((x) => new Date(x).toISOString()));
        } catch (error) {
          logger.warn("provider availability failed; falling back to local", {
            orgId,
            resourceId: resource.id,
            provider: activeProvider.provider,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const mappedSlots = slots.map((slot) => {
        const current = localCount.get(slot.startsAt) ?? 0;
        const remaining = Math.max(0, resource.capacityPerSlot - current);
        const allowedByProvider = providerAllowed.has(slot.startsAt);
        return {
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          remainingCapacity: remaining,
          providerAvailable: allowedByProvider,
        };
      }).filter((slot) => slot.remainingCapacity > 0 && slot.providerAvailable);

      output.push({ resource, slots: mappedSlots });
    }
    return output;
  }

  async lookupBookings(orgId: string, params: {
    name?: string;
    phone?: string;
    date?: string;
    resourceId?: string;
    providerEventId?: string;
    limit?: number;
  }): Promise<CalendarBookingRecord[]> {
    if (params.providerEventId && params.providerEventId.trim().length > 0) {
      const result = await query(
        `SELECT *
         FROM calendar_bookings
         WHERE org_id = $1
           AND provider_event_id = $2
         ORDER BY starts_at DESC
         LIMIT $3`,
        [
          orgId,
          params.providerEventId.trim(),
          Math.max(1, Math.min(params.limit ?? 10, 50)),
        ],
      );
      return result.rows.map(mapBookingRow);
    }

    const filters: Record<string, string> = {};
    if (params.name) filters.customerName = params.name;
    if (params.phone) filters.customerPhone = params.phone;
    if (params.resourceId) filters.resourceId = params.resourceId;
    if (params.date) {
      const date = normalizeDateOnly(params.date);
      filters.from = `${date}T00:00:00.000Z`;
      filters.to = `${date}T23:59:59.999Z`;
    }
    const all = await this.listBookings(orgId, filters);
    return all.slice(0, Math.max(1, Math.min(params.limit ?? 10, 50)));
  }

  async startOAuth(orgId: string, provider: CalendarProviderType): Promise<{ authUrl: string; state: string; expiresAt: string }> {
    const cfg = providerAuthConfig(provider);
    if (!cfg.clientId || !cfg.clientSecret || !cfg.redirectUri) {
      throw new CalendarDomainError(
        400,
        "oauth_not_configured",
        `${provider} OAuth is not configured in environment`,
      );
    }
    const state = oauthState();
    const verifier = oauthVerifier();
    const challenge = oauthChallenge(verifier);
    const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MINUTES * 60_000).toISOString();

    await query(
      `INSERT INTO calendar_oauth_states (
         id, org_id, provider, state, code_verifier, code_challenge, redirect_uri, expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [randomUUID(), orgId, provider, state, verifier, challenge, cfg.redirectUri, expiresAt],
    );

    const scopes = providerScopes(provider);
    const url = new URL(cfg.authUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", cfg.clientId);
    url.searchParams.set("redirect_uri", cfg.redirectUri);
    url.searchParams.set("state", state);
    if (scopes.length > 0) {
      url.searchParams.set("scope", scopes.join(" "));
    }

    if (provider === "google_calendar") {
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
    } else {
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
    }

    return { authUrl: url.toString(), state, expiresAt };
  }

  async handleOAuthCallback(provider: CalendarProviderType, state: string, code: string): Promise<CalendarOAuthAccountRecord> {
    const stateRow = await query(
      `SELECT *
       FROM calendar_oauth_states
       WHERE provider = $1
         AND state = $2
         AND consumed_at IS NULL
         AND expires_at > now()
       LIMIT 1`,
      [provider, state],
    );
    if (stateRow.rowCount === 0) {
      throw new CalendarDomainError(400, "oauth_state_invalid", "OAuth state is invalid or expired");
    }
    const oauthStateRow = stateRow.rows[0];
    const orgId = oauthStateRow.org_id as string;
    const cfg = providerAuthConfig(provider);
    if (!cfg.clientId || !cfg.clientSecret || !cfg.redirectUri) {
      throw new CalendarDomainError(
        400,
        "oauth_not_configured",
        `${provider} OAuth is not configured in environment`,
      );
    }

    const body = new URLSearchParams();
    body.set("grant_type", "authorization_code");
    body.set("code", code);
    body.set("redirect_uri", cfg.redirectUri);
    body.set("client_id", cfg.clientId);
    body.set("client_secret", cfg.clientSecret);
    if (oauthStateRow.code_verifier) {
      body.set("code_verifier", oauthStateRow.code_verifier);
    }

    const response = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const payload = await jsonOrText(response);
    if (!response.ok) {
      throw new CalendarDomainError(
        502,
        "oauth_exchange_failed",
        `OAuth token exchange failed for ${provider}`,
        { payload },
      );
    }

    const tokenBody = payload as Record<string, unknown>;
    const accessToken = typeof tokenBody.access_token === "string" ? tokenBody.access_token : "";
    if (!accessToken) {
      throw new CalendarDomainError(502, "oauth_exchange_failed", "OAuth provider returned no access token");
    }
    const refreshToken =
      typeof tokenBody.refresh_token === "string" && tokenBody.refresh_token.length > 0
        ? tokenBody.refresh_token
        : undefined;
    const expiresIn = typeof tokenBody.expires_in === "number" ? tokenBody.expires_in : 3600;
    const scopeList =
      typeof tokenBody.scope === "string"
        ? tokenBody.scope.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
        : providerScopes(provider);

    const identity = await providerIdentity(provider, accessToken);
    const mergedMetadata = {
      ...(identity.metadata ?? {}),
      token_type: tokenBody.token_type,
      raw_scope: tokenBody.scope,
    };
    const encryptedAccess = encryptToken(accessToken);
    const encryptedRefresh = refreshToken ? encryptToken(refreshToken) : null;
    const tokenExpiresAt = futureIso(expiresIn);

    const account = await withTransaction(async (client) => {
      await client.query(
        `UPDATE calendar_oauth_accounts
         SET is_active = false, updated_at = now()
         WHERE org_id = $1`,
        [orgId],
      );
      const upsert = await client.query(
        `INSERT INTO calendar_oauth_accounts (
           id, org_id, provider, account_id, account_email,
           encrypted_access_token, encrypted_refresh_token, token_expires_at,
           scopes, metadata, is_active, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9::text[],$10::jsonb,true,now(),now()
         )
         ON CONFLICT (org_id, provider) DO UPDATE SET
           account_id = EXCLUDED.account_id,
           account_email = EXCLUDED.account_email,
           encrypted_access_token = EXCLUDED.encrypted_access_token,
           encrypted_refresh_token = COALESCE(EXCLUDED.encrypted_refresh_token, calendar_oauth_accounts.encrypted_refresh_token),
           token_expires_at = EXCLUDED.token_expires_at,
           scopes = EXCLUDED.scopes,
           metadata = EXCLUDED.metadata,
           is_active = true,
           updated_at = now()
         RETURNING *`,
        [
          randomUUID(),
          orgId,
          provider,
          identity.accountId ?? null,
          identity.accountEmail ?? null,
          encryptedAccess,
          encryptedRefresh,
          tokenExpiresAt,
          scopeList,
          JSON.stringify(mergedMetadata),
        ],
      );

      await client.query(
        `UPDATE calendar_oauth_states
         SET consumed_at = now()
         WHERE id = $1`,
        [oauthStateRow.id],
      );
      return upsert.rows[0];
    });

    await this.insertBookingEvent({
      orgId,
      eventType: "oauth_refresh",
      providerType: provider,
      result: "success",
      payload: {
        action: "oauth_callback_exchange",
        accountId: identity.accountId ?? null,
        accountEmail: identity.accountEmail ?? null,
      },
    });

    return mapOAuthRow(account);
  }

  async refreshProviderToken(orgId: string, provider: CalendarProviderType): Promise<CalendarOAuthAccountRecord> {
    const lockKey = `${orgId}:${provider}`;
    return withRefreshLock(lockKey, async () => {
      const account = await this.providerByType(orgId, provider);
      if (!account) {
        throw new CalendarDomainError(404, "provider_not_connected", "Provider account not found");
      }
      if (!account.refreshToken) {
        throw new CalendarDomainError(400, "refresh_failed", "Refresh token is missing");
      }

      const cfg = providerAuthConfig(provider);
      if (!cfg.clientId || !cfg.clientSecret) {
        throw new CalendarDomainError(400, "oauth_not_configured", `${provider} OAuth credentials missing`);
      }

      const body = new URLSearchParams();
      body.set("grant_type", "refresh_token");
      body.set("refresh_token", account.refreshToken);
      body.set("client_id", cfg.clientId);
      body.set("client_secret", cfg.clientSecret);

      const response = await fetch(cfg.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      const payload = await jsonOrText(response);
      if (!response.ok) {
        await this.insertBookingEvent({
          orgId,
          eventType: "oauth_refresh",
          providerType: provider,
          result: "failure",
          errorCode: "refresh_http_error",
          errorMessage: `status=${response.status}`,
          payload: normalizeMetadata(payload),
        });
        throw new CalendarDomainError(502, "refresh_failed", "Provider token refresh failed", {
          status: response.status,
        });
      }

      const tokenBody = payload as Record<string, unknown>;
      const accessToken = typeof tokenBody.access_token === "string" ? tokenBody.access_token : null;
      if (!accessToken) {
        throw new CalendarDomainError(502, "refresh_failed", "Provider token refresh returned no access token");
      }
      const refreshToken =
        typeof tokenBody.refresh_token === "string" && tokenBody.refresh_token.length > 0
          ? tokenBody.refresh_token
          : account.refreshToken;
      const expiresIn = typeof tokenBody.expires_in === "number" ? tokenBody.expires_in : 3600;
      const tokenExpiresAt = futureIso(expiresIn);

      const updated = await query(
        `UPDATE calendar_oauth_accounts
         SET encrypted_access_token = $3,
             encrypted_refresh_token = $4,
             token_expires_at = $5,
             updated_at = now()
         WHERE org_id = $1 AND provider = $2
         RETURNING *`,
        [
          orgId,
          provider,
          encryptToken(accessToken),
          refreshToken ? encryptToken(refreshToken) : null,
          tokenExpiresAt,
        ],
      );
      const mapped = mapOAuthRow(updated.rows[0]);
      await this.insertBookingEvent({
        orgId,
        eventType: "oauth_refresh",
        providerType: provider,
        result: "success",
        payload: { expiresAt: tokenExpiresAt },
      });
      return mapped;
    });
  }

  async refreshExpiringTokens(): Promise<{ refreshed: number; failed: number }> {
    const cutoff = new Date(Date.now() + TOKEN_REFRESH_WINDOW_SECONDS * 1000).toISOString();
    const rows = await query(
      `SELECT org_id, provider
       FROM calendar_oauth_accounts
       WHERE token_expires_at IS NOT NULL
         AND token_expires_at <= $1::timestamptz`,
      [cutoff],
    );
    let refreshed = 0;
    let failed = 0;
    for (const row of rows.rows) {
      if (!isProvider(row.provider)) continue;
      try {
        await this.refreshProviderToken(row.org_id, row.provider);
        refreshed += 1;
      } catch (error) {
        failed += 1;
        logger.warn("oauth refresh failed", {
          orgId: row.org_id,
          provider: row.provider,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { refreshed, failed };
  }

  async reconcileGoogleBookings(scopeOrgId?: string): Promise<{ scanned: number; updated: number; failed: number }> {
    const params: unknown[] = [];
    let where = `b.provider_type = 'google_calendar' AND b.status = 'confirmed' AND b.starts_at <= now() + interval '${RECONCILE_GOOGLE_LOOKAHEAD_DAYS} days'`;
    if (scopeOrgId) {
      where += ` AND b.org_id = $1`;
      params.push(scopeOrgId);
    }

    const rows = await query(
      `SELECT
         b.id,
         b.org_id,
         b.provider_event_id,
         b.resource_id,
         r.provider_binding
       FROM calendar_bookings b
       JOIN calendar_resources r ON r.id = b.resource_id
       WHERE ${where}`,
      params,
    );

    let scanned = 0;
    let updated = 0;
    let failed = 0;

    for (const row of rows.rows) {
      scanned += 1;
      try {
        const account = await this.providerByType(row.org_id, "google_calendar");
        if (!account || !row.provider_event_id) continue;
        const calendarIdRaw = normalizeMetadata(row.provider_binding).calendarId;
        const calendarId =
          typeof calendarIdRaw === "string" && calendarIdRaw.trim().length > 0
            ? calendarIdRaw.trim()
            : "primary";
        const response = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(row.provider_event_id)}`,
          {
            method: "GET",
            headers: { Authorization: `Bearer ${account.accessToken}` },
          },
        );

        if (response.status === 404 || response.status === 410) {
          await query(
            `UPDATE calendar_bookings
             SET status = 'canceled',
                 source = 'provider_reconciled',
                 updated_at = now()
             WHERE id = $1`,
            [row.id],
          );
          updated += 1;
          continue;
        }

        const payload = (await jsonOrText(response)) as Record<string, unknown>;
        if (!response.ok) {
          failed += 1;
          await this.insertBookingEvent({
            bookingId: row.id,
            orgId: row.org_id,
            resourceId: row.resource_id,
            eventType: "sync",
            providerType: "google_calendar",
            result: "failure",
            errorCode: "google_reconcile_fetch_failed",
            errorMessage: `status=${response.status}`,
            payload: normalizeMetadata(payload),
          });
          continue;
        }

        const status = typeof payload.status === "string" ? payload.status : "";
        if (status === "cancelled") {
          await query(
            `UPDATE calendar_bookings
             SET status = 'canceled',
                 source = 'provider_reconciled',
                 updated_at = now()
             WHERE id = $1`,
            [row.id],
          );
          updated += 1;
        }
      } catch (error) {
        failed += 1;
        logger.warn("google reconcile iteration failed", {
          bookingId: row.id,
          orgId: row.org_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { scanned, updated, failed };
  }
}
