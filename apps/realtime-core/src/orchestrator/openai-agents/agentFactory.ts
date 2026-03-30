/**
 * agentFactory.ts
 *
 * Builds specialist agents per intent and a triage agent that uses
 * SDK-native handoffs to route ambiguous first-turn requests.
 *
 * Each specialist gets focused instructions, domain-specific tools,
 * and relevant KB context. The triage agent is only used when regex
 * intent detection has low confidence.
 */

import { Agent } from "@openai/agents";
import type { AgentConfigSnapshot, PhoneNumberConfig } from "@rezovo/core-types";
import { buildToolsForIntent, type ToolContext } from "./tools";
import type { ConversationState } from "../stateMachine";

export interface AgentBuildContext {
  agentConfig: AgentConfigSnapshot;
  phoneConfig: PhoneNumberConfig;
  callId: string;
  conversationState: ConversationState;
  currentDateTime: string;
  kbPassages?: string[];
  detectedIntent: string;
}

export class AgentFactory {

  getAgentForIntent(intent: string, ctx: AgentBuildContext): Agent<any, any> {
    switch (intent) {
      case "create_booking": return this.createBookingAgent(ctx);
      case "modify_booking": return this.createModifyAgent(ctx);
      case "cancel_booking": return this.createCancelAgent(ctx);
      case "complaint":      return this.createComplaintAgent(ctx);
      case "info_request":   return this.createInfoAgent(ctx);
      default:               return this.createInfoAgent(ctx);
    }
  }

  createTriageAgent(ctx: AgentBuildContext): Agent<any, any> {
    const bookingAgent  = this.createBookingAgent(ctx);
    const modifyAgent   = this.createModifyAgent(ctx);
    const cancelAgent   = this.createCancelAgent(ctx);
    const complaintAgent = this.createComplaintAgent(ctx);
    const infoAgent     = this.createInfoAgent(ctx);

    return new Agent({
      name: "Receptionist",
      instructions: this.buildTriagePrompt(ctx),
      model: "gpt-5-nano",
      handoffs: [bookingAgent, modifyAgent, cancelAgent, complaintAgent, infoAgent],
      modelSettings: {
        maxTokens: 50,
      },
    });
  }

  createBookingAgent(ctx: AgentBuildContext): Agent<any, any> {
    return new Agent({
      name: "Booking Specialist",
      handoffDescription: "Handles new appointments and bookings",
      instructions: this.buildBookingPrompt(ctx),
      model: "gpt-5-nano",
      tools: this.buildTools("create_booking", ctx),
      modelSettings: { maxTokens: 150 },
    });
  }

  createModifyAgent(ctx: AgentBuildContext): Agent<any, any> {
    return new Agent({
      name: "Booking Modifier",
      handoffDescription: "Handles changes to existing appointments",
      instructions: this.buildModifyPrompt(ctx),
      model: "gpt-5-nano",
      tools: this.buildTools("modify_booking", ctx),
      modelSettings: { maxTokens: 150 },
    });
  }

  createCancelAgent(ctx: AgentBuildContext): Agent<any, any> {
    return new Agent({
      name: "Cancellation Specialist",
      handoffDescription: "Handles appointment cancellations",
      instructions: this.buildCancelPrompt(ctx),
      model: "gpt-5-nano",
      tools: this.buildTools("cancel_booking", ctx),
      modelSettings: { maxTokens: 150 },
    });
  }

  createComplaintAgent(ctx: AgentBuildContext): Agent<any, any> {
    return new Agent({
      name: "Customer Care Specialist",
      handoffDescription: "Handles complaints and customer issues",
      instructions: this.buildComplaintPrompt(ctx),
      model: "gpt-5-nano",
      tools: this.buildTools("complaint", ctx),
      modelSettings: { maxTokens: 150 },
    });
  }

  createInfoAgent(ctx: AgentBuildContext): Agent<any, any> {
    return new Agent({
      name: "Information Specialist",
      handoffDescription: "Answers general questions about the business",
      instructions: this.buildInfoPrompt(ctx),
      model: "gpt-5-nano",
      tools: [],
      modelSettings: { maxTokens: 150 },
    });
  }

  // ─── Tool Context Builder ───

  private buildToolContext(ctx: AgentBuildContext): ToolContext {
    const config = ctx.agentConfig;
    return {
      tenantId: config.tenantId,
      businessId: config.businessId,
      callId: ctx.callId,
      restaurantId: config.opentable?.restaurantId,
      calendlyAccessToken: config.calendly?.accessToken,
      calendlyEventTypeUri: config.calendly?.eventTypeUri,
      calendlyTimezone: config.calendly?.timezone,
    };
  }

  private buildTools(intent: string, ctx: AgentBuildContext) {
    return buildToolsForIntent(
      intent,
      this.buildToolContext(ctx),
      ctx.agentConfig.toolAccess || []
    );
  }

  // ─── Shared Prompt Segments ───

  private commonContext(ctx: AgentBuildContext): string {
    const { agentConfig, conversationState: state, currentDateTime, kbPassages } = ctx;
    const p: string[] = [];

    p.push(`Current date/time: ${currentDateTime}`);

    if (agentConfig.calendly?.timezone) {
      p.push(`Business timezone: ${agentConfig.calendly.timezone}`);
    }

    if (agentConfig.openingHours && Object.keys(agentConfig.openingHours).length > 0) {
      const hours = Object.entries(agentConfig.openingHours)
        .filter(([, slots]) => Array.isArray(slots) && slots.length > 0)
        .map(([day, slots]) => `${day}: ${(slots as any[]).map((s: any) => `${s.open}-${s.close}`).join(", ")}`)
        .join("; ");
      if (hours) p.push(`Business hours: ${hours}`);
    }

    if (kbPassages && kbPassages.length > 0) {
      p.push("Relevant knowledge:\n" + kbPassages.map((t, i) => `  [${i + 1}] ${t}`).join("\n"));
    }

    if (Object.keys(state.slots).length > 0) {
      const collected = Object.entries(state.slots)
        .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
        .join(", ");
      p.push(`Already collected from caller: ${collected}. Do NOT re-ask these.`);
    }

    if (state.missingSlots.length > 0) {
      p.push(`Still need: ${state.missingSlots.map(s => s.replace(/_/g, " ")).join(", ")}. Ask for ONE at a time.`);
    }

    if (state.lastToolResult) {
      p.push(`Previous tool result: ${JSON.stringify(state.lastToolResult)}`);
    }

    return p.join("\n");
  }

  private voiceDirective(): string {
    return "You are on a live phone call. Keep every reply to 1-2 short sentences. Be warm and natural.\nReply with ONLY what you would say out loud to the caller. Nothing else.";
  }

  // ─── Per-Agent Prompts ───

  private buildTriagePrompt(ctx: AgentBuildContext): string {
    const { agentConfig } = ctx;
    const bizName = agentConfig.businessId || "our business";
    return [
      `You are a receptionist for ${bizName}.`,
      "Your ONLY job is to determine what the caller needs and hand off to the correct specialist.",
      "Do NOT answer questions or make conversation. Listen and route immediately.",
      `Current date/time: ${ctx.currentDateTime}`,
    ].join("\n");
  }

  private buildBookingPrompt(ctx: AgentBuildContext): string {
    const { agentConfig } = ctx;
    const provider = agentConfig.bookingProvider || "calendly";
    const bizName = agentConfig.businessId || "our business";
    const p: string[] = [];

    p.push(`You are a booking specialist for ${bizName}. Help callers schedule new appointments.`);
    p.push(this.voiceDirective());
    p.push(this.commonContext(ctx));

    if (provider === "calendly") {
      p.push(
        "To book, collect: preferred date/time, caller's full name, and email address.",
        "Once you have these, search for availability and present 2-3 options.",
        "After the caller picks a time and confirms, create the booking."
      );
    } else {
      p.push(
        "To book, collect: date, time, party size, and the caller's name.",
        "Search for availability, present options, and confirm before booking."
      );
    }

    if (agentConfig.escalationRules?.escalateOnExplicitRequest) {
      p.push("If the caller asks for a human or manager, say you will connect them.");
    }

    return p.join("\n");
  }

  private buildModifyPrompt(ctx: AgentBuildContext): string {
    const bizName = ctx.agentConfig.businessId || "our business";
    return [
      `You are a booking modification specialist for ${bizName}. Help callers reschedule existing appointments.`,
      this.voiceDirective(),
      this.commonContext(ctx),
      "First, ask for the caller's name or email to look up their existing booking.",
      "Then ask what needs to change. Search for new availability and confirm before rebooking.",
    ].join("\n");
  }

  private buildCancelPrompt(ctx: AgentBuildContext): string {
    const bizName = ctx.agentConfig.businessId || "our business";
    return [
      `You are a cancellation specialist for ${bizName}. Help callers cancel their appointments.`,
      this.voiceDirective(),
      this.commonContext(ctx),
      "Ask for their name or email to locate the booking.",
      "Confirm that they want to cancel before proceeding.",
      "After cancellation, ask if there is anything else you can help with.",
    ].join("\n");
  }

  private buildComplaintPrompt(ctx: AgentBuildContext): string {
    const bizName = ctx.agentConfig.businessId || "our business";
    return [
      `You are a customer care specialist for ${bizName}. Handle complaints with empathy and professionalism.`,
      this.voiceDirective(),
      this.commonContext(ctx),
      "Listen to the caller's concern carefully. Acknowledge their frustration sincerely.",
      "Collect their name and phone number so a manager can personally call them back.",
      "Once you have their details, log the complaint and assure them someone will follow up within 24 hours.",
    ].join("\n");
  }

  private buildInfoPrompt(ctx: AgentBuildContext): string {
    const { agentConfig } = ctx;
    const bizName = agentConfig.businessId || "our business";
    return [
      `You are an information specialist for ${bizName}. Answer general questions about the business.`,
      this.voiceDirective(),
      this.commonContext(ctx),
      "Use the knowledge provided above to answer accurately.",
      "If you do not know the answer, say so honestly and offer to connect them with someone who can help.",
      "If the caller wants to book, modify, or cancel an appointment, let them know you can help with that too.",
    ].join("\n");
  }
}
