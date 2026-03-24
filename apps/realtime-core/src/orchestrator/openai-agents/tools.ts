/**
 * tools.ts
 *
 * OpenTable-ready tool definitions for the agent pipeline.
 *
 * These are OpenAI Agents SDK function tools that dialogue agents can invoke.
 * Each tool maps to a platform-api /tool/call endpoint, executed via toolClient.
 *
 * Tool execution flow:
 *   Agent decides to call tool → workflow intercepts → calls platform-api toolbus
 *   → toolbus routes to OpenTable connector → result returned to agent
 */

import { tool } from "@openai/agents";
import { z } from "zod";
import { createLogger } from "@rezovo/logging";
import { callTool } from "../../toolClient";
import { sessionStore } from "./sessionStore";
import * as calendly from "../../calendlyClient";

const logger = createLogger({ service: "realtime-core", module: "tools" });

// ─── Tool Context (injected at call start) ───

export interface ToolContext {
  tenantId: string;
  businessId: string;
  callId: string;
  restaurantId?: string;
  calendlyAccessToken?: string;
  calendlyEventTypeUri?: string;
  calendlyTimezone?: string;
}

// ─── Search Availability ───

export function createSearchAvailabilityTool(ctx: ToolContext) {
  return tool({
    name: "search_availability",
    description:
      "Search for available reservation time slots on OpenTable. " +
      "Use this BEFORE creating a reservation to show the customer available times. " +
      "Returns a list of available time slots for the given date and party size.",
    parameters: z.object({
      date: z.string().describe("ISO 8601 date, e.g. '2026-02-18'"),
      party_size: z.number().int().min(1).max(20).describe("Number of guests"),
      time_preference: z.string().nullable().optional().describe("Preferred time in 24h format, e.g. '19:00'. Used to center the search window."),
    }),
    execute: async (args) => {
      logger.info("tool: search_availability", { callId: ctx.callId, args });

      const idempotencyKey = sessionStore.generateIdempotencyKey(
        ctx.callId, "search_availability", args
      );

      // Check idempotent cache
      const cached = await sessionStore.getIdempotentResult(idempotencyKey);
      if (cached) return cached;

      try {
        const result = await callTool({
          tenantId: ctx.tenantId,
          toolName: "search_availability",
          args: {
            restaurant_id: ctx.restaurantId,
            date: args.date,
            party_size: args.party_size,
            time_preference: args.time_preference,
          },
          idempotencyKey,
        });

        await sessionStore.setIdempotentResult(idempotencyKey, result);
        return result;
      } catch (err) {
        logger.error("search_availability failed", {
          callId: ctx.callId,
          error: (err as Error).message,
        });
        return {
          error: true,
          message: "Unable to check availability right now. Please try again in a moment.",
        };
      }
    },
  });
}

// ─── Create Reservation ───

export function createReservationTool(ctx: ToolContext) {
  return tool({
    name: "create_reservation",
    description:
      "Create a new restaurant reservation on OpenTable. " +
      "ONLY call this after the customer has confirmed all details (date, time, party size, name). " +
      "The customer MUST explicitly confirm before you call this tool.",
    parameters: z.object({
      date: z.string().describe("ISO 8601 date, e.g. '2026-02-18'"),
      time: z.string().describe("Time in 24h format, e.g. '19:00'"),
      party_size: z.number().int().min(1).max(20).describe("Number of guests"),
      customer_name: z.string().describe("Full name for the reservation"),
      customer_phone: z.string().describe("Phone number for confirmation"),
      customer_email: z.string().nullable().optional().describe("Email for confirmation"),
      special_requests: z.string().nullable().optional().describe("Dietary needs, celebrations, seating preferences, etc."),
      seating_preference: z.enum(["indoor", "outdoor", "bar", "private", "no_preference"]).nullable().optional(),
    }),
    execute: async (args) => {
      logger.info("tool: create_reservation", { callId: ctx.callId, args: { ...args, customer_phone: "***" } });

      const idempotencyKey = sessionStore.generateIdempotencyKey(
        ctx.callId, "create_reservation", args
      );

      // Critical: check idempotent cache to prevent double booking
      const cached = await sessionStore.getIdempotentResult(idempotencyKey);
      if (cached) {
        logger.info("create_reservation: returning cached result (duplicate prevention)", { callId: ctx.callId });
        return cached;
      }

      try {
        const result = await callTool({
          tenantId: ctx.tenantId,
          toolName: "create_reservation",
          args: {
            restaurant_id: ctx.restaurantId,
            ...args,
          },
          idempotencyKey,
        });

        await sessionStore.setIdempotentResult(idempotencyKey, result);

        logger.info("reservation created", {
          callId: ctx.callId,
          customer_name: args.customer_name,
        });

        return result;
      } catch (err) {
        logger.error("create_reservation failed", {
          callId: ctx.callId,
          error: (err as Error).message,
        });
        return {
          error: true,
          message: "I wasn't able to complete the reservation. Let me connect you with someone who can help.",
        };
      }
    },
  });
}

// ─── Modify Reservation ───

export function createModifyReservationTool(ctx: ToolContext) {
  return tool({
    name: "modify_reservation",
    description:
      "Modify an existing OpenTable reservation. " +
      "You must have the reservation_id (from get_reservation_details) before calling this. " +
      "Only include fields that are changing — omit fields that stay the same.",
    parameters: z.object({
      reservation_id: z.string().describe("OpenTable reservation ID"),
      new_date: z.string().nullable().optional().describe("New ISO 8601 date if changing"),
      new_time: z.string().nullable().optional().describe("New time in 24h format if changing"),
      new_party_size: z.number().int().min(1).max(20).nullable().optional().describe("New party size if changing"),
      new_special_requests: z.string().nullable().optional().describe("Updated special requests"),
    }),
    execute: async (args) => {
      logger.info("tool: modify_reservation", { callId: ctx.callId, reservation_id: args.reservation_id });

      const idempotencyKey = sessionStore.generateIdempotencyKey(
        ctx.callId, "modify_reservation", args
      );

      const cached = await sessionStore.getIdempotentResult(idempotencyKey);
      if (cached) return cached;

      try {
        const result = await callTool({
          tenantId: ctx.tenantId,
          toolName: "modify_reservation",
          args: {
            restaurant_id: ctx.restaurantId,
            ...args,
          },
          idempotencyKey,
        });

        await sessionStore.setIdempotentResult(idempotencyKey, result);
        return result;
      } catch (err) {
        logger.error("modify_reservation failed", {
          callId: ctx.callId,
          error: (err as Error).message,
        });
        return {
          error: true,
          message: "I wasn't able to modify the reservation. Let me connect you with someone who can help.",
        };
      }
    },
  });
}

// ─── Cancel Reservation ───

export function createCancelReservationTool(ctx: ToolContext) {
  return tool({
    name: "cancel_reservation",
    description:
      "Cancel an existing OpenTable reservation. " +
      "You must have the reservation_id (from get_reservation_details) before calling this. " +
      "The customer MUST explicitly confirm the cancellation before you call this tool.",
    parameters: z.object({
      reservation_id: z.string().describe("OpenTable reservation ID"),
    }),
    execute: async (args) => {
      logger.info("tool: cancel_reservation", { callId: ctx.callId, reservation_id: args.reservation_id });

      const idempotencyKey = sessionStore.generateIdempotencyKey(
        ctx.callId, "cancel_reservation", args
      );

      const cached = await sessionStore.getIdempotentResult(idempotencyKey);
      if (cached) return cached;

      try {
        const result = await callTool({
          tenantId: ctx.tenantId,
          toolName: "cancel_reservation",
          args: {
            restaurant_id: ctx.restaurantId,
            ...args,
          },
          idempotencyKey,
        });

        await sessionStore.setIdempotentResult(idempotencyKey, result);
        return result;
      } catch (err) {
        logger.error("cancel_reservation failed", {
          callId: ctx.callId,
          error: (err as Error).message,
        });
        return {
          error: true,
          message: "I wasn't able to cancel the reservation. Let me connect you with someone who can help.",
        };
      }
    },
  });
}

// ─── Get Reservation Details ───

export function createGetReservationDetailsTool(ctx: ToolContext) {
  return tool({
    name: "get_reservation_details",
    description:
      "Look up an existing reservation by reservation ID, or by customer name and phone number. " +
      "Use this to find a reservation before modifying or cancelling it.",
    parameters: z.object({
      reservation_id: z.string().nullable().optional().describe("OpenTable reservation ID or confirmation number"),
      customer_phone: z.string().nullable().optional().describe("Customer phone number for lookup"),
      customer_name: z.string().nullable().optional().describe("Customer name for lookup"),
    }),
    execute: async (args) => {
      logger.info("tool: get_reservation_details", { callId: ctx.callId });

      if (!args.reservation_id && !args.customer_phone && !args.customer_name) {
        return {
          error: true,
          message: "Need at least a reservation ID, or customer name and phone number to look up a reservation.",
        };
      }

      try {
        const result = await callTool({
          tenantId: ctx.tenantId,
          toolName: "get_reservation_details",
          args: {
            restaurant_id: ctx.restaurantId,
            ...args,
          },
        });

        return result;
      } catch (err) {
        logger.error("get_reservation_details failed", {
          callId: ctx.callId,
          error: (err as Error).message,
        });
        return {
          error: true,
          message: "I wasn't able to find that reservation. Could you double-check the details?",
        };
      }
    },
  });
}

// ─── Send Confirmation SMS ───

export function createSendConfirmationSmsTool(ctx: ToolContext) {
  return tool({
    name: "send_confirmation_sms",
    description:
      "Send an SMS confirmation message to the customer. " +
      "Use this after successfully creating or modifying a reservation.",
    parameters: z.object({
      phone_number: z.string().describe("Customer phone number in E.164 format"),
      message: z.string().describe("Confirmation message to send"),
    }),
    execute: async (args) => {
      logger.info("tool: send_confirmation_sms", { callId: ctx.callId });

      const idempotencyKey = sessionStore.generateIdempotencyKey(
        ctx.callId, "send_confirmation_sms", args
      );

      const cached = await sessionStore.getIdempotentResult(idempotencyKey);
      if (cached) return cached;

      try {
        const result = await callTool({
          tenantId: ctx.tenantId,
          toolName: "send_sms",
          args: {
            to: args.phone_number,
            body: args.message,
          },
          idempotencyKey,
        });

        await sessionStore.setIdempotentResult(idempotencyKey, result);
        return result;
      } catch (err) {
        logger.error("send_confirmation_sms failed", {
          callId: ctx.callId,
          error: (err as Error).message,
        });
        // SMS failure is non-critical — don't block the flow
        return {
          error: true,
          message: "SMS delivery is temporarily unavailable, but the reservation is confirmed.",
        };
      }
    },
  });
}

// ─── Calendly: Search Available Times ───

export function createCalendlySearchAvailabilityTool(ctx: ToolContext) {
  return tool({
    name: "calendly_search_availability",
    description:
      "Search for available appointment time slots on Calendly. " +
      "Returns a list of open times for the next 7 days from the given start date. " +
      "Present 2-3 convenient options to the caller.",
    parameters: z.object({
      start_date: z.string().describe("ISO 8601 date to start searching from, e.g. '2026-03-07'"),
      end_date: z.string().nullable().optional().describe("ISO 8601 end date, max 7 days from start. Defaults to 7 days out."),
    }),
    execute: async (args) => {
      if (!ctx.calendlyAccessToken) {
        return { error: true, message: "Calendly integration is not configured." };
      }

      logger.info("tool: calendly_search_availability", { callId: ctx.callId, args });

      try {
        const eventTypeUri = ctx.calendlyEventTypeUri
          || await calendly.resolveEventTypeUri(ctx.calendlyAccessToken);

        const startTime = `${args.start_date}T00:00:00Z`;
        const endDate = args.end_date || new Date(
          new Date(args.start_date).getTime() + 7 * 24 * 60 * 60 * 1000
        ).toISOString().split("T")[0];
        const endTime = `${endDate}T23:59:59Z`;

        const slots = await calendly.getAvailableTimes(
          ctx.calendlyAccessToken, eventTypeUri, startTime, endTime
        );

        const formatted = slots.slice(0, 10).map((s) => {
          const d = new Date(s.start_time);
          return {
            start_time: s.start_time,
            display: d.toLocaleString("en-US", {
              weekday: "long", month: "short", day: "numeric",
              hour: "numeric", minute: "2-digit",
              timeZone: ctx.calendlyTimezone || "America/New_York",
            }),
          };
        });

        return { available_slots: formatted, total_found: slots.length };
      } catch (err) {
        logger.error("calendly_search_availability failed", {
          callId: ctx.callId, error: (err as Error).message,
        });
        return { error: true, message: "Unable to check availability right now." };
      }
    },
  });
}

// ─── Calendly: Create Booking ───

export function createCalendlyCreateBookingTool(ctx: ToolContext) {
  return tool({
    name: "calendly_create_booking",
    description:
      "Book an appointment on Calendly. The caller MUST explicitly confirm all details " +
      "before you call this. Requires name, email, and a valid start_time from the " +
      "availability search.",
    parameters: z.object({
      start_time: z.string().describe("UTC ISO 8601 start time from availability search"),
      invitee_name: z.string().describe("Full name of the caller"),
      invitee_email: z.string().describe("Email address of the caller"),
      phone_number: z.string().nullable().optional().describe("Phone number for SMS reminder, E.164 format"),
    }),
    execute: async (args) => {
      if (!ctx.calendlyAccessToken) {
        return { error: true, message: "Calendly integration is not configured." };
      }

      logger.info("tool: calendly_create_booking", {
        callId: ctx.callId, name: args.invitee_name, start: args.start_time,
      });

      const idempotencyKey = sessionStore.generateIdempotencyKey(
        ctx.callId, "calendly_create_booking", args
      );

      const cached = await sessionStore.getIdempotentResult(idempotencyKey);
      if (cached) {
        logger.info("calendly_create_booking: returning cached result", { callId: ctx.callId });
        return cached;
      }

      try {
        const eventTypeUri = ctx.calendlyEventTypeUri
          || await calendly.resolveEventTypeUri(ctx.calendlyAccessToken);

        const invitee = await calendly.createInvitee(ctx.calendlyAccessToken, {
          eventTypeUri,
          startTime: args.start_time,
          inviteeName: args.invitee_name,
          inviteeEmail: args.invitee_email,
          inviteeTimezone: ctx.calendlyTimezone || "America/New_York",
          locationKind: "outbound_call",
          locationValue: args.phone_number ?? undefined,
          phoneNumber: args.phone_number ?? undefined,
        });

        const result = {
          success: true,
          event_uri: invitee.event,
          cancel_url: invitee.cancel_url,
          reschedule_url: invitee.reschedule_url,
          message: `Appointment confirmed for ${args.invitee_name}.`,
        };

        await sessionStore.setIdempotentResult(idempotencyKey, result);
        return result;
      } catch (err) {
        logger.error("calendly_create_booking failed", {
          callId: ctx.callId, error: (err as Error).message,
        });
        return {
          error: true,
          message: "I wasn't able to complete the booking. Let me connect you with someone who can help.",
        };
      }
    },
  });
}

// ─── Calendly: Cancel Booking ───

export function createCalendlyCancelBookingTool(ctx: ToolContext) {
  return tool({
    name: "calendly_cancel_booking",
    description:
      "Cancel an existing Calendly appointment. Requires the event URI from a previous " +
      "booking lookup. The caller MUST explicitly confirm the cancellation.",
    parameters: z.object({
      event_uri: z.string().describe("Calendly event URI to cancel"),
      reason: z.string().nullable().optional().describe("Reason for cancellation"),
    }),
    execute: async (args) => {
      if (!ctx.calendlyAccessToken) {
        return { error: true, message: "Calendly integration is not configured." };
      }

      logger.info("tool: calendly_cancel_booking", { callId: ctx.callId, event: args.event_uri });

      try {
        await calendly.cancelEvent(ctx.calendlyAccessToken, args.event_uri, args.reason ?? undefined);
        return { success: true, message: "The appointment has been cancelled." };
      } catch (err) {
        logger.error("calendly_cancel_booking failed", {
          callId: ctx.callId, error: (err as Error).message,
        });
        return { error: true, message: "I wasn't able to cancel that appointment." };
      }
    },
  });
}

// ─── Calendly: Get Event Types ───

export function createCalendlyGetEventTypesTool(ctx: ToolContext) {
  return tool({
    name: "calendly_get_event_types",
    description:
      "List available appointment types from Calendly. Use this to determine " +
      "which type of appointment the caller needs if there are multiple options.",
    parameters: z.object({}),
    execute: async () => {
      if (!ctx.calendlyAccessToken) {
        return { error: true, message: "Calendly integration is not configured." };
      }

      try {
        const types = await calendly.getEventTypes(ctx.calendlyAccessToken);
        return {
          event_types: types.map((t) => ({
            uri: t.uri,
            name: t.name,
            duration: t.duration,
            kind: t.kind,
            active: t.active,
          })),
        };
      } catch (err) {
        logger.error("calendly_get_event_types failed", {
          callId: ctx.callId, error: (err as Error).message,
        });
        return { error: true, message: "Unable to retrieve appointment types." };
      }
    },
  });
}

// ─── Log Complaint ───

export function createLogComplaintTool(ctx: ToolContext) {
  return tool({
    name: "log_complaint",
    description:
      "Record a customer complaint so a manager can follow up. " +
      "Call this once you have the caller's issue summary and contact info.",
    parameters: z.object({
      issue_summary: z.string().describe("Brief description of the complaint"),
      customer_name: z.string().describe("Caller's name"),
      customer_phone: z.string().nullable().optional().describe("Callback phone number"),
      customer_email: z.string().nullable().optional().describe("Email address"),
      urgency: z.enum(["low", "medium", "high"]).nullable().optional().describe("Severity level"),
    }),
    execute: async (args) => {
      logger.info("tool: log_complaint", { callId: ctx.callId, urgency: args.urgency || "medium" });

      try {
        const result = await callTool({
          tenantId: ctx.tenantId,
          toolName: "log_complaint",
          args: { ...args, callId: ctx.callId },
        });
        return result;
      } catch (err) {
        logger.warn("log_complaint persistence failed, complaint noted in transcript", {
          callId: ctx.callId, error: (err as Error).message,
        });
        return {
          success: true,
          message: "Your complaint has been noted and a manager will follow up within 24 hours.",
        };
      }
    },
  });
}

// ─── Tool Registry Builder ───

/**
 * Build the set of tools available for a given intent and configuration.
 * Includes OpenTable tools when restaurantId is set, Calendly tools when
 * calendlyAccessToken is set. Both can coexist per tenant.
 */
export function buildToolsForIntent(
  intent: string,
  ctx: ToolContext,
  allowedTools: string[]
): ReturnType<typeof tool>[] {
  const tools: ReturnType<typeof tool>[] = [];
  const hasCalendly = !!ctx.calendlyAccessToken;
  const hasOpenTable = !!ctx.restaurantId;

  switch (intent) {
    case "create_booking":
      if (hasCalendly) {
        tools.push(createCalendlySearchAvailabilityTool(ctx));
        tools.push(createCalendlyCreateBookingTool(ctx));
        if (!ctx.calendlyEventTypeUri) {
          tools.push(createCalendlyGetEventTypesTool(ctx));
        }
      }
      if (hasOpenTable) {
        if (allowedTools.includes("search_availability") || allowedTools.includes("book_appointment")) {
          tools.push(createSearchAvailabilityTool(ctx));
        }
        if (allowedTools.includes("book_appointment") || allowedTools.includes("create_reservation")) {
          tools.push(createReservationTool(ctx));
        }
      }
      break;

    case "modify_booking":
      if (hasCalendly) {
        tools.push(createCalendlySearchAvailabilityTool(ctx));
        tools.push(createCalendlyCreateBookingTool(ctx));
        tools.push(createCalendlyCancelBookingTool(ctx));
      }
      if (hasOpenTable) {
        tools.push(createGetReservationDetailsTool(ctx));
        if (allowedTools.includes("book_appointment") || allowedTools.includes("modify_reservation")) {
          tools.push(createModifyReservationTool(ctx));
        }
      }
      break;

    case "cancel_booking":
      if (hasCalendly) {
        tools.push(createCalendlyCancelBookingTool(ctx));
      }
      if (hasOpenTable) {
        tools.push(createGetReservationDetailsTool(ctx));
        if (allowedTools.includes("book_appointment") || allowedTools.includes("cancel_reservation")) {
          tools.push(createCancelReservationTool(ctx));
        }
      }
      break;

    case "complaint":
      tools.push(createLogComplaintTool(ctx));
      break;
  }

  if (
    allowedTools.includes("send_sms") &&
    ["create_booking", "modify_booking", "cancel_booking"].includes(intent)
  ) {
    tools.push(createSendConfirmationSmsTool(ctx));
  }

  return tools;
}
