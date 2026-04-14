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
import * as calendly from "../../calendlyClient";
import { env } from "../../env";
import { resolveModelSettingsForModel } from "./modelGuardrails";

const logger = createLogger({ service: "realtime-core", module: "agents" });

const APPROVAL_TTL_MS = 120_000;

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
  openingHours?: string;

  // Persistent conversational state
  slotMemory: Record<string, unknown>;
  pendingAction: PendingAction | null;
  approvedActionHash: string | null;
  approvalGateState: ApprovalGateState;
}

const VOICE_DIRECTIVE =
  "You are on a live phone call. Keep every reply to 1-2 short sentences. " +
  "Be warm and natural. Reply with ONLY what you would say out loud to the caller.";

const STATE_CHANGING_TOOLS = new Set<string>([
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
    maxTokens: 160,
    reasoning: { effort: "low" },
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

    parts.push(`Business prompt: ${c.agentBasePrompt || "not provided"}`);
    parts.push(`Current date/time: ${c.currentDateTime || new Date().toISOString()}`);

    if (c.calendlyTimezone) {
      parts.push(`Business timezone: ${c.calendlyTimezone}`);
    }
    if (c.openingHours) {
      parts.push(`Business hours: ${c.openingHours}`);
    }
    if (c.kbPassages.length > 0) {
      parts.push("Relevant business knowledge:");
      c.kbPassages.slice(0, 6).forEach((p, i) => parts.push(`  [${i + 1}] ${p}`));
    }

    if (c.pendingAction) {
      parts.push(
        `Pending action awaiting explicit yes/no: ${c.pendingAction.toolName}(${JSON.stringify(c.pendingAction.args).slice(0, 260)})`,
      );
    }

    parts.push(
      "Approval policy: state-changing actions require explicit caller confirmation before execution.",
      "If caller clearly says yes while a pending action exists, execute that same action.",
      "If caller says no, acknowledge and do not execute that action.",
    );

    return parts.join("\n");
  };
}

// ---- Calendly tool schemas ----
const calendlySearchSchema = z.object({
  start_date: z.string().describe("ISO 8601 date to start searching, e.g. '2026-03-07'"),
});

const calendlyCreateSchema = z.object({
  start_time: z.string().describe("UTC ISO 8601 start time from availability search"),
  invitee_name: z.string().describe("Full name of the caller"),
  invitee_email: z.string().describe("Email address of the caller"),
});

const calendlyCancelSchema = z.object({
  event_uri: z.string().describe("Calendly event URI to cancel"),
  reason: z.string().nullable().optional().describe("Reason for cancellation"),
});

// ---- OpenTable tool schemas ----
const otSearchSchema = z.object({
  date: z.string().describe("ISO 8601 date, e.g. '2026-02-18'"),
  party_size: z.number().int().min(1).max(20).describe("Number of guests"),
  time_preference: z
    .string()
    .nullable()
    .optional()
    .describe("Preferred time in 24h format, e.g. '19:00'"),
});

const otCreateSchema = z.object({
  date: z.string().describe("ISO 8601 date"),
  time: z.string().describe("Time in 24h format, e.g. '19:00'"),
  party_size: z.number().int().min(1).max(20).describe("Number of guests"),
  customer_name: z.string().describe("Full name for the reservation"),
  customer_phone: z.string().describe("Phone number for confirmation"),
  customer_email: z.string().nullable().optional().describe("Optional email for confirmation"),
});

const otModifySchema = z.object({
  reservation_id: z.string().describe("Reservation identifier"),
  new_date: z.string().nullable().optional(),
  new_time: z.string().nullable().optional(),
  new_party_size: z.number().int().min(1).max(20).nullable().optional(),
  new_special_requests: z.string().nullable().optional(),
});

const otCancelSchema = z.object({
  reservation_id: z.string().describe("Reservation identifier"),
});

const otDetailsSchema = z.object({
  reservation_id: z.string().nullable().optional(),
  customer_name: z.string().nullable().optional(),
  customer_phone: z.string().nullable().optional(),
});

const logComplaintSchema = z.object({
  issue_summary: z.string().describe("Brief description of the complaint"),
  customer_name: z.string().describe("Caller's name"),
  customer_phone: z.string().nullable().optional().describe("Callback phone number"),
});

const calendlySearchAvailability = tool<typeof calendlySearchSchema, CallContext>({
  name: "calendly_search_availability",
  description:
    "Search for available appointment time slots on Calendly. Returns open slots for the next 7 days from the given start date.",
  parameters: calendlySearchSchema,
  async execute(args, ctx) {
    const cc = ctx?.context;
    if (!cc) return "Missing call context.";
    if (!cc.calendlyAccessToken) return "Calendly is not configured for this business.";
    rememberSlotMemory(cc, args);

    logger.info("tool: calendly_search_availability", { callId: cc.callId, args });

    try {
      const eventTypeUri =
        cc.calendlyEventTypeUri || (await calendly.resolveEventTypeUri(cc.calendlyAccessToken));
      const startTime = `${args.start_date}T00:00:00Z`;
      const endDate = new Date(new Date(args.start_date).getTime() + 7 * 86_400_000)
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

      return JSON.stringify({
        status: "ok",
        available_slots: formatted,
        total_found: slots.length,
      });
    } catch (err) {
      logger.error("calendly_search_availability failed", {
        callId: cc.callId,
        error: (err as Error).message,
      });
      return "Unable to check availability right now. Please try again in a moment.";
    }
  },
});

const calendlyCreateBooking = tool<typeof calendlyCreateSchema, CallContext>({
  name: "calendly_create_booking",
  description:
    "Book an appointment on Calendly. Requires name, email, and a start_time from availability search.",
  parameters: calendlyCreateSchema,
  async execute(args, ctx) {
    const cc = ctx?.context;
    if (!cc) return "Missing call context.";
    if (!cc.calendlyAccessToken) return "Calendly is not configured for this business.";
    rememberSlotMemory(cc, args);

    const gate = enforceApprovalGate(cc, "calendly_create_booking", args);
    if (!gate.allowed) {
      return gate.outputIfBlocked ?? "Confirmation required.";
    }

    logger.info("tool: calendly_create_booking", {
      callId: cc.callId,
      name: args.invitee_name,
      actionHash: gate.actionHash,
    });

    try {
      const eventTypeUri =
        cc.calendlyEventTypeUri || (await calendly.resolveEventTypeUri(cc.calendlyAccessToken));
      const invitee = await calendly.createInvitee(cc.calendlyAccessToken, {
        eventTypeUri,
        startTime: args.start_time,
        inviteeName: args.invitee_name,
        inviteeEmail: args.invitee_email,
        inviteeTimezone: cc.calendlyTimezone || "America/New_York",
      });

      clearPendingApproval(cc);

      return JSON.stringify({
        status: "ok",
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

const calendlyCancelBooking = tool<typeof calendlyCancelSchema, CallContext>({
  name: "calendly_cancel_booking",
  description:
    "Cancel an existing Calendly appointment. Requires event URI and explicit confirmation.",
  parameters: calendlyCancelSchema,
  async execute(args, ctx) {
    const cc = ctx?.context;
    if (!cc) return "Missing call context.";
    if (!cc.calendlyAccessToken) return "Calendly is not configured for this business.";

    const gate = enforceApprovalGate(cc, "calendly_cancel_booking", args);
    if (!gate.allowed) {
      return gate.outputIfBlocked ?? "Confirmation required.";
    }

    logger.info("tool: calendly_cancel_booking", {
      callId: cc.callId,
      actionHash: gate.actionHash,
    });

    try {
      await calendly.cancelEvent(
        cc.calendlyAccessToken,
        args.event_uri,
        args.reason ?? undefined,
      );

      clearPendingApproval(cc);
      return JSON.stringify({ status: "ok", success: true, message: "The appointment has been cancelled." });
    } catch (err) {
      logger.error("calendly_cancel_booking failed", {
        callId: cc.callId,
        error: (err as Error).message,
      });
      return "Unable to cancel that appointment right now.";
    }
  },
});

const otSearchAvailability = tool<typeof otSearchSchema, CallContext>({
  name: "search_availability",
  description: "Search for available restaurant reservation time slots on OpenTable.",
  parameters: otSearchSchema,
  async execute(args, ctx) {
    const cc = ctx?.context;
    if (!cc) return "Missing call context.";
    if (!cc.restaurantId) return "OpenTable is not configured for this business.";
    rememberSlotMemory(cc, args);

    logger.info("tool: search_availability", { callId: cc.callId, args });

    try {
      const result = await callTool({
        orgId: cc.orgId,
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

const otCreateReservation = tool<typeof otCreateSchema, CallContext>({
  name: "create_reservation",
  description: "Create a new OpenTable reservation after explicit confirmation.",
  parameters: otCreateSchema,
  async execute(args, ctx) {
    const cc = ctx?.context;
    if (!cc) return "Missing call context.";
    if (!cc.restaurantId) return "OpenTable is not configured for this business.";
    rememberSlotMemory(cc, args);

    const gate = enforceApprovalGate(cc, "create_reservation", args);
    if (!gate.allowed) {
      return gate.outputIfBlocked ?? "Confirmation required.";
    }

    logger.info("tool: create_reservation", {
      callId: cc.callId,
      actionHash: gate.actionHash,
    });

    try {
      const result = await callTool({
        orgId: cc.orgId,
        toolName: "create_reservation",
        args: { restaurant_id: cc.restaurantId, ...args },
      });
      clearPendingApproval(cc);
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

const otModifyReservation = tool<typeof otModifySchema, CallContext>({
  name: "modify_reservation",
  description: "Modify an existing OpenTable reservation after explicit confirmation.",
  parameters: otModifySchema,
  async execute(args, ctx) {
    const cc = ctx?.context;
    if (!cc) return "Missing call context.";
    if (!cc.restaurantId) return "OpenTable is not configured for this business.";
    rememberSlotMemory(cc, args);

    const gate = enforceApprovalGate(cc, "modify_reservation", args);
    if (!gate.allowed) {
      return gate.outputIfBlocked ?? "Confirmation required.";
    }

    logger.info("tool: modify_reservation", {
      callId: cc.callId,
      actionHash: gate.actionHash,
    });

    try {
      const result = await callTool({
        orgId: cc.orgId,
        toolName: "modify_reservation",
        args: { restaurant_id: cc.restaurantId, ...args },
      });
      clearPendingApproval(cc);
      return JSON.stringify(result);
    } catch (err) {
      logger.error("modify_reservation failed", {
        callId: cc.callId,
        error: (err as Error).message,
      });
      return "Unable to modify the reservation right now.";
    }
  },
});

const otCancelReservation = tool<typeof otCancelSchema, CallContext>({
  name: "cancel_reservation",
  description: "Cancel an OpenTable reservation after explicit confirmation.",
  parameters: otCancelSchema,
  async execute(args, ctx) {
    const cc = ctx?.context;
    if (!cc) return "Missing call context.";
    if (!cc.restaurantId) return "OpenTable is not configured for this business.";
    rememberSlotMemory(cc, args);

    const gate = enforceApprovalGate(cc, "cancel_reservation", args);
    if (!gate.allowed) {
      return gate.outputIfBlocked ?? "Confirmation required.";
    }

    logger.info("tool: cancel_reservation", {
      callId: cc.callId,
      actionHash: gate.actionHash,
    });

    try {
      const result = await callTool({
        orgId: cc.orgId,
        toolName: "cancel_reservation",
        args: { restaurant_id: cc.restaurantId, ...args },
      });
      clearPendingApproval(cc);
      return JSON.stringify(result);
    } catch (err) {
      logger.error("cancel_reservation failed", {
        callId: cc.callId,
        error: (err as Error).message,
      });
      return "Unable to cancel that reservation right now.";
    }
  },
});

const otGetReservationDetails = tool<typeof otDetailsSchema, CallContext>({
  name: "get_reservation_details",
  description: "Look up reservation details by reservation ID or customer details.",
  parameters: otDetailsSchema,
  async execute(args, ctx) {
    const cc = ctx?.context;
    if (!cc) return "Missing call context.";
    if (!cc.restaurantId) return "OpenTable is not configured for this business.";
    rememberSlotMemory(cc, args);

    logger.info("tool: get_reservation_details", { callId: cc.callId, args });

    try {
      const result = await callTool({
        orgId: cc.orgId,
        toolName: "get_reservation_details",
        args: { restaurant_id: cc.restaurantId, ...args },
      });
      return JSON.stringify(result);
    } catch (err) {
      logger.error("get_reservation_details failed", {
        callId: cc.callId,
        error: (err as Error).message,
      });
      return "Unable to look up reservation details right now.";
    }
  },
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

const bookingAgent: Agent<CallContext> = new Agent({
  name: "Booking Specialist",
  handoffDescription: "Handles new appointment and reservation bookings",
  instructions: withContext(
    "You help callers schedule appointments and reservations.\n" +
      "Never announce yourself as a specialist; just respond naturally.\n" +
      "Collect only missing details, then use tools to search options and complete booking.\n" +
      "Before any state-changing operation, explicitly confirm details with the caller.\n" +
      "If caller asks something unrelated to booking, hand off back to Receptionist.",
  ),
  model: env.LLM_MODEL,
  tools: [
    calendlySearchAvailability,
    calendlyCreateBooking,
    otSearchAvailability,
    otCreateReservation,
    otModifyReservation,
  ],
  modelSettings: agentModelSettings(),
});

const cancelAgent: Agent<CallContext> = new Agent({
  name: "Cancellation Specialist",
  handoffDescription: "Handles appointment and reservation cancellations",
  instructions: withContext(
    "You help callers cancel or adjust existing bookings.\n" +
      "Never announce yourself as a specialist; just respond naturally.\n" +
      "Use lookup tools first if reservation details are incomplete.\n" +
      "Confirm before cancellation or modification.\n" +
      "If caller needs unrelated help, hand off back to Receptionist.",
  ),
  model: env.LLM_MODEL,
  tools: [
    calendlyCancelBooking,
    otGetReservationDetails,
    otModifyReservation,
    otCancelReservation,
  ],
  modelSettings: agentModelSettings(),
});

const complaintAgent: Agent<CallContext> = new Agent({
  name: "Customer Care Specialist",
  handoffDescription:
    "Handles complaints, frustration, dissatisfaction, and requests to speak with a manager",
  instructions: withContext(
    "You handle complaints with empathy and professionalism.\n" +
      "Acknowledge the issue first, then collect callback details.\n" +
      "Log the complaint once details are complete and confirmed.\n" +
      "If caller asks for something else, hand off back to Receptionist.",
  ),
  model: env.LLM_MODEL,
  tools: [logComplaint],
  modelSettings: agentModelSettings(),
});

const infoAgent: Agent<CallContext> = new Agent({
  name: "Information Specialist",
  handoffDescription: "Answers general questions about the business using the knowledge base",
  instructions: withContext(
    "You answer general questions about the business.\n" +
      "Use provided knowledge first. If unknown, say so honestly.\n" +
      "If user wants booking/cancellation/complaint help, hand off to the right specialist.",
  ),
  model: env.LLM_MODEL,
  tools: [otSearchAvailability, otGetReservationDetails],
  modelSettings: agentModelSettings(),
});

const triageAgent: Agent<CallContext> = new Agent({
  name: "Receptionist",
  instructions: withContext(
    "You are the receptionist for this business.\n" +
      "Route callers quickly to the right specialist:\n" +
      "- Booking Specialist: new bookings\n" +
      "- Cancellation Specialist: cancellation/reschedule\n" +
      "- Customer Care Specialist: complaints/manager requests\n" +
      "- Information Specialist: general questions\n" +
      "If intent is unclear, ask one short clarification question.",
  ),
  model: env.LLM_MODEL,
  handoffs: [bookingAgent, cancelAgent, complaintAgent, infoAgent],
  modelSettings: agentModelSettings(),
});

bookingAgent.handoffs = [triageAgent, cancelAgent, infoAgent];
cancelAgent.handoffs = [triageAgent, bookingAgent, infoAgent];
complaintAgent.handoffs = [triageAgent, infoAgent];
infoAgent.handoffs = [triageAgent, bookingAgent, cancelAgent, complaintAgent];

const AGENT_BY_NAME: Record<string, Agent<CallContext>> = {
  [triageAgent.name]: triageAgent,
  [bookingAgent.name]: bookingAgent,
  [cancelAgent.name]: cancelAgent,
  [complaintAgent.name]: complaintAgent,
  [infoAgent.name]: infoAgent,
};

export function getStartingAgent(): Agent<CallContext> {
  return triageAgent;
}

export function getAgentByName(name: string | undefined | null): Agent<CallContext> | null {
  if (!name) return null;
  return AGENT_BY_NAME[name] ?? null;
}

export function inferIntentFromAgentName(agentName: string): string {
  switch (agentName) {
    case "Booking Specialist":
      return "create_booking";
    case "Cancellation Specialist":
      return "cancel_booking";
    case "Customer Care Specialist":
      return "complaint";
    case "Information Specialist":
      return "info_request";
    default:
      return "other";
  }
}

export function inferSpecialistFromAgentName(
  agentName: string,
): "booking" | "support" | "sales" | "general" {
  switch (agentName) {
    case "Booking Specialist":
    case "Cancellation Specialist":
      return "booking";
    case "Customer Care Specialist":
      return "support";
    case "Information Specialist":
      return "general";
    default:
      return "general";
  }
}

export { triageAgent, bookingAgent, cancelAgent, complaintAgent, infoAgent };
