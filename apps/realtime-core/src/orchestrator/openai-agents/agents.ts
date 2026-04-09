/**
 * agents.ts -- Static agent and tool definitions following the OpenAI Agents SDK patterns.
 *
 * References:
 *   https://github.com/openai/openai-agents-js/blob/main/examples/agent-patterns/routing.ts
 *   https://github.com/openai/openai-agents-js/blob/main/examples/customer-service
 *   https://github.com/openai/openai-agents-js/blob/main/examples/realtime-twilio-sip/agents.ts
 *
 * Key principles from the SDK examples:
 *   - Agents defined ONCE at module scope (not recreated per turn)
 *   - Tools defined ONCE, access per-call data via RunContext
 *   - Handoffs are bidirectional (specialists can route back to triage)
 *   - Dynamic instructions inject runtime context (KB passages, datetime, etc.)
 *   - run() manages history, agent routing, and tool calls natively
 */

import { Agent, tool } from "@openai/agents";
import type { RunContext } from "@openai/agents";
import { z } from "zod";
import { createLogger } from "@rezovo/logging";
import { callTool } from "../../toolClient";
import * as calendly from "../../calendlyClient";
import { env } from "../../env";
import { resolveModelSettingsForModel } from "./modelGuardrails";

const logger = createLogger({ service: "realtime-core", module: "agents" });

// ---- Per-call context, passed to run() and accessible in tools via RunContext ----

export interface CallContext {
  tenantId: string;
  businessId: string;
  callId: string;
  /** Call start timestamp (ISO) captured when the call session was created */
  currentDateTime: string;
  calendlyAccessToken?: string;
  calendlyEventTypeUri?: string;
  calendlyTimezone?: string;
  restaurantId?: string;
  kbPassages: string[];
  openingHours?: string;
}

// ---- Shared voice directive ----

const VOICE_DIRECTIVE =
  "You are on a live phone call. Keep every reply to 1-2 short sentences. " +
  "Be warm and natural. Reply with ONLY what you would say out loud to the caller. Nothing else.";

function agentModelSettings() {
  return resolveModelSettingsForModel(env.LLM_MODEL, {
    maxTokens: 120,
    reasoning: { effort: "low" },
  });
}

// ---- Dynamic instructions builder (Phase 2: injects KB passages at runtime) ----

function withContext(basePrompt: string) {
  return (ctx: RunContext<CallContext>): string => {
    const c = ctx.context;
    const parts = [basePrompt, VOICE_DIRECTIVE];
    parts.push(`Current date/time: ${c.currentDateTime || new Date().toISOString()}`);
    if (c.calendlyTimezone) {
      parts.push(`Business timezone: ${c.calendlyTimezone}`);
    }
    if (c.openingHours) {
      parts.push(`Business hours: ${c.openingHours}`);
    }
    if (c.kbPassages.length > 0) {
      parts.push("Relevant business knowledge:");
      c.kbPassages.forEach((p, i) => parts.push(`  [${i + 1}] ${p}`));
    }
    return parts.join("\n");
  };
}

// ============================================================================
// TOOLS -- defined once at module scope, per-call data via RunContext
// ============================================================================

// ---- Calendly: Search Availability ----

const calendlySearchSchema = z.object({
  start_date: z.string().describe("ISO 8601 date to start searching, e.g. '2026-03-07'"),
});

const calendlySearchAvailability = tool<typeof calendlySearchSchema, CallContext>({
  name: "calendly_search_availability",
  description:
    "Search for available appointment time slots on Calendly. " +
    "Returns open slots for the next 7 days from the given start date.",
  parameters: calendlySearchSchema,
  async execute(args, ctx) {
    const cc = ctx!.context;
    if (!cc.calendlyAccessToken) return "Calendly is not configured for this business.";
    logger.info("tool: calendly_search_availability", { callId: cc.callId, args });
    try {
      const eventTypeUri =
        cc.calendlyEventTypeUri ||
        (await calendly.resolveEventTypeUri(cc.calendlyAccessToken));
      const startTime = `${args.start_date}T00:00:00Z`;
      const endDate = new Date(
        new Date(args.start_date).getTime() + 7 * 86_400_000,
      )
        .toISOString()
        .split("T")[0];
      const endTime = `${endDate}T23:59:59Z`;
      const slots = await calendly.getAvailableTimes(
        cc.calendlyAccessToken,
        eventTypeUri,
        startTime,
        endTime,
      );
      const formatted = slots.slice(0, 10).map((s) => {
        const d = new Date(s.start_time);
        return {
          start_time: s.start_time,
          display: d.toLocaleString("en-US", {
            weekday: "long",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            timeZone: cc.calendlyTimezone || "America/New_York",
          }),
        };
      });
      return JSON.stringify({ available_slots: formatted, total_found: slots.length });
    } catch (err) {
      logger.error("calendly_search_availability failed", {
        callId: cc.callId,
        error: (err as Error).message,
      });
      return "Unable to check availability right now. Please try again in a moment.";
    }
  },
});

// ---- Calendly: Create Booking ----

const calendlyCreateSchema = z.object({
  start_time: z.string().describe("UTC ISO 8601 start time from availability search"),
  invitee_name: z.string().describe("Full name of the caller"),
  invitee_email: z.string().describe("Email address of the caller"),
});

const calendlyCreateBooking = tool<typeof calendlyCreateSchema, CallContext>({
  name: "calendly_create_booking",
  description:
    "Book an appointment on Calendly. Requires name, email, and a start_time from the " +
    "availability search. The caller MUST explicitly confirm all details before you call this.",
  parameters: calendlyCreateSchema,
  async execute(args, ctx) {
    const cc = ctx!.context;
    if (!cc.calendlyAccessToken) return "Calendly is not configured for this business.";
    logger.info("tool: calendly_create_booking", {
      callId: cc.callId,
      name: args.invitee_name,
    });
    try {
      const eventTypeUri =
        cc.calendlyEventTypeUri ||
        (await calendly.resolveEventTypeUri(cc.calendlyAccessToken));
      const invitee = await calendly.createInvitee(cc.calendlyAccessToken, {
        eventTypeUri,
        startTime: args.start_time,
        inviteeName: args.invitee_name,
        inviteeEmail: args.invitee_email,
        inviteeTimezone: cc.calendlyTimezone || "America/New_York",
      });
      return JSON.stringify({
        success: true,
        message: `Appointment confirmed for ${args.invitee_name}.`,
        event_uri: invitee.event,
      });
    } catch (err) {
      logger.error("calendly_create_booking failed", {
        callId: cc.callId,
        error: (err as Error).message,
      });
      return "Unable to complete the booking. Let me connect you with someone who can help.";
    }
  },
});

// ---- Calendly: Cancel Booking ----

const calendlyCancelSchema = z.object({
  event_uri: z.string().describe("Calendly event URI to cancel"),
  reason: z.string().nullable().optional().describe("Reason for cancellation"),
});

const calendlyCancelBooking = tool<typeof calendlyCancelSchema, CallContext>({
  name: "calendly_cancel_booking",
  description:
    "Cancel an existing Calendly appointment. Requires the event URI. " +
    "The caller MUST explicitly confirm the cancellation before you call this.",
  parameters: calendlyCancelSchema,
  async execute(args, ctx) {
    const cc = ctx!.context;
    if (!cc.calendlyAccessToken) return "Calendly is not configured for this business.";
    logger.info("tool: calendly_cancel_booking", { callId: cc.callId });
    try {
      await calendly.cancelEvent(
        cc.calendlyAccessToken,
        args.event_uri,
        args.reason ?? undefined,
      );
      return JSON.stringify({ success: true, message: "The appointment has been cancelled." });
    } catch (err) {
      logger.error("calendly_cancel_booking failed", {
        callId: cc.callId,
        error: (err as Error).message,
      });
      return "Unable to cancel that appointment.";
    }
  },
});

// ---- Complaint: Log ----

const logComplaintSchema = z.object({
  issue_summary: z.string().describe("Brief description of the complaint"),
  customer_name: z.string().describe("Caller's name"),
  customer_phone: z.string().nullable().optional().describe("Callback phone number"),
});

const logComplaint = tool<typeof logComplaintSchema, CallContext>({
  name: "log_complaint",
  description:
    "Record a customer complaint so a manager can follow up. " +
    "Call this once you have the caller's issue summary and contact info.",
  parameters: logComplaintSchema,
  async execute(args, ctx) {
    const cc = ctx!.context;
    logger.info("tool: log_complaint", { callId: cc.callId });
    try {
      await callTool({
        tenantId: cc.tenantId,
        toolName: "log_complaint",
        args: { ...args, callId: cc.callId },
      });
    } catch (err) {
      logger.warn("log_complaint persistence failed", {
        callId: cc.callId,
        error: (err as Error).message,
      });
    }
    return "Your complaint has been noted. A manager will follow up within 24 hours.";
  },
});

// ---- OpenTable: Search Availability ----

const otSearchSchema = z.object({
  date: z.string().describe("ISO 8601 date, e.g. '2026-02-18'"),
  party_size: z.number().int().min(1).max(20).describe("Number of guests"),
  time_preference: z
    .string()
    .nullable()
    .optional()
    .describe("Preferred time in 24h format, e.g. '19:00'"),
});

const otSearchAvailability = tool<typeof otSearchSchema, CallContext>({
  name: "search_availability",
  description: "Search for available restaurant reservation time slots on OpenTable.",
  parameters: otSearchSchema,
  async execute(args, ctx) {
    const cc = ctx!.context;
    if (!cc.restaurantId) return "OpenTable is not configured for this business.";
    logger.info("tool: search_availability", { callId: cc.callId, args });
    try {
      const result = await callTool({
        tenantId: cc.tenantId,
        toolName: "search_availability",
        args: { restaurant_id: cc.restaurantId, ...args },
      });
      return JSON.stringify(result);
    } catch (err) {
      logger.error("search_availability failed", {
        callId: cc.callId,
        error: (err as Error).message,
      });
      return "Unable to check availability right now.";
    }
  },
});

// ---- OpenTable: Create Reservation ----

const otCreateSchema = z.object({
  date: z.string().describe("ISO 8601 date"),
  time: z.string().describe("Time in 24h format, e.g. '19:00'"),
  party_size: z.number().int().min(1).max(20).describe("Number of guests"),
  customer_name: z.string().describe("Full name for the reservation"),
  customer_phone: z.string().describe("Phone number for confirmation"),
});

const otCreateReservation = tool<typeof otCreateSchema, CallContext>({
  name: "create_reservation",
  description:
    "Create a new restaurant reservation on OpenTable. " +
    "The customer MUST explicitly confirm all details before you call this.",
  parameters: otCreateSchema,
  async execute(args, ctx) {
    const cc = ctx!.context;
    if (!cc.restaurantId) return "OpenTable is not configured for this business.";
    logger.info("tool: create_reservation", { callId: cc.callId });
    try {
      const result = await callTool({
        tenantId: cc.tenantId,
        toolName: "create_reservation",
        args: { restaurant_id: cc.restaurantId, ...args },
      });
      return JSON.stringify(result);
    } catch (err) {
      logger.error("create_reservation failed", {
        callId: cc.callId,
        error: (err as Error).message,
      });
      return "Unable to complete the reservation. Let me connect you with someone who can help.";
    }
  },
});

// ============================================================================
// AGENTS -- defined once at module scope with bidirectional handoffs
// ============================================================================

const bookingAgent: Agent<CallContext> = new Agent({
  name: "Booking Specialist",
  handoffDescription: "Handles new appointment and reservation bookings",
  instructions: withContext(
    "You help callers schedule appointments and reservations.\n" +
      "Never announce yourself or mention being a specialist. Just respond naturally as if you are the person they called.\n" +
      "When someone wants to book, ask what day and time works best for them.\n" +
      "Then ask for their full name and email address.\n" +
      "Ensure to format the address properly, for example john.doe@example.com.\n" +
      "Once you have these, search for availability and present 2-3 options.\n" +
      "After the caller picks a time and confirms, create the booking.\n" +
      "After the booking is confirmed, ask if there is anything else you can help with today.\n" +
      "If the caller says no or indicates they are done, close the call warmly — say something like 'Have a great day, goodbye!' and end the call.\n" +
      "If the caller asks about something unrelated to booking, hand off back to the Receptionist.",
  ),
  model: env.LLM_MODEL,
  tools: [
    calendlySearchAvailability,
    calendlyCreateBooking,
    otSearchAvailability,
    otCreateReservation,
  ] as any,
  modelSettings: agentModelSettings(),
});

const cancelAgent: Agent<CallContext> = new Agent({
  name: "Cancellation Specialist",
  handoffDescription: "Handles appointment and reservation cancellations",
  instructions: withContext(
    "You help callers cancel existing appointments.\n" +
      "Never announce yourself or mention being a specialist. Just respond naturally.\n" +
      "Ask for the caller's name or email to locate their booking.\n" +
      "Confirm they want to cancel before proceeding.\n" +
      "After cancellation, ask if there is anything else you can help with today.\n" +
      "If the caller says no or indicates they are done, close the call warmly — say something like 'Have a great day, goodbye!' and end the call.\n" +
      "If the caller needs something unrelated, hand off back to the Receptionist.",
  ),
  model: env.LLM_MODEL,
  tools: [calendlyCancelBooking] as any,
  modelSettings: agentModelSettings(),
});

const complaintAgent: Agent<CallContext> = new Agent({
  name: "Customer Care Specialist",
  handoffDescription: "Handles complaints, frustration, dissatisfaction, and requests to speak with a manager",
  instructions: withContext(
    "You handle complaints and frustrated callers with deep empathy and professionalism.\n" +
      "Never announce yourself or mention being a specialist. Just respond naturally.\n" +
      "Your first priority is to make the caller feel heard — do NOT rush to collect their details.\n" +
      "Begin by acknowledging what they experienced specifically. Reflect it back: 'That sounds really frustrating, I'm so sorry that happened.'\n" +
      "Give them space to fully express their concern before moving forward.\n" +
      "Once they feel heard, explain clearly what will happen: a manager will personally call them back within 24 hours.\n" +
      "Only then ask for their name and a good callback phone number.\n" +
      "Once you have their details, log the complaint.\n" +
      "After logging, thank them for bringing it to your attention and ask if there is anything else you can help with today.\n" +
      "If the caller is done, close the call warmly — say something like 'Thank you for your patience, have a good day, goodbye!' and end the call.\n" +
      "If they need something else, hand off back to the Receptionist.",
  ),
  model: env.LLM_MODEL,
  tools: [logComplaint] as any,
  modelSettings: agentModelSettings(),
});

const infoAgent: Agent<CallContext> = new Agent({
  name: "Information Specialist",
  handoffDescription: "Answers general questions about the business using the knowledge base",
  instructions: withContext(
    "You answer general questions about the business.\n" +
      "Never announce yourself or mention being a specialist. Just respond naturally.\n" +
      "Use the knowledge provided above to answer accurately.\n" +
      "If you do not know the answer, say so honestly and offer to help with something else.\n" +
      "After answering, ask if there is anything else you can help with.\n" +
      "If the caller says no or indicates they are done, close the call warmly — say something like 'Have a great day, goodbye!' and end the call.\n" +
      "If the caller wants to book, cancel, or has a complaint, hand off to the right specialist.",
  ),
  model: env.LLM_MODEL,
  tools: [],
  modelSettings: agentModelSettings(),
});

const triageAgent: Agent<CallContext> = new Agent({
  name: "Receptionist",
  instructions: withContext(
    "You are a receptionist. Your primary job is to route the caller to the right specialist immediately.\n" +
      "Route based on what the caller says:\n" +
      "- Booking Specialist: for new appointments or reservations\n" +
      "- Cancellation Specialist: for cancelling existing bookings\n" +
      "- Customer Care Specialist: for complaints, frustration, dissatisfaction, or requests to speak with a manager\n" +
      "- Information Specialist: for general questions about the business\n" +
      "Always say exactly one short natural sentence before handing off, e.g. 'Let me help you with that.' Then immediately hand off.\n" +
      "If the caller's need is unclear (e.g. they just say 'hello', 'hi', 'who is this', or are silent), ask exactly ONE short question: 'How can I help you today?'\n" +
      "Never answer questions yourself. Route immediately once you understand what they need.",
  ),
  model: env.LLM_MODEL,
  handoffs: [bookingAgent, cancelAgent, complaintAgent, infoAgent] as any,
  modelSettings: agentModelSettings(),
});

// Bidirectional handoffs: specialists can route back to triage
bookingAgent.handoffs = [triageAgent] as any;
cancelAgent.handoffs = [triageAgent] as any;
complaintAgent.handoffs = [triageAgent] as any;
infoAgent.handoffs = [triageAgent, bookingAgent, cancelAgent, complaintAgent] as any;

export { triageAgent, bookingAgent, cancelAgent, complaintAgent, infoAgent };
