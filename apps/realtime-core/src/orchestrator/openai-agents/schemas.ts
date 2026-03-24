/**
 * schemas.ts
 *
 * Consolidated Zod schemas for all agent structured outputs.
 * OpenTable-ready booking structures with proper validation.
 */

import { z } from "zod";

// ─── Classification ───

export const ClassificationSchema = z.object({
  intent: z.enum([
    "create_booking",
    "modify_booking",
    "cancel_booking",
    "complaint",
    "info_request",
    "human_transfer",
    "other"
  ]),
  confidence: z.number().min(0).max(1)
});

export type Classification = z.infer<typeof ClassificationSchema>;

// ─── Dialogue Action Response ───
// Every dialogue agent MUST return this shape.
// This eliminates all string-matching for transfer/end detection.

export const AgentActionSchema = z.object({
  action: z.enum(["speak", "transfer", "end", "execute_tool"]),
  text: z.string().describe("What to say to the caller — always required"),
  toolCall: z.object({
    name: z.string(),
    args: z.string().describe("JSON-stringified arguments object")
  }).nullable().optional().describe("Only present when action is execute_tool")
});

export type AgentAction = z.infer<typeof AgentActionSchema>;

// ─── Booking Extraction (OpenTable-ready) ───

export const BookingDraftSchema = z.object({
  date_text: z.string().nullable().describe("Natural language date, e.g. 'tomorrow', 'next Friday'"),
  time_text: z.string().nullable().describe("Natural language time, e.g. '7pm', 'evening'"),
  party_size: z.number().int().min(1).max(20).nullable().describe("Number of guests"),
  customer_name: z.string().nullable().describe("Full name of the person making the reservation"),
  customer_phone: z.string().nullable().describe("Phone number in any format"),
  customer_email: z.string().email().nullable().describe("Email address for confirmation"),
  special_requests: z.string().nullable().describe("Dietary needs, accessibility, celebrations, etc."),
  seating_preference: z.enum(["indoor", "outdoor", "bar", "private", "no_preference"]).nullable()
});

export type BookingDraft = z.infer<typeof BookingDraftSchema>;

// ─── Booking Modification Extraction ───

export const BookingModifierSchema = z.object({
  reservation_id: z.string().nullable().describe("OpenTable reservation ID or confirmation number"),
  customer_name: z.string().nullable().describe("Name on the reservation for lookup"),
  customer_phone: z.string().nullable().describe("Phone number for lookup"),
  new_date_text: z.string().nullable().describe("New date if changing"),
  new_time_text: z.string().nullable().describe("New time if changing"),
  new_party_size: z.number().int().min(1).max(20).nullable().describe("New party size if changing"),
  new_special_requests: z.string().nullable()
});

export type BookingModifier = z.infer<typeof BookingModifierSchema>;

// ─── Cancellation Extraction ───

export const CancellationSchema = z.object({
  reservation_id: z.string().nullable().describe("OpenTable reservation ID or confirmation number"),
  customer_name: z.string().nullable().describe("Name on the reservation for lookup"),
  customer_phone: z.string().nullable().describe("Phone number for lookup"),
  cancellation_confirmed: z.boolean().default(false).describe("true ONLY if caller explicitly confirms cancellation")
});

export type Cancellation = z.infer<typeof CancellationSchema>;

// ─── Complaint Extraction ───

export const ComplaintSchema = z.object({
  issue_summary: z.string().describe("Brief summary of the complaint"),
  customer_name: z.string().nullable(),
  customer_phone: z.string().nullable(),
  visit_date: z.string().nullable().describe("When the visit occurred"),
  urgency: z.enum(["low", "medium", "high"]).default("medium").describe(
    "high: safety/health issues; medium: service problems; low: minor inconveniences"
  )
});

export type Complaint = z.infer<typeof ComplaintSchema>;

// ─── Date/Time Normalization ───

export const DateTimeNormalizationSchema = z.object({
  normalized_date: z.string().describe("ISO 8601 date string, e.g. 2026-02-17"),
  normalized_time: z.string().describe("24h format, e.g. 19:00"),
  confidence: z.enum(["high", "medium", "low"]),
  clarification_needed: z.boolean(),
  clarification_question: z.string().nullable()
});

export type DateTimeNormalization = z.infer<typeof DateTimeNormalizationSchema>;

// ─── OpenTable API Schemas ───

export const OpenTableAvailabilityRequestSchema = z.object({
  restaurant_id: z.string(),
  date: z.string().describe("ISO 8601 date"),
  party_size: z.number().int().min(1).max(20),
  time_start: z.string().nullable().describe("Start of search window, 24h format"),
  time_end: z.string().nullable().describe("End of search window, 24h format")
});

export const OpenTableReservationSchema = z.object({
  restaurant_id: z.string(),
  date: z.string().describe("ISO 8601 date"),
  time: z.string().describe("24h format, e.g. 19:00"),
  party_size: z.number().int().min(1).max(20),
  customer_name: z.string(),
  customer_phone: z.string(),
  customer_email: z.string().email().nullable(),
  special_requests: z.string().nullable(),
  seating_preference: z.enum(["indoor", "outdoor", "bar", "private", "no_preference"]).nullable()
});

export const OpenTableModifySchema = z.object({
  reservation_id: z.string(),
  new_date: z.string().nullable(),
  new_time: z.string().nullable(),
  new_party_size: z.number().int().min(1).max(20).nullable(),
  new_special_requests: z.string().nullable()
});

export const OpenTableCancelSchema = z.object({
  reservation_id: z.string()
});

export const OpenTableLookupSchema = z.object({
  reservation_id: z.string().nullable(),
  customer_phone: z.string().nullable(),
  customer_name: z.string().nullable()
});

// ─── Slot requirement definitions per intent ───

export type BookingProvider = "calendly" | "opentable" | "none";

const OPENTABLE_BOOKING_SLOTS = ["date_text", "time_text", "party_size", "customer_name"];
const CALENDLY_BOOKING_SLOTS = ["date_text", "customer_name", "customer_email"];

export function getRequiredSlots(intent: string, provider: BookingProvider = "opentable"): string[] {
  const base: Record<string, string[]> = {
    create_booking: provider === "calendly" ? CALENDLY_BOOKING_SLOTS : OPENTABLE_BOOKING_SLOTS,
    modify_booking: ["reservation_id_or_lookup", "modification_details"],
    cancel_booking: ["reservation_id_or_lookup", "cancellation_confirmed"],
    complaint: ["issue_summary"],
    info_request: [],
    human_transfer: [],
    other: [],
  };
  return base[intent] || [];
}

export const REQUIRED_SLOTS: Record<string, string[]> = {
  create_booking: OPENTABLE_BOOKING_SLOTS,
  modify_booking: ["reservation_id_or_lookup", "modification_details"],
  cancel_booking: ["reservation_id_or_lookup", "cancellation_confirmed"],
  complaint: ["issue_summary"],
  info_request: [],
  human_transfer: [],
  other: [],
};

/**
 * Map from intent to extractor schema.
 * Returns ZodObject to satisfy the OpenAI Agents SDK outputType constraint.
 */
export function getExtractorSchema(intent: string): z.ZodObject<any> | undefined {
  const schemas: Record<string, z.ZodObject<any>> = {
    create_booking: BookingDraftSchema,
    modify_booking: BookingModifierSchema,
    cancel_booking: CancellationSchema,
    complaint: ComplaintSchema,
  };
  return schemas[intent];
}
