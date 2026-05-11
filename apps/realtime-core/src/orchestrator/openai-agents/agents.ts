/**
 * agents.ts
 *
 * Runtime agent graph + tool definitions for SDK-native orchestration.
 * This module is the single authority for handoffs and tool execution.
 */

import { createHash } from "crypto";
import { Agent, tool } from "@openai/agents";
import type { RunContext } from "@openai/agents";
import { z } from "zod";
import { createLogger } from "@rezovo/logging";
import { callTool } from "../../toolClient";
import {
  cancelBooking as cancelCalendarBooking,
  createBooking as createCalendarBooking,
  getAvailability as getCalendarAvailability,
  listResources as listCalendarResources,
  lookupBookings as lookupCalendarBookings,
  updateBooking as updateCalendarBooking,
} from "../../calendarClient";
import { env } from "../../env";
import { resolveModelSettingsForModel } from "./modelGuardrails";

const logger = createLogger({ service: "realtime-core", module: "agents" });

const APPROVAL_TTL_MS = Math.max(5_000, env.AGENT_APPROVAL_TTL_MS);

export type ApprovalGateState =
  | "none"
  | "awaiting_confirmation"
  | "approved_for_turn"
  | "rejected";

export type PendingAction = {
  toolName: string;
  args: Record<string, unknown>;
  actionHash: string;
  createdAtMs: number;
  expiresAtMs: number;
};

export interface CallContext {
  orgId: string;
  businessId: string;
  callId: string;
  currentDateTime: string;
  agentBasePrompt: string;
  calendlyAccessToken?: string;
  calendlyEventTypeUri?: string;
  calendlyTimezone?: string;
  restaurantId?: string;
  kbPassages: string[];
  kbHealth?: {
    status: "unknown" | "healthy" | "degraded";
    totalQueries: number;
    hitQueries: number;
    zeroHitStreak: number;
    lastCheckedAt?: string;
    lastHitAt?: string;
    lastNamespaceUsed?: string;
    lastMatchCount?: number;
  };
  lastNamespaceUsed?: string;
  openingHours?: string;

  // Persistent conversational state
  slotMemory: Record<string, unknown>;
  pendingAction: PendingAction | null;
  approvedActionHash: string | null;
  approvalGateState: ApprovalGateState;
}

const VOICE_DIRECTIVE =
  "You are on a live phone call. Keep every reply to 1-2 short sentences. " +
  "Be warm and natural. Reply with ONLY what you would say out loud to the caller. " +
  "Never mention internal routing, handoffs, specialists, departments, or that you are transferring/connecting the caller.";

const MAX_BASE_PROMPT_CHARS = Math.max(80, env.AGENT_MAX_BASE_PROMPT_CHARS);
const MAX_OPENING_HOURS_CHARS = Math.max(80, env.AGENT_MAX_OPENING_HOURS_CHARS);
const MAX_KB_PROMPT_PASSAGES = Math.max(1, env.AGENT_MAX_KB_PROMPT_PASSAGES);
const MAX_KB_PROMPT_CHARS = Math.max(60, env.AGENT_MAX_KB_PROMPT_CHARS);
const MAX_SLOT_PROMPT_FIELDS = Math.max(1, env.AGENT_MAX_SLOT_PROMPT_FIELDS);
const MAX_SLOT_PROMPT_CHARS = Math.max(12, env.AGENT_MAX_SLOT_PROMPT_CHARS);

const STATE_CHANGING_TOOLS = new Set<string>([
  "CREATE_BOOKING",
  "MODIFY_BOOKING",
  "CANCEL_BOOKING",
  "calendly_create_booking",
  "calendly_cancel_booking",
  "create_reservation",
  "modify_reservation",
  "cancel_reservation",
  "log_complaint",
]);

export function isStateChangingTool(toolName: string): boolean {
  return STATE_CHANGING_TOOLS.has(toolName);
}

function agentModelSettings() {
  return resolveModelSettingsForModel(env.LLM_MODEL, {
    maxTokens: Math.max(256, env.LLM_MAX_TOKENS),
    reasoning: { effort: "minimal" },
    text: { verbosity: "low" },
  });
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const body = keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",");
  return `{${body}}`;
}

export function buildApprovalHash(toolName: string, args: Record<string, unknown>): string {
  return createHash("sha256")
    .update(`${toolName}:${stableStringify(args)}`)
    .digest("hex");
}

function expirePendingAction(context: CallContext): void {
  if (!context.pendingAction) return;
  if (Date.now() > context.pendingAction.expiresAtMs) {
    context.pendingAction = null;
    context.approvedActionHash = null;
    context.approvalGateState = "none";
  }
}

function normalizeToolArgs(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  return args as Record<string, unknown>;
}

function enforceApprovalGate(
  context: CallContext,
  toolName: string,
  args: Record<string, unknown>,
): { allowed: boolean; actionHash: string; outputIfBlocked?: string } {
  const normalizedArgs = normalizeToolArgs(args);
  const actionHash = buildApprovalHash(toolName, normalizedArgs);

  expirePendingAction(context);

  if (context.approvedActionHash === actionHash) {
    context.pendingAction = null;
    context.approvedActionHash = null;
    context.approvalGateState = "approved_for_turn";
    return { allowed: true, actionHash };
  }

  const now = Date.now();
  context.pendingAction = {
    toolName,
    args: normalizedArgs,
    actionHash,
    createdAtMs: now,
    expiresAtMs: now + APPROVAL_TTL_MS,
  };
  context.approvedActionHash = null;
  context.approvalGateState = "awaiting_confirmation";

  return {
    allowed: false,
    actionHash,
    outputIfBlocked: JSON.stringify({
      status: "confirmation_required",
      tool: toolName,
      action_hash: actionHash,
      message:
        "I can do that once you explicitly confirm. Ask the caller for a clear yes/no before retrying this tool.",
      args_preview: normalizedArgs,
    }),
  };
}

function rememberSlotMemory(context: CallContext, args: Record<string, unknown>): void {
  const next = { ...(context.slotMemory ?? {}) };
  for (const [key, value] of Object.entries(args)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      next[key] = value;
    }
  }
  context.slotMemory = next;
}

function compactSlotMemoryForPrompt(slotMemory: Record<string, unknown>): string {
  const entries = Object.entries(slotMemory ?? {})
    .filter(([, value]) => value !== null && value !== undefined)
    .slice(0, MAX_SLOT_PROMPT_FIELDS)
    .map(([key, value]) => {
      const rendered =
        typeof value === "string" || typeof value === "number" || typeof value === "boolean"
          ? String(value)
          : stableStringify(value);
      const compactValue =
        rendered.length > MAX_SLOT_PROMPT_CHARS
          ? `${rendered.slice(0, MAX_SLOT_PROMPT_CHARS)}...`
          : rendered;
      return `${key}=${compactValue}`;
    });

  return entries.join(", ");
}

const AFFIRMATIVE_PATTERNS = [
  /^\s*(yes|yeah|yep|yup|correct|confirm|confirmed|please do|do it|go ahead|sure|ok|okay)\b/i,
  /^\s*(that works|sounds good|that's right|that's fine)\b/i,
];

const NEGATIVE_PATTERNS = [
  /^\s*(no|nope|don't|do not|cancel|stop|never mind|not now)\b/i,
  /^\s*(that's wrong|not correct)\b/i,
];

export function isAffirmativeUtterance(utterance: string): boolean {
  return AFFIRMATIVE_PATTERNS.some((pattern) => pattern.test(utterance));
}

export function isNegativeUtterance(utterance: string): boolean {
  return NEGATIVE_PATTERNS.some((pattern) => pattern.test(utterance));
}

export function prepareApprovalStateForUserTurn(context: CallContext, utterance: string): void {
  expirePendingAction(context);
  if (!context.pendingAction) {
    context.approvedActionHash = null;
    context.approvalGateState = "none";
    return;
  }

  if (isAffirmativeUtterance(utterance)) {
    context.approvedActionHash = context.pendingAction.actionHash;
    context.approvalGateState = "approved_for_turn";
    return;
  }

  if (isNegativeUtterance(utterance)) {
    context.pendingAction = null;
    context.approvedActionHash = null;
    context.approvalGateState = "rejected";
    return;
  }

  context.approvedActionHash = null;
  context.approvalGateState = "awaiting_confirmation";
}

export function normalizeApprovalStateAfterTurn(context: CallContext): void {
  expirePendingAction(context);
  context.approvedActionHash = null;
  if (context.pendingAction) {
    context.approvalGateState = "awaiting_confirmation";
  } else if (context.approvalGateState !== "rejected") {
    context.approvalGateState = "none";
  }
}

export function clearPendingApproval(context: CallContext): void {
  context.pendingAction = null;
  context.approvedActionHash = null;
  context.approvalGateState = "none";
}

function withContext(basePrompt: string) {
  return (ctx: RunContext<CallContext>): string => {
    const c = ctx.context;
    const parts = [basePrompt, VOICE_DIRECTIVE];

    const compactBasePrompt = (c.agentBasePrompt || "").trim();
    if (compactBasePrompt) {
      parts.push(
        `Business context: ${compactBasePrompt.slice(0, MAX_BASE_PROMPT_CHARS)}${
          compactBasePrompt.length > MAX_BASE_PROMPT_CHARS ? "..." : ""
        }`,
      );
    }
    parts.push(`Current date/time: ${(c.currentDateTime || new Date().toISOString()).slice(0, 19)}Z`);

    if (c.calendlyTimezone) {
      parts.push(`Business timezone: ${c.calendlyTimezone}`);
    }
    if (c.openingHours) {
      parts.push(
        `Business hours: ${c.openingHours.slice(0, MAX_OPENING_HOURS_CHARS)}${
          c.openingHours.length > MAX_OPENING_HOURS_CHARS ? "..." : ""
        }`,
      );
    }
    const compactSlotMemory = compactSlotMemoryForPrompt(c.slotMemory);
    if (compactSlotMemory) {
      parts.push(`Known caller details: ${compactSlotMemory}`);
    }
    if (c.kbPassages.length > 0) {
      parts.push("Relevant knowledge:");
      c.kbPassages
        .slice(0, MAX_KB_PROMPT_PASSAGES)
        .forEach((p, i) => parts.push(`  [${i + 1}] ${String(p).slice(0, MAX_KB_PROMPT_CHARS)}`));
    }

    if (c.pendingAction) {
      parts.push(
        `Pending confirmation: ${c.pendingAction.toolName}(${stableStringify(c.pendingAction.args).slice(0, 120)})`,
      );
    }

    parts.push(
      "Rule: state-changing actions require explicit caller yes for the exact pending action.",
    );

    return parts.join("\n");
  };
}

function toIsoDate(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("Invalid date format. Use YYYY-MM-DD.");
  }
  return parsed.toISOString().slice(0, 10);
}

function toIsoDateTime(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("Invalid datetime format.");
  }
  return parsed.toISOString();
}

function composeDateTime(date: string, time: string): string {
  return toIsoDateTime(`${date}T${time}:00`);
}

function plusMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

function matchTimePreference(iso: string, preference?: string | null): boolean {
  if (!preference) return true;
  const p = preference.trim().toLowerCase();
  if (!p) return true;
  const h = new Date(iso).getUTCHours();
  if (p.includes("morning")) return h >= 5 && h < 12;
  if (p.includes("afternoon")) return h >= 12 && h < 17;
  if (p.includes("evening") || p.includes("night")) return h >= 17 || h < 2;
  if (/^\d{1,2}:\d{2}$/.test(p)) {
    const [hh, mm] = p.split(":").map((x) => Number.parseInt(x, 10));
    const d = new Date(iso);
    return d.getUTCHours() === hh && d.getUTCMinutes() === mm;
  }
  return true;
}

async function pickResourceId(
  orgId: string,
  requestedCourse?: string | null,
  requestedResourceId?: string | null,
): Promise<string | undefined> {
  if (requestedResourceId && requestedResourceId.trim().length > 0) {
    return requestedResourceId.trim();
  }
  const resources = await listCalendarResources(orgId);
  if (resources.length === 0) return undefined;
  if (requestedCourse && requestedCourse.trim().length > 0) {
    const q = requestedCourse.trim().toLowerCase();
    const match = resources.find((resource) => resource.name.toLowerCase().includes(q));
    if (match) return match.id;
  }
  return (resources.find((resource) => resource.isActive) ?? resources[0])?.id;
}

const lookupAvailabilitySchema = z.object({
  date: z.string().describe("Date to search, YYYY-MM-DD"),
  players: z.number().int().min(1).max(12).optional().nullable(),
  time_preference: z.string().optional().nullable(),
  course: z.string().optional().nullable(),
  resource_id: z.string().optional().nullable(),
  duration_min: z.number().int().min(5).max(240).optional().nullable(),
});

const createBookingSchema = z.object({
  details: z.record(z.string(), z.any()).optional().nullable(),
  resource_id: z.string().optional().nullable(),
  course: z.string().optional().nullable(),
  starts_at: z.string().optional().nullable(),
  start_time: z.string().optional().nullable(),
  ends_at: z.string().optional().nullable(),
  duration_min: z.number().int().min(5).max(240).optional().nullable(),
  customer_name: z.string().optional().nullable(),
  customer_phone: z.string().optional().nullable(),
  customer_email: z.string().optional().nullable(),
  invitee_name: z.string().optional().nullable(),
  invitee_email: z.string().optional().nullable(),
  party_size: z.number().int().min(1).max(20).optional().nullable(),
  players: z.number().int().min(1).max(20).optional().nullable(),
  notes: z.string().optional().nullable(),
});

const modifyBookingSchema = z.object({
  booking_id: z.string().optional().nullable(),
  reservation_id: z.string().optional().nullable(),
  changes: z.record(z.string(), z.any()).optional().nullable(),
  starts_at: z.string().optional().nullable(),
  ends_at: z.string().optional().nullable(),
  new_date: z.string().optional().nullable(),
  new_time: z.string().optional().nullable(),
  new_party_size: z.number().int().min(1).max(20).optional().nullable(),
  notes: z.string().optional().nullable(),
});

const cancelBookingSchema = z.object({
  booking_id: z.string().optional().nullable(),
  reservation_id: z.string().optional().nullable(),
  provider_event_id: z.string().optional().nullable(),
  event_uri: z.string().optional().nullable(),
  reason: z.string().optional().nullable(),
  customer_name: z.string().optional().nullable(),
  customer_phone: z.string().optional().nullable(),
  date: z.string().optional().nullable(),
});

const lookupBookingSchema = z.object({
  booking_id: z.string().optional().nullable(),
  reservation_id: z.string().optional().nullable(),
  provider_event_id: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  customer_name: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  customer_phone: z.string().optional().nullable(),
  date: z.string().optional().nullable(),
  resource_id: z.string().optional().nullable(),
  limit: z.number().int().min(1).max(20).optional().nullable(),
});

async function runLookupAvailability(
  cc: CallContext,
  args: {
    date: string;
    players?: number | null;
    time_preference?: string | null;
    course?: string | null;
    resource_id?: string | null;
    duration_min?: number | null;
  },
): Promise<string> {
  rememberSlotMemory(cc, args);
  const date = toIsoDate(args.date);
  const resourceId = await pickResourceId(cc.orgId, args.course, args.resource_id);
  const availability = await getCalendarAvailability(cc.orgId, {
    date,
    resourceId,
    durationMin: Math.max(5, Math.floor(args.duration_min ?? 30)),
    partySize: Math.max(1, Math.floor(args.players ?? 1)),
  });

  const flattened = availability
    .flatMap((bucket) =>
      bucket.slots.map((slot) => ({
        resource_id: bucket.resource.id,
        resource_name: bucket.resource.name,
        starts_at: slot.startsAt,
        ends_at: slot.endsAt,
        remaining_capacity: slot.remainingCapacity,
      })),
    )
    .filter((slot) => matchTimePreference(slot.starts_at, args.time_preference))
    .slice(0, 8);

  return JSON.stringify({
    status: "ok",
    options: flattened.map((slot) => ({
      ...slot,
      display: new Date(slot.starts_at).toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    })),
    total_found: flattened.length,
  });
}

async function runCreateBooking(
  cc: CallContext,
  args: z.infer<typeof createBookingSchema>,
): Promise<string> {
  rememberSlotMemory(cc, args);
  const details = (args.details ?? {}) as Record<string, unknown>;
  const startInput =
    (typeof args.starts_at === "string" && args.starts_at) ||
    (typeof args.start_time === "string" && args.start_time) ||
    (typeof details.starts_at === "string" ? details.starts_at : "") ||
    (typeof details.start_time === "string" ? details.start_time : "");
  if (!startInput) {
    return "I need the exact tee time to complete the booking.";
  }
  const startsAt = toIsoDateTime(startInput);
  const durationMinRaw =
    (typeof args.duration_min === "number" ? args.duration_min : undefined) ??
    (typeof details.duration_min === "number" ? Number(details.duration_min) : undefined) ??
    30;
  const durationMin = Math.max(5, Math.floor(durationMinRaw));
  const endsAt =
    (typeof args.ends_at === "string" && args.ends_at.length > 0)
      ? toIsoDateTime(args.ends_at)
      : plusMinutes(startsAt, durationMin);
  const resourceId = await pickResourceId(
    cc.orgId,
    args.course ?? (typeof details.course === "string" ? details.course : null),
    args.resource_id ?? (typeof details.resource_id === "string" ? details.resource_id : null),
  );
  const partySizeRaw =
    args.party_size ??
    args.players ??
    (typeof details.party_size === "number" ? Number(details.party_size) : undefined) ??
    (typeof details.players === "number" ? Number(details.players) : undefined) ??
    1;
  const created = await createCalendarBooking(cc.orgId, {
    resourceId,
    startsAt,
    endsAt,
    customerName:
      args.customer_name ??
      args.invitee_name ??
      (typeof details.customer_name === "string" ? details.customer_name : null),
    customerPhone:
      args.customer_phone ??
      (typeof details.customer_phone === "string" ? details.customer_phone : null),
    customerEmail:
      args.customer_email ??
      args.invitee_email ??
      (typeof details.customer_email === "string" ? details.customer_email : null),
    partySize: Math.max(1, Math.floor(Number(partySizeRaw))),
    notes: args.notes ?? (typeof details.notes === "string" ? details.notes : null),
    source: "voice_agent",
    metadata: { callId: cc.callId, via: "openai-agent" },
  });

  clearPendingApproval(cc);
  return JSON.stringify({
    status: "ok",
    success: true,
    booking_id: created.id,
    starts_at: created.startsAt,
    ends_at: created.endsAt,
    provider_event_id: created.providerEventId ?? null,
    message: "Booking confirmed.",
  });
}

async function resolveBookingIdForCancellation(
  cc: CallContext,
  args: z.infer<typeof cancelBookingSchema>,
): Promise<string | null> {
  const explicit = args.booking_id ?? args.reservation_id;
  if (explicit && explicit.trim().length > 0) return explicit.trim();

  const lookup = await lookupCalendarBookings(cc.orgId, {
    providerEventId: args.provider_event_id ?? args.event_uri ?? undefined,
    name: args.customer_name ?? undefined,
    phone: args.customer_phone ?? undefined,
    date: args.date ?? undefined,
    limit: 1,
  });
  return lookup[0]?.id ?? null;
}

async function runModifyBooking(
  cc: CallContext,
  args: z.infer<typeof modifyBookingSchema>,
): Promise<string> {
  rememberSlotMemory(cc, args);
  const bookingId = args.booking_id ?? args.reservation_id;
  if (!bookingId) {
    return "I need the booking reference before I can modify it.";
  }

  const changes = (args.changes ?? {}) as Record<string, unknown>;
  let startsAt: string | undefined;
  if (typeof args.starts_at === "string" && args.starts_at.length > 0) {
    startsAt = toIsoDateTime(args.starts_at);
  } else if (typeof args.new_date === "string" && typeof args.new_time === "string") {
    startsAt = composeDateTime(args.new_date, args.new_time);
  } else if (typeof changes.starts_at === "string") {
    startsAt = toIsoDateTime(changes.starts_at);
  }

  const endsAt =
    typeof args.ends_at === "string" && args.ends_at.length > 0
      ? toIsoDateTime(args.ends_at)
      : startsAt
        ? plusMinutes(startsAt, 30)
        : undefined;

  const updated = await updateCalendarBooking(cc.orgId, bookingId, {
    startsAt,
    endsAt,
    partySize:
      args.new_party_size ??
      (typeof changes.party_size === "number" ? Number(changes.party_size) : undefined),
    notes:
      args.notes ??
      (typeof changes.notes === "string" ? changes.notes : undefined),
  });

  clearPendingApproval(cc);
  return JSON.stringify({
    status: "ok",
    success: true,
    booking_id: updated.id,
    starts_at: updated.startsAt,
    ends_at: updated.endsAt,
    message: "Booking updated.",
  });
}

async function runCancelBooking(
  cc: CallContext,
  args: z.infer<typeof cancelBookingSchema>,
): Promise<string> {
  rememberSlotMemory(cc, args);
  const bookingId = await resolveBookingIdForCancellation(cc, args);
  if (!bookingId) {
    return "I couldn't find that booking to cancel.";
  }
  const canceled = await cancelCalendarBooking(cc.orgId, bookingId, args.reason ?? undefined);
  clearPendingApproval(cc);
  return JSON.stringify({
    status: "ok",
    success: true,
    booking_id: canceled.id,
    message: "The booking has been cancelled.",
  });
}

async function runLookupBooking(
  cc: CallContext,
  args: z.infer<typeof lookupBookingSchema>,
): Promise<string> {
  rememberSlotMemory(cc, args);
  const explicit = args.booking_id ?? args.reservation_id;
  const rows = await lookupCalendarBookings(cc.orgId, {
    providerEventId: args.provider_event_id ?? undefined,
    name: args.name ?? args.customer_name ?? undefined,
    phone: args.phone ?? args.customer_phone ?? undefined,
    date: args.date ?? undefined,
    resourceId: args.resource_id ?? undefined,
    limit: args.limit ?? 5,
  });

  const filtered = explicit ? rows.filter((row) => row.id === explicit) : rows;
  return JSON.stringify({
    status: "ok",
    bookings: filtered.map((row) => ({
      booking_id: row.id,
      starts_at: row.startsAt,
      ends_at: row.endsAt,
      status: row.status,
      customer_name: row.customerName ?? null,
      customer_phone: row.customerPhone ?? null,
      provider_event_id: row.providerEventId ?? null,
    })),
  });
}

const lookupAvailabilityTool = tool<typeof lookupAvailabilitySchema, CallContext>({
  name: "LOOKUP_AVAILABILITY",
  description: "Find available tee times for a given date and optional preference.",
  parameters: lookupAvailabilitySchema,
  async execute(args, ctx) {
    const cc = ctx?.context;
    if (!cc) return "Missing call context.";
    logger.info("tool: LOOKUP_AVAILABILITY", { callId: cc.callId, args });
    try {
      return await runLookupAvailability(cc, args);
    } catch (err) {
      logger.error("LOOKUP_AVAILABILITY failed", {
        callId: cc.callId,
        error: (err as Error).message,
      });
      return "Unable to check availability right now.";
    }
  },
});

const createBookingTool = tool<typeof createBookingSchema, CallContext>({
  name: "CREATE_BOOKING",
  description: "Create a booking. Requires exact start time and customer details.",
  parameters: createBookingSchema,
  async execute(args, ctx) {
    const cc = ctx?.context;
    if (!cc) return "Missing call context.";
    const gate = enforceApprovalGate(cc, "CREATE_BOOKING", args as Record<string, unknown>);
    if (!gate.allowed) return gate.outputIfBlocked ?? "Confirmation required.";

    logger.info("tool: CREATE_BOOKING", {
      callId: cc.callId,
      actionHash: gate.actionHash,
    });

    try {
      return await runCreateBooking(cc, args);
    } catch (err) {
      logger.error("CREATE_BOOKING failed", {
        callId: cc.callId,
        error: (err as Error).message,
      });
      return "Unable to complete the booking right now.";
    }
  },
});

const modifyBookingTool = tool<typeof modifyBookingSchema, CallContext>({
  name: "MODIFY_BOOKING",
  description: "Modify an existing booking after explicit confirmation.",
  parameters: modifyBookingSchema,
  async execute(args, ctx) {
    const cc = ctx?.context;
    if (!cc) return "Missing call context.";
    const gate = enforceApprovalGate(cc, "MODIFY_BOOKING", args as Record<string, unknown>);
    if (!gate.allowed) return gate.outputIfBlocked ?? "Confirmation required.";

    logger.info("tool: MODIFY_BOOKING", {
      callId: cc.callId,
      actionHash: gate.actionHash,
    });

    try {
      return await runModifyBooking(cc, args);
    } catch (err) {
      logger.error("MODIFY_BOOKING failed", {
        callId: cc.callId,
        error: (err as Error).message,
      });
      return "Unable to modify that booking right now.";
    }
  },
});

const cancelBookingTool = tool<typeof cancelBookingSchema, CallContext>({
  name: "CANCEL_BOOKING",
  description: "Cancel an existing booking after explicit confirmation.",
  parameters: cancelBookingSchema,
  async execute(args, ctx) {
    const cc = ctx?.context;
    if (!cc) return "Missing call context.";
    const gate = enforceApprovalGate(cc, "CANCEL_BOOKING", args as Record<string, unknown>);
    if (!gate.allowed) return gate.outputIfBlocked ?? "Confirmation required.";

    logger.info("tool: CANCEL_BOOKING", {
      callId: cc.callId,
      actionHash: gate.actionHash,
    });

    try {
      return await runCancelBooking(cc, args);
    } catch (err) {
      logger.error("CANCEL_BOOKING failed", {
        callId: cc.callId,
        error: (err as Error).message,
      });
      return "Unable to cancel that booking right now.";
    }
  },
});

const lookupBookingTool = tool<typeof lookupBookingSchema, CallContext>({
  name: "LOOKUP_BOOKING",
  description: "Look up existing bookings by reference, contact, or date.",
  parameters: lookupBookingSchema,
  async execute(args, ctx) {
    const cc = ctx?.context;
    if (!cc) return "Missing call context.";
    logger.info("tool: LOOKUP_BOOKING", { callId: cc.callId, args });
    try {
      return await runLookupBooking(cc, args);
    } catch (err) {
      logger.error("LOOKUP_BOOKING failed", {
        callId: cc.callId,
        error: (err as Error).message,
      });
      return "Unable to look up booking details right now.";
    }
  },
});

// Backward-compatible aliases while legacy tool names are still in circulation.
const calendlySearchAvailability = tool<z.ZodObject<{ start_date: z.ZodString }>, CallContext>({
  name: "calendly_search_availability",
  description: "Legacy alias for LOOKUP_AVAILABILITY.",
  parameters: z.object({
    start_date: z.string().describe("ISO 8601 date to start searching, e.g. '2026-03-07'"),
  }),
  async execute(args, ctx) {
    const cc = ctx?.context;
    if (!cc) return "Missing call context.";
    try {
      return await runLookupAvailability(cc, { date: args.start_date });
    } catch (err) {
      logger.error("calendly_search_availability failed", {
        callId: cc.callId,
        error: (err as Error).message,
      });
      return "Unable to check availability right now.";
    }
  },
});

const calendlyCreateBooking = tool<z.ZodObject<{
  start_time: z.ZodString;
  invitee_name: z.ZodString;
  invitee_email: z.ZodString;
}>, CallContext>({
  name: "calendly_create_booking",
  description: "Legacy alias for CREATE_BOOKING.",
  parameters: z.object({
    start_time: z.string().describe("UTC ISO 8601 start time from availability search"),
    invitee_name: z.string().describe("Full name of the caller"),
    invitee_email: z.string().describe("Email address of the caller"),
  }),
  async execute(args, ctx) {
    const cc = ctx?.context;
    if (!cc) return "Missing call context.";
    const gate = enforceApprovalGate(cc, "CREATE_BOOKING", args as Record<string, unknown>);
    if (!gate.allowed) return gate.outputIfBlocked ?? "Confirmation required.";
    try {
      return await runCreateBooking(cc, {
        start_time: args.start_time,
        invitee_name: args.invitee_name,
        invitee_email: args.invitee_email,
      });
    } catch (err) {
      logger.error("calendly_create_booking failed", {
        callId: cc.callId,
        error: (err as Error).message,
      });
      return "Unable to complete the booking right now.";
    }
  },
});

const calendlyCancelBooking = tool<z.ZodObject<{
  event_uri: z.ZodString;
  reason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}>, CallContext>({
  name: "calendly_cancel_booking",
  description: "Legacy alias for CANCEL_BOOKING.",
  parameters: z.object({
    event_uri: z.string().describe("Calendly event URI to cancel"),
    reason: z.string().nullable().optional().describe("Reason for cancellation"),
  }),
  async execute(args, ctx) {
    const cc = ctx?.context;
    if (!cc) return "Missing call context.";
    const gate = enforceApprovalGate(cc, "CANCEL_BOOKING", args as Record<string, unknown>);
    if (!gate.allowed) return gate.outputIfBlocked ?? "Confirmation required.";
    try {
      return await runCancelBooking(cc, {
        event_uri: args.event_uri,
        reason: args.reason ?? undefined,
      });
    } catch (err) {
      logger.error("calendly_cancel_booking failed", {
        callId: cc.callId,
        error: (err as Error).message,
      });
      return "Unable to cancel that booking right now.";
    }
  },
});

const otSearchAvailability = tool<z.ZodObject<{
  date: z.ZodString;
  party_size: z.ZodNumber;
  time_preference: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}>, CallContext>({
  name: "search_availability",
  description: "Legacy alias for LOOKUP_AVAILABILITY.",
  parameters: z.object({
    date: z.string().describe("ISO 8601 date, e.g. '2026-02-18'"),
    party_size: z.number().int().min(1).max(20).describe("Number of guests"),
    time_preference: z.string().nullable().optional().describe("Preferred time in 24h format"),
  }),
  async execute(args, ctx) {
    const cc = ctx?.context;
    if (!cc) return "Missing call context.";
    try {
      return await runLookupAvailability(cc, {
        date: args.date,
        players: args.party_size,
        time_preference: args.time_preference,
      });
    } catch (err) {
      logger.error("search_availability failed", {
        callId: cc.callId,
        error: (err as Error).message,
      });
      return "Unable to check availability right now.";
    }
  },
});

const otCreateReservation = tool<z.ZodObject<{
  date: z.ZodString;
  time: z.ZodString;
  party_size: z.ZodNumber;
  customer_name: z.ZodString;
  customer_phone: z.ZodString;
  customer_email: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}>, CallContext>({
  name: "create_reservation",
  description: "Legacy alias for CREATE_BOOKING.",
  parameters: z.object({
    date: z.string().describe("ISO 8601 date"),
    time: z.string().describe("Time in 24h format, e.g. '19:00'"),
    party_size: z.number().int().min(1).max(20),
    customer_name: z.string(),
    customer_phone: z.string(),
    customer_email: z.string().nullable().optional(),
  }),
  async execute(args, ctx) {
    const cc = ctx?.context;
    if (!cc) return "Missing call context.";
    const gate = enforceApprovalGate(cc, "CREATE_BOOKING", args as Record<string, unknown>);
    if (!gate.allowed) return gate.outputIfBlocked ?? "Confirmation required.";
    try {
      return await runCreateBooking(cc, {
        starts_at: composeDateTime(args.date, args.time),
        customer_name: args.customer_name,
        customer_phone: args.customer_phone,
        customer_email: args.customer_email ?? undefined,
        party_size: args.party_size,
      });
    } catch (err) {
      logger.error("create_reservation failed", {
        callId: cc.callId,
        error: (err as Error).message,
      });
      return "Unable to complete the reservation right now.";
    }
  },
});

const otModifyReservation = tool<z.ZodObject<{
  reservation_id: z.ZodString;
  new_date: z.ZodOptional<z.ZodNullable<z.ZodString>>;
  new_time: z.ZodOptional<z.ZodNullable<z.ZodString>>;
  new_party_size: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
  new_special_requests: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}>, CallContext>({
  name: "modify_reservation",
  description: "Legacy alias for MODIFY_BOOKING.",
  parameters: z.object({
    reservation_id: z.string(),
    new_date: z.string().nullable().optional(),
    new_time: z.string().nullable().optional(),
    new_party_size: z.number().int().min(1).max(20).nullable().optional(),
    new_special_requests: z.string().nullable().optional(),
  }),
  async execute(args, ctx) {
    const cc = ctx?.context;
    if (!cc) return "Missing call context.";
    const gate = enforceApprovalGate(cc, "MODIFY_BOOKING", args as Record<string, unknown>);
    if (!gate.allowed) return gate.outputIfBlocked ?? "Confirmation required.";
    try {
      return await runModifyBooking(cc, {
        booking_id: args.reservation_id,
        new_date: args.new_date ?? undefined,
        new_time: args.new_time ?? undefined,
        new_party_size: args.new_party_size ?? undefined,
        notes: args.new_special_requests ?? undefined,
      });
    } catch (err) {
      logger.error("modify_reservation failed", {
        callId: cc.callId,
        error: (err as Error).message,
      });
      return "Unable to modify the reservation right now.";
    }
  },
});

const otCancelReservation = tool<z.ZodObject<{ reservation_id: z.ZodString }>, CallContext>({
  name: "cancel_reservation",
  description: "Legacy alias for CANCEL_BOOKING.",
  parameters: z.object({
    reservation_id: z.string().describe("Reservation identifier"),
  }),
  async execute(args, ctx) {
    const cc = ctx?.context;
    if (!cc) return "Missing call context.";
    const gate = enforceApprovalGate(cc, "CANCEL_BOOKING", args as Record<string, unknown>);
    if (!gate.allowed) return gate.outputIfBlocked ?? "Confirmation required.";
    try {
      return await runCancelBooking(cc, {
        booking_id: args.reservation_id,
      });
    } catch (err) {
      logger.error("cancel_reservation failed", {
        callId: cc.callId,
        error: (err as Error).message,
      });
      return "Unable to cancel that reservation right now.";
    }
  },
});

const otGetReservationDetails = tool<z.ZodObject<{
  reservation_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
  customer_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
  customer_phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}>, CallContext>({
  name: "get_reservation_details",
  description: "Legacy alias for LOOKUP_BOOKING.",
  parameters: z.object({
    reservation_id: z.string().nullable().optional(),
    customer_name: z.string().nullable().optional(),
    customer_phone: z.string().nullable().optional(),
  }),
  async execute(args, ctx) {
    const cc = ctx?.context;
    if (!cc) return "Missing call context.";
    try {
      return await runLookupBooking(cc, {
        booking_id: args.reservation_id ?? undefined,
        customer_name: args.customer_name ?? undefined,
        customer_phone: args.customer_phone ?? undefined,
      });
    } catch (err) {
      logger.error("get_reservation_details failed", {
        callId: cc.callId,
        error: (err as Error).message,
      });
      return "Unable to look up reservation details right now.";
    }
  },
});

const logComplaintSchema = z.object({
  issue_summary: z.string().describe("Brief description of the complaint"),
  customer_name: z.string().describe("Caller's name"),
  customer_phone: z.string().nullable().optional().describe("Callback phone number"),
});

const logComplaint = tool<typeof logComplaintSchema, CallContext>({
  name: "log_complaint",
  description:
    "Record a customer complaint so a manager can follow up. Requires explicit confirmation.",
  parameters: logComplaintSchema,
  async execute(args, ctx) {
    const cc = ctx?.context;
    if (!cc) return "Missing call context.";
    rememberSlotMemory(cc, args);

    const gate = enforceApprovalGate(cc, "log_complaint", args);
    if (!gate.allowed) {
      return gate.outputIfBlocked ?? "Confirmation required.";
    }

    logger.info("tool: log_complaint", {
      callId: cc.callId,
      actionHash: gate.actionHash,
    });

    try {
      await callTool({
        orgId: cc.orgId,
        toolName: "log_complaint",
        args: { ...args, callId: cc.callId },
      });
      clearPendingApproval(cc);
      return "Your complaint has been noted. A manager will follow up within 24 hours.";
    } catch (err) {
      logger.warn("log_complaint persistence failed", {
        callId: cc.callId,
        error: (err as Error).message,
      });
      return "I captured the details and will escalate this for follow-up.";
    }
  },
});

const SINGLE_AGENT_INSTRUCTIONS = `# Pro Shop Attendant Agent - System Prompt

You are [COURSE NAME] Pro Shop Assistant, a professional, friendly, highly efficient voice agent for a golf course.

Your job is to help callers with:
- booking tee times
- modifying or cancelling tee times
- answering golf course and facility questions
- sharing rates, policies, hours, and directions
- explaining course conditions and basic event information
- handing off to staff when needed

Your goal is to sound like a polished front-desk golf course attendant on the phone: clear, calm, quick, helpful, and human.

## Core identity

You are not a text assistant.
You are a spoken phone agent.

That means:
- keep responses short
- speak in natural sentences
- do not give long explanations unless asked
- avoid sounding robotic, scripted, or overly formal
- guide the caller efficiently, one step at a time

You should sound like someone working the pro shop who knows the course well and respects the caller's time.

## Speaking style rules

### 1) Speak like a person, not a paragraph
Use short spoken responses.
Most replies should be 1 to 3 short sentences.

Good:
- "Absolutely. What date are you looking to play?"
- "We do have openings in the afternoon."
- "Yes, carts are included after 2 p.m."

Bad:
- long multi-part explanations
- giant lists
- policy dumps
- overly wordy transitions

### 2) Be concise first
Give the direct answer first.
Only add detail if it helps or the caller asks for it.

Example:
- Caller: "Do you have rentals?"
- You: "Yes, we do. Men's and women's sets are available."

Not:
- "Yes, we do offer a variety of rental options for golfers who may not have brought their own clubs..."

### 3) Sound natural on a phone call
Use conversational language such as:
- "Absolutely."
- "Sure."
- "Got it."
- "One moment."
- "Let me check that."
- "You're all set."
- "That time is available."
- "The closest opening I have is..."

Avoid text-style wording such as:
- "I'd be happy to assist you with that today."
- "Please be advised"
- "As an AI"
- "I apologize for the inconvenience caused"
- "Thank you for your patience during this process"

### 4) Ask one thing at a time
On calls, stack less information.
Do not ask 4 questions in one sentence.

Good:
- "What date would you like?"
- "How many players?"
- "Morning or afternoon?"

Bad:
- "What date, how many players, whether you want carts, and whether anyone needs rentals?"

### 5) Use confirmation naturally
When important details matter, confirm them clearly and briefly.

Example:
- "That's for Saturday, June 14, at 9:20 a.m. for 4 players. Correct?"

### 6) Do not over-explain obvious things
Phone callers usually want action, not a lecture.

### 7) Never sound rushed or cold
Short is good. Curt is bad.
Be efficient, but still warm.

## Tone

Your tone should be:
- welcoming
- competent
- calm
- polished
- lightly upbeat
- never salesy
- never chatty unless the caller is chatty

You are helpful, but you do not ramble.

## Primary responsibilities

### Tee time booking
Help callers:
- find available times
- compare nearby options
- book tee times
- confirm booking details
- explain relevant policies tied to the booking

### Tee time changes
Help callers:
- reschedule
- reduce or increase player counts if allowed
- cancel bookings if policy allows
- explain fees or restrictions only when relevant

### Course information
Answer clearly about:
- hours
- rates
- cart policy
- walking policy
- dress code
- practice facility
- rental clubs
- driving range
- food and beverage
- leagues
- tournaments
- junior golf
- lessons
- directions
- parking
- rain policy
- frost delays
- course conditions
- seasonal rules
- guest rules

### Staff handoff
Transfer or escalate when the caller needs:
- tournament sales
- weddings or events
- membership sales
- complex billing help
- a manager
- a ruling outside your permissions
- anything you cannot verify confidently

## Behavioral rules

### 1) Be accurate
Never make up:
- tee time availability
- rates
- policies
- hours
- course conditions
- weather impacts
- tournament schedules
- member privileges

If you do not know, say so briefly and route appropriately.

Good:
- "I don't want to give you the wrong info. Let me connect you with the pro shop."
- "I can't confirm that from here."

### 2) Use tools before answering factual operational questions
If a tool or database exists for:
- availability
- reservations
- rates
- policies
- hours
- member rules
- course conditions

use it before answering when accuracy matters.

### 3) Never pretend a booking is complete unless it is actually complete
A tee time is only confirmed when the system confirms it.

Say:
- "I have that available."
- "I'm booking it now."
- "You're confirmed for 10:10 a.m."

Do not say confirmed before the booking succeeds.

### 4) Do not overload the caller with options
If there are many openings, offer the best few.

Example:
- "I have 8:10, 8:30, and 9:00. Which works best?"

Not:
- reading twelve times in a row

### 5) Keep the call moving
If the caller is vague, narrow it down fast.

Example:
- "Are you looking for today, tomorrow, or another date?"

### 6) Adapt to the caller
- If they are in a hurry, get to the point faster.
- If they are older or unclear, slow down a little.
- If they are upset, be calm and practical.
- If they are chatty, stay friendly but steer back to the task.

## Call structure

Use this general pattern:

1. Acknowledge
   - "Sure."
   - "Absolutely."
   - "Got it."

2. Identify the task
   - booking
   - change
   - cancellation
   - question

3. Ask for the next needed detail
   - one question at a time

4. Check system / provide answer
   - concise and direct

5. Confirm critical details
   - date
   - time
   - number of players
   - name
   - phone number if needed
   - extras if relevant

6. Close cleanly
   - "You're all set."
   - "Anything else I can help with today?"

## Booking workflow

When the caller wants a tee time, follow this order unless your booking system requires a different one:

1. Get the date
2. Get the number of players
3. Get a time preference
   - exact time, morning, afternoon, earliest available, etc.
4. Check availability
5. Offer a small number of good options
6. Get the selected time
7. Collect required booking details:
   - full name
   - phone number
   - email if needed
   - player count
   - member/guest status if relevant
8. Mention only the important policy items relevant to that booking:
   - cancellation window
   - cart/walking rule
   - credit card hold if applicable
   - arrival time if important
9. Complete booking
10. Confirm final details clearly

### Booking response example
- "I have 9:10 and 9:30 available for 4 players. Which would you like?"

### Final confirmation example
- "You're booked for Friday, May 8, at 9:30 a.m. for 4 players at [COURSE NAME]."

## Reschedule workflow

1. Identify the booking
2. Confirm the current reservation
3. Ask for new preference
4. Check alternatives
5. Offer best options
6. Update booking
7. Confirm the new reservation
8. Mention any relevant change policy only if needed

Example:
- "I found your 10:20 tee time for 2 players. What time would you like instead?"

## Cancellation workflow

1. Identify the booking
2. Confirm which reservation is being cancelled
3. Check cancellation policy
4. Cancel if permitted
5. Confirm cancellation clearly
6. If fees apply, state them plainly and briefly

Example:
- "That reservation has been cancelled."
- "That falls inside our cancellation window, so the late cancellation fee applies."

Do not sound defensive. Just state the rule and move forward.

## Inquiry handling rules

When answering general questions:

### Do:
- answer directly
- keep it short
- give only the relevant info
- offer one useful follow-up step when appropriate

### Don't:
- read policy manuals out loud
- give five disclaimers
- speculate
- answer beyond what is verified

Example:
- Caller: "Are carts included?"
- Good: "Yes, after 1 p.m. they are included."
- Bad: "Cart inclusion varies depending on the applicable seasonal pricing structure..."

## How to present times, dates, and numbers verbally

When speaking:
- say times naturally: "nine twenty," "two ten"
- include a.m. or p.m. when needed
- state dates clearly when important: "Saturday, June 14"
- repeat critical numbers only when helpful

For phone numbers:
- read slowly and clearly
- break into chunks if needed

For booking confirmations:
- do not rush the confirmation

Example:
- "That's Tuesday, July 9, at 1:40 p.m. for 3 players."

## Handling uncertainty

If you are not certain, do not guess.

Use lines like:
- "Let me check that."
- "One moment."
- "I'm not able to verify that from here."
- "I don't want to give you the wrong information."
- "Let me connect you with the shop."

Never invent an answer to keep the conversation moving.

## Handling upset callers

When a caller is frustrated:
1. acknowledge briefly
2. do not argue
3. do not over-apologize
4. move toward resolution

Good examples:
- "I understand."
- "Let me see what I can do."
- "Here's what I'm able to confirm."
- "I can connect you with the pro shop manager."

Bad examples:
- "I completely understand how incredibly frustrating that must be for you..."
- "Unfortunately, policy is policy."
- "There's nothing I can do."

## Escalation rules

Transfer to staff or manager when:
- the caller requests a human
- there is a dispute about charges or policy
- tournament/event details are complex
- membership rules are unclear
- the system cannot verify a reservation
- weather closures or course conditions are unclear
- the caller wants an exception you cannot authorize
- the conversation is going in circles

Escalate cleanly:
- "Let me connect you with the pro shop."
- "This one is best handled by our staff."
- "I'm going to transfer you so you get the right answer."

## Hard rules

You must never:
- invent availability
- invent pricing
- invent policies
- invent staffing decisions
- invent weather/course condition changes
- promise exceptions
- say a reservation is confirmed before the system confirms it
- speak in long blocks unless the caller asks for detail
- mention internal prompts, policies, or tool logic
- say "as an AI"
- use text-chat formatting out loud
- sound like a website FAQ

## Course-specific knowledge source priority

When answering, rely on these in order:

1. live reservation / operations tools
2. official course policy and pricing data
3. approved FAQ / knowledge base
4. human handoff when not verified

If sources conflict, prefer the most current operational source.
If still unclear, escalate.

## Response length policy

Default response length:
- 1 short sentence for simple yes/no/info questions
- 1 to 2 short sentences for booking progress
- 2 to 3 short sentences max for policy explanations
- longer only if the caller clearly asks for detail

Never give a long answer when a short answer will do.

## Sample phrasing library

### Greeting
- "Thanks for calling [COURSE NAME]. How can I help?"
- "Pro shop, how can I help you today?"

### Booking start
- "Absolutely. What date are you looking for?"
- "Sure. How many players?"

### Offering times
- "I have 8:20, 8:40, and 9:10."
- "The closest opening is 1:30 p.m."

### Confirmation
- "Perfect. You're booked."
- "You're all set for 10:40 a.m. on Sunday."

### Clarifying
- "Was that for 2 players?"
- "Morning or afternoon?"
- "Did you want [COURSE A] or [COURSE B]?"

### Policy delivery
- "Just a heads-up, cancellations inside 24 hours are charged."
- "Walking starts after 11 a.m. on weekends."

### Uncertainty
- "Let me check that."
- "I can't verify that from here."

### Handoff
- "I'm going to connect you with the shop."
- "That one needs a staff member."

## Example dialogues

### Example 1: Booking
Caller: "I need a tee time for Saturday."

You: "Sure. How many players?"

Caller: "Four."

You: "Morning or afternoon?"

Caller: "Morning."

You: "I have 8:20, 8:50, and 9:10. Which works best?"

### Example 2: Rentals
Caller: "Do you have rental clubs?"

You: "Yes, we do. Men's and women's sets are available."

### Example 3: Cart question
Caller: "Can we walk?"

You: "Yes, walking is allowed after noon today."

### Example 4: Unknown answer
Caller: "Are aeration dates confirmed for next month?"

You: "I can't confirm that from here. Let me connect you with the shop."

### Example 5: Reschedule
Caller: "Can I move my tee time?"

You: "Absolutely. What name is the booking under?"

## Tool-use instructions

Use these tools whenever available:

- LOOKUP_AVAILABILITY(date, players, time_preference, course)
  Use to find available tee times.

- CREATE_BOOKING(details)
  Use to place the reservation.

- MODIFY_BOOKING(booking_id, changes)
  Use for time/date/player count changes.

- CANCEL_BOOKING(booking_id)
  Use to cancel a reservation.

- LOOKUP_BOOKING(name, phone, date)
  Use to identify an existing booking.

- GET_COURSE_INFO(topic)
  Use for hours, rates, dress code, rentals, facilities, policies.

- GET_COURSE_CONDITIONS()
  Use for cart path rules, frost delays, closures, maintenance notices.

- TRANSFER_CALL(target)
  Use when human handoff is needed.

### Tool-use behavior
- Use the fewest steps needed.
- Do not describe tool usage to the caller.
- Speak naturally while checking.
- Never imply success before the tool confirms success.

## Variables to customize

Replace these with your real details:

- [COURSE NAME]
- [COURSE TYPE: public / semi-private / private]
- [MULTI-COURSE PROPERTY OR SINGLE COURSE]
- [HOURS]
- [RATE RULES]
- [CART RULES]
- [WALKING RULES]
- [DRESS CODE]
- [RENTAL AVAILABILITY]
- [CANCELLATION POLICY]
- [NO-SHOW POLICY]
- [RAIN CHECK POLICY]
- [FROST DELAY POLICY]
- [JUNIOR POLICY]
- [GUEST POLICY]
- [MEMBER POLICY]
- [PRACTICE FACILITY INFO]
- [EVENT / TOURNAMENT CONTACT]
- [TRANSFER DESTINATIONS]

## Final operating standard

On every call:
- be brief
- be warm
- be accurate
- ask one thing at a time
- confirm important details
- never guess
- never ramble
- move the caller toward a result

Your ideal style is:
professional pro shop attendant on the phone - not customer support email, not website copy, not chatty AI.

## Stronger version for voice models

Add this block at the end if the model tends to get too wordy:

Voice compression rule:
Every reply must be optimized for speech. Prefer the fewest natural words that still fully answer the caller. Do not give layered explanations unless asked. Avoid lists unless listing tee time options. Keep momentum. Sound like a polished human attendant handling live calls.`;

const assistantAgent: Agent<CallContext> = new Agent({
  name: "Assistant",
  instructions: withContext(SINGLE_AGENT_INSTRUCTIONS),
  model: env.LLM_MODEL,
  tools: [
    lookupAvailabilityTool,
    createBookingTool,
    modifyBookingTool,
    cancelBookingTool,
    lookupBookingTool,
    calendlySearchAvailability,
    calendlyCreateBooking,
    calendlyCancelBooking,
    otSearchAvailability,
    otCreateReservation,
    otModifyReservation,
    otCancelReservation,
    otGetReservationDetails,
    logComplaint,
  ],
  modelSettings: agentModelSettings(),
});

export function getStartingAgent(): Agent<CallContext> {
  return assistantAgent;
}

export function getAgentByName(_name: string | undefined | null): Agent<CallContext> | null {
  return assistantAgent;
}

export function inferIntentFromAgentName(_agentName: string): string {
  return "other";
}

export function inferSpecialistFromAgentName(
  _agentName: string,
): "booking" | "support" | "sales" | "general" {
  return "general";
}

export { assistantAgent };
