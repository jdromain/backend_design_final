import { randomUUID } from "crypto";
import { Agent, type AgentInputItem, type StreamedRunResult } from "@openai/agents";
import { createLogger } from "@rezovo/logging";
import type { AgentConfigSnapshot, PhoneNumberConfig } from "@rezovo/core-types";
import * as calendly from "../../calendlyClient";
import { callTool } from "../../toolClient";
import { env } from "../../env";
import { traceLog } from "../../traceLog";
import { getRequiredSlots } from "./schemas";
import { guardrailsEngine } from "./guardrails";
import {
  AssistantTurnOutputSchema,
  DecisionModeSchema,
  SpecialistRouteSchema,
  TurnDecisionSchema,
  TurnInterpretationSchema,
  type DecisionMode,
  type SpecialistRoute,
  type ToolExecutionRequest,
  type TurnDiagnostics,
  type TurnIntent,
  type TurnInterpretation,
} from "./contracts";
import { resolveModelSettingsForModel, runWithModelGuardrails } from "./modelGuardrails";

const logger = createLogger({ service: "realtime-core", module: "turn-orchestrator-v2" });

export type OnSentenceCallback = (sentence: string) => void | Promise<void>;

type InterpretationContext = {
  basePrompt: string;
  currentDateTime: string;
  conversationSummary: string;
  activeIntent: TurnIntent | null;
  pendingActionSummary: string | null;
  slotSnapshot: Record<string, unknown>;
  availableTools: Array<{ name: string; stateChanging: boolean }>;
  requiredSlots: string[];
  missingSlots: string[];
  kbPassages: string[];
  openingHours?: string;
  timezone?: string;
};

type ResponseContext = {
  basePrompt: string;
  specialistPolicy: string;
  decisionMode: DecisionMode;
  intent: TurnIntent;
  confidence: number;
  conversationSummary: string;
  pendingActionSummary: string | null;
  missingSlots: string[];
  toolResultSummary?: string;
  kbPassages: string[];
  currentDateTime: string;
};

type PendingActionState = {
  request: ToolExecutionRequest;
  summary: string;
  expiresAtTurn: number;
};

type ConversationState = {
  turnNumber: number;
  activeIntent: TurnIntent | null;
  intentConfidence: number;
  slotsByIntent: Record<string, Record<string, unknown>>;
  pendingAction: PendingActionState | null;
  summary: string;
};

type ToolExecutionResult = {
  ok: boolean;
  toolName: string;
  result?: unknown;
  error?: string;
};

const VOICE_NAME = "Voice Concierge";

const REPLY_FALLBACKS = [
  "I'm sorry, I missed that. Could you say it once more?",
  "I didn't catch that clearly. Can you repeat it for me?",
  "Let's try that again. What would you like to do?",
] as const;

const SPECIALIST_POLICIES: Record<SpecialistRoute, string> = {
  booking:
    "Focus on scheduling efficiently. Ask only for missing booking details, summarize clearly, and confirm before committing any booking or cancellation.",
  support:
    "Lead with empathy and practical next steps. Acknowledge frustration briefly, then move toward resolution.",
  sales:
    "Be concise, helpful, and benefits-oriented. Keep momentum and offer the next concrete step.",
  general:
    "Answer clearly and naturally. Keep responses brief and caller-friendly.",
};

const STATE_CHANGING_TOOLS = new Set<string>([
  "calendly_create_booking",
  "calendly_cancel_booking",
  "create_reservation",
  "modify_reservation",
  "cancel_reservation",
  "log_complaint",
]);

function toISOStringDayOffset(startDate: string, offsetDays: number): string {
  const d = new Date(startDate);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().split("T")[0];
}

function hashIndex(seed: string, mod: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % mod;
}

function normalizeSlotKey(rawKey: string): string {
  const key = rawKey.toLowerCase();
  if (key === "date" || key === "day" || key === "desired_date") return "date_text";
  if (key === "time" || key === "desired_time") return "time_text";
  if (key === "name" || key === "invitee_name") return "customer_name";
  if (key === "phone") return "customer_phone";
  if (key === "email" || key === "invitee_email") return "customer_email";
  if (key === "party" || key === "party_count") return "party_size";
  return rawKey;
}

function normalizeSlots(input: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    normalized[normalizeSlotKey(key)] = value;
  }
  return normalized;
}

function summarizeToolResult(result: ToolExecutionResult): string {
  if (!result.ok) {
    return `Tool ${result.toolName} failed: ${result.error ?? "unknown error"}`;
  }
  const body =
    typeof result.result === "string"
      ? result.result.slice(0, 240)
      : JSON.stringify(result.result ?? {}).slice(0, 240);
  return `Tool ${result.toolName} succeeded: ${body}`;
}

function nextFallback(seed: string): string {
  return REPLY_FALLBACKS[hashIndex(seed, REPLY_FALLBACKS.length)];
}

function isAffirmative(confirmation: TurnInterpretation["userConfirmation"]): boolean {
  return confirmation === "yes";
}

export function shouldRequireExplicitConfirmation(toolName: string): boolean {
  return STATE_CHANGING_TOOLS.has(toolName);
}

function inferSpecialist(intent: TurnIntent): SpecialistRoute {
  if (intent === "create_booking" || intent === "modify_booking" || intent === "cancel_booking") {
    return "booking";
  }
  if (intent === "complaint" || intent === "human_transfer") {
    return "support";
  }
  if (intent === "sales_inquiry") {
    return "sales";
  }
  return "general";
}

function openingHoursText(hours: AgentConfigSnapshot["openingHours"]): string | undefined {
  if (!hours) return undefined;
  const entries = Object.entries(hours).filter(([, slots]) => Array.isArray(slots) && slots.length > 0);
  if (entries.length === 0) return undefined;
  return entries
    .map(([day, slots]) => `${day}: ${slots.map((s) => `${s.open}-${s.close}`).join(", ")}`)
    .join("; ");
}

class SentenceBuffer {
  private buffer = "";

  push(delta: string): string[] {
    this.buffer += delta;
    const emitted: string[] = [];
    let pos = 0;
    for (let i = 0; i < this.buffer.length - 1; i++) {
      const ch = this.buffer[i];
      const next = this.buffer[i + 1];
      if ((ch === "." || ch === "!" || ch === "?") && (next === " " || next === "\n")) {
        const sentence = this.buffer.slice(pos, i + 1).trim();
        if (sentence.length > 0) emitted.push(sentence);
        pos = i + 2;
      }
    }
    this.buffer = this.buffer.slice(pos);
    return emitted;
  }

  flush(): string | null {
    const remaining = this.buffer.trim();
    this.buffer = "";
    return remaining.length > 0 ? remaining : null;
  }
}

const interpretationAgent = new Agent<InterpretationContext, typeof TurnInterpretationSchema>({
  name: "Conversation Interpreter V2",
  model: env.LLM_MODEL,
  modelSettings: resolveModelSettingsForModel(env.LLM_MODEL, {
    maxTokens: 220,
    reasoning: { effort: "low" },
  }),
  outputType: TurnInterpretationSchema,
  instructions: ({ context }) =>
    [
      "You analyze one live phone turn and return only structured JSON.",
      "Never produce spoken dialogue here.",
      "Determine intent, confidence, specialist route, user confirmation signal, and optional tool request.",
      "Choose a tool ONLY if enough details are present.",
      "Use available tools and slot requirements from context.",
      `Business prompt: ${context.basePrompt}`,
      `Current datetime: ${context.currentDateTime}`,
      `Current active intent: ${context.activeIntent ?? "none"}`,
      `Pending action: ${context.pendingActionSummary ?? "none"}`,
      `Required slots: ${context.requiredSlots.join(", ") || "none"}`,
      `Missing slots: ${context.missingSlots.join(", ") || "none"}`,
      `Opening hours: ${context.openingHours ?? "not provided"}`,
      `Timezone: ${context.timezone ?? "not provided"}`,
      `Conversation summary: ${context.conversationSummary || "none"}`,
      `Slots collected: ${JSON.stringify(context.slotSnapshot)}`,
      `Available tools: ${JSON.stringify(context.availableTools)}`,
      `KB passages: ${context.kbPassages.slice(0, 4).join(" || ") || "none"}`,
    ].join("\n"),
});

const responseAgent = new Agent<ResponseContext>({
  name: VOICE_NAME,
  model: env.LLM_MODEL,
  modelSettings: resolveModelSettingsForModel(env.LLM_MODEL, {
    maxTokens: 170,
    reasoning: { effort: "low" },
    text: { verbosity: "low" },
  }),
  instructions: ({ context }) =>
    [
      "You are speaking live on a phone call.",
      "Reply in 1-2 short, natural sentences.",
      "Never mention internal routing, specialists, or system steps.",
      "Never mention policies or JSON.",
      "If decision mode is confirm_then_execute, ask for explicit yes/no confirmation before execution.",
      "If decision mode is slot_collection, ask only for the next missing detail.",
      "If decision mode is transfer, politely indicate a human follow-up.",
      "If decision mode is end, close warmly and briefly.",
      `Business prompt: ${context.basePrompt}`,
      `Specialist policy: ${context.specialistPolicy}`,
      `Intent: ${context.intent} (confidence ${context.confidence.toFixed(2)})`,
      `Decision mode: ${context.decisionMode}`,
      `Pending action: ${context.pendingActionSummary ?? "none"}`,
      `Missing slots: ${context.missingSlots.join(", ") || "none"}`,
      `Tool result summary: ${context.toolResultSummary ?? "none"}`,
      `Current datetime: ${context.currentDateTime}`,
      `Conversation summary: ${context.conversationSummary || "none"}`,
      `KB passages: ${context.kbPassages.slice(0, 4).join(" || ") || "none"}`,
    ].join("\n"),
});

export type TurnOrchestratorV2Result = {
  turnId: string;
  action: "speak" | "transfer" | "end";
  text: string;
  agentName: string;
  history: AgentInputItem[];
  intent?: string;
  confidence?: number;
  slots?: Record<string, unknown>;
  diagnostics?: TurnDiagnostics;
};

export class TurnOrchestratorV2 {
  private readonly state: ConversationState = {
    turnNumber: 0,
    activeIntent: null,
    intentConfidence: 0,
    slotsByIntent: {},
    pendingAction: null,
    summary: "",
  };

  constructor(
    private readonly callId: string,
    private readonly agentConfig: AgentConfigSnapshot,
    private readonly phoneConfig: PhoneNumberConfig,
  ) {}

  private getSlots(intent: TurnIntent): Record<string, unknown> {
    const key = intent;
    if (!this.state.slotsByIntent[key]) {
      this.state.slotsByIntent[key] = {};
    }
    return this.state.slotsByIntent[key];
  }

  private getBookingProvider(): "calendly" | "opentable" | "none" {
    if (this.agentConfig.bookingProvider) return this.agentConfig.bookingProvider;
    if (this.agentConfig.calendly?.accessToken) return "calendly";
    if (this.agentConfig.opentable?.restaurantId) return "opentable";
    return "none";
  }

  private requiredSlotsForIntent(intent: TurnIntent): string[] {
    if (intent === "other" || intent === "human_transfer" || intent === "end_call" || intent === "sales_inquiry") {
      return [];
    }
    return getRequiredSlots(intent, this.getBookingProvider());
  }

  private missingSlots(intent: TurnIntent, slots: Record<string, unknown>): string[] {
    const required = this.requiredSlotsForIntent(intent);
    return required.filter((slot) => {
      if (slot === "reservation_id_or_lookup") {
        return !(
          slots.reservation_id ||
          slots.confirmation_number ||
          (slots.customer_name && slots.customer_phone)
        );
      }
      if (slot === "modification_details") {
        return !Object.keys(slots).some((k) => k.startsWith("new_"));
      }
      return !slots[slot];
    });
  }

  private summarizePendingAction(pending: PendingActionState | null): string | null {
    if (!pending) return null;
    return `${pending.request.name} with args ${JSON.stringify(pending.request.args).slice(0, 180)}`;
  }

  private mergeSummary(userText: string, assistantText: string): void {
    const line = `U:${userText.trim().slice(0, 180)} | A:${assistantText.trim().slice(0, 180)}`;
    const merged = [this.state.summary, line].filter(Boolean).join("\n");
    this.state.summary = merged.length > 1500 ? merged.slice(merged.length - 1500) : merged;
  }

  private availableTools(): Array<{ name: string; stateChanging: boolean }> {
    const available = new Set<string>();
    const toolAccess = new Set(this.agentConfig.toolAccess ?? []);
    available.add("log_complaint");

    if (this.agentConfig.calendly?.accessToken) {
      available.add("calendly_search_availability");
      available.add("calendly_create_booking");
      available.add("calendly_cancel_booking");
    }
    if (this.agentConfig.opentable?.restaurantId) {
      available.add("search_availability");
      available.add("create_reservation");
      available.add("cancel_reservation");
      available.add("get_reservation_details");
    }
    for (const toolName of toolAccess) {
      available.add(toolName);
    }

    return Array.from(available).map((name) => ({
      name,
      stateChanging: shouldRequireExplicitConfirmation(name),
    }));
  }

  private buildInterpretationContext(
    utterance: string,
    kbPassages: string[],
    currentDateTime: string,
  ): InterpretationContext {
    const activeIntent = this.state.activeIntent ?? "other";
    const slotSnapshot = this.getSlots(activeIntent);
    const missing = this.missingSlots(activeIntent, slotSnapshot);
    return {
      basePrompt: this.agentConfig.basePrompt,
      currentDateTime,
      conversationSummary: this.state.summary,
      activeIntent: this.state.activeIntent,
      pendingActionSummary: this.summarizePendingAction(this.state.pendingAction),
      slotSnapshot,
      availableTools: this.availableTools(),
      requiredSlots: this.requiredSlotsForIntent(activeIntent),
      missingSlots: missing,
      kbPassages,
      openingHours: openingHoursText(this.agentConfig.openingHours),
      timezone: this.agentConfig.calendly?.timezone,
    };
  }

  private selectIntent(interpretation: TurnInterpretation): TurnIntent {
    if (interpretation.intent !== "other") {
      return interpretation.intent;
    }
    return this.state.activeIntent ?? "other";
  }

  private buildToolExecutionRequest(
    interpretation: TurnInterpretation,
    allowedTools: Array<{ name: string; stateChanging: boolean }>,
  ): ToolExecutionRequest | null {
    if (!interpretation.requestedTool) return null;
    const requested = interpretation.requestedTool.name;
    const allowed = allowedTools.find((t) => t.name === requested);
    if (!allowed) return null;
    return {
      name: requested,
      args: interpretation.requestedTool.args ?? {},
      isStateChanging: interpretation.requestedTool.stateChanging ?? allowed.stateChanging,
      requiresConfirmation: interpretation.requestedTool.stateChanging ?? allowed.stateChanging,
    };
  }

  private decideTurn(params: {
    interpretation: TurnInterpretation;
    intent: TurnIntent;
    confidence: number;
    missingSlots: string[];
    requestedTool: ToolExecutionRequest | null;
  }) {
    const { interpretation, intent, confidence, missingSlots, requestedTool } = params;

    if (this.state.pendingAction && this.state.pendingAction.expiresAtTurn < this.state.turnNumber) {
      this.state.pendingAction = null;
    }

    if (interpretation.escalateToHuman || intent === "human_transfer") {
      return TurnDecisionSchema.parse({
        action: "transfer",
        decisionMode: "transfer",
        reason: "caller requested human transfer",
        intent,
        confidence,
        pendingAction: null,
        toolExecution: null,
      });
    }

    if (this.state.pendingAction) {
      if (isAffirmative(interpretation.userConfirmation)) {
        const request = this.state.pendingAction.request;
        this.state.pendingAction = null;
        return TurnDecisionSchema.parse({
          action: "speak",
          decisionMode: "execute_confirmed",
          reason: "pending state-changing action confirmed",
          intent,
          confidence,
          pendingAction: null,
          toolExecution: request,
        });
      }
      if (interpretation.userConfirmation === "no") {
        this.state.pendingAction = null;
        return TurnDecisionSchema.parse({
          action: "speak",
          decisionMode: "direct_response",
          reason: "caller declined pending action",
          intent,
          confidence,
          pendingAction: null,
          toolExecution: null,
        });
      }
      return TurnDecisionSchema.parse({
        action: "speak",
        decisionMode: "confirm_then_execute",
        reason: "awaiting explicit confirmation for pending action",
        intent,
        confidence,
        pendingAction: this.state.pendingAction.request,
        toolExecution: null,
      });
    }

    if (interpretation.endCall || intent === "end_call") {
      return TurnDecisionSchema.parse({
        action: "end",
        decisionMode: "end",
        reason: "caller indicated conversation completion",
        intent,
        confidence,
        pendingAction: null,
        toolExecution: null,
      });
    }

    if (requestedTool) {
      if (missingSlots.length > 0) {
        return TurnDecisionSchema.parse({
          action: "speak",
          decisionMode: "slot_collection",
          reason: "tool requested but required slots are still missing",
          intent,
          confidence,
          pendingAction: null,
          toolExecution: null,
        });
      }
      if (requestedTool.requiresConfirmation) {
        this.state.pendingAction = {
          request: requestedTool,
          summary: `${requestedTool.name}(${JSON.stringify(requestedTool.args).slice(0, 120)})`,
          expiresAtTurn: this.state.turnNumber + 1,
        };
        return TurnDecisionSchema.parse({
          action: "speak",
          decisionMode: "confirm_then_execute",
          reason: "state-changing tool requested; explicit confirmation required",
          intent,
          confidence,
          pendingAction: requestedTool,
          toolExecution: null,
        });
      }
      return TurnDecisionSchema.parse({
        action: "speak",
        decisionMode: "execute_read_only",
        reason: "read-only tool requested",
        intent,
        confidence,
        pendingAction: null,
        toolExecution: requestedTool,
      });
    }

    if (missingSlots.length > 0 && (intent === "create_booking" || intent === "modify_booking" || intent === "cancel_booking")) {
      return TurnDecisionSchema.parse({
        action: "speak",
        decisionMode: "slot_collection",
        reason: "collecting missing required slots",
        intent,
        confidence,
        pendingAction: null,
        toolExecution: null,
      });
    }

    return TurnDecisionSchema.parse({
      action: "speak",
      decisionMode: "direct_response",
      reason: "normal conversational response",
      intent,
      confidence,
      pendingAction: null,
      toolExecution: null,
    });
  }

  private async executeTool(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    try {
      switch (request.name) {
        case "calendly_search_availability": {
          if (!this.agentConfig.calendly?.accessToken) {
            return { ok: false, toolName: request.name, error: "Calendly is not configured." };
          }
          const startDateRaw = String(request.args.start_date ?? new Date().toISOString().split("T")[0]);
          const startTime = `${startDateRaw}T00:00:00Z`;
          const endDate = toISOStringDayOffset(startDateRaw, 7);
          const endTime = `${endDate}T23:59:59Z`;
          const eventTypeUri =
            this.agentConfig.calendly.eventTypeUri ||
            (await calendly.resolveEventTypeUri(this.agentConfig.calendly.accessToken));
          const slots = await calendly.getAvailableTimes(
            this.agentConfig.calendly.accessToken,
            eventTypeUri,
            startTime,
            endTime,
          );
          const formatted = slots.slice(0, 10).map((s) => ({
            start_time: s.start_time,
            display: new Date(s.start_time).toLocaleString("en-US", {
              weekday: "long",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              timeZone: this.agentConfig.calendly?.timezone || "America/New_York",
            }),
          }));
          return { ok: true, toolName: request.name, result: { available_slots: formatted, total_found: slots.length } };
        }
        case "calendly_create_booking": {
          if (!this.agentConfig.calendly?.accessToken) {
            return { ok: false, toolName: request.name, error: "Calendly is not configured." };
          }
          const startTime = String(request.args.start_time ?? "");
          const inviteeName = String(request.args.invitee_name ?? request.args.customer_name ?? "");
          const inviteeEmail = String(request.args.invitee_email ?? request.args.customer_email ?? "");
          if (!startTime || !inviteeName || !inviteeEmail) {
            return { ok: false, toolName: request.name, error: "Missing booking fields: start_time, invitee_name, invitee_email." };
          }
          const eventTypeUri =
            this.agentConfig.calendly.eventTypeUri ||
            (await calendly.resolveEventTypeUri(this.agentConfig.calendly.accessToken));
          const invitee = await calendly.createInvitee(this.agentConfig.calendly.accessToken, {
            eventTypeUri,
            startTime,
            inviteeName,
            inviteeEmail,
            inviteeTimezone: this.agentConfig.calendly.timezone || "America/New_York",
          });
          return {
            ok: true,
            toolName: request.name,
            result: {
              success: true,
              message: `Appointment confirmed for ${inviteeName}.`,
              event_uri: invitee.event,
            },
          };
        }
        case "calendly_cancel_booking": {
          if (!this.agentConfig.calendly?.accessToken) {
            return { ok: false, toolName: request.name, error: "Calendly is not configured." };
          }
          const eventUri = String(request.args.event_uri ?? "");
          const reason = request.args.reason ? String(request.args.reason) : undefined;
          if (!eventUri) {
            return { ok: false, toolName: request.name, error: "Missing event_uri for cancellation." };
          }
          await calendly.cancelEvent(this.agentConfig.calendly.accessToken, eventUri, reason);
          return { ok: true, toolName: request.name, result: { success: true, message: "The appointment has been cancelled." } };
        }
        default: {
          const args: Record<string, unknown> = { ...(request.args ?? {}) };
          if (
            ["search_availability", "create_reservation", "cancel_reservation", "modify_reservation", "get_reservation_details"].includes(request.name) &&
            this.agentConfig.opentable?.restaurantId &&
            !args.restaurant_id
          ) {
            args.restaurant_id = this.agentConfig.opentable.restaurantId;
          }
          if (request.name === "log_complaint") {
            args.callId = this.callId;
          }
          const result = await callTool({
            orgId: this.agentConfig.orgId,
            toolName: request.name,
            args,
          });
          return { ok: true, toolName: request.name, result };
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn("tool execution failed", { callId: this.callId, toolName: request.name, error: msg });
      return { ok: false, toolName: request.name, error: msg };
    }
  }

  private async streamResponse(params: {
    utterance: string;
    decisionMode: DecisionMode;
    intent: TurnIntent;
    confidence: number;
    specialist: SpecialistRoute;
    missingSlots: string[];
    pendingActionSummary: string | null;
    toolResult?: ToolExecutionResult;
    onSentence: OnSentenceCallback;
    signal?: AbortSignal;
    kbPassages: string[];
    currentDateTime: string;
  }): Promise<{ text: string; retryReason?: string }> {
    const context: ResponseContext = {
      basePrompt: this.agentConfig.basePrompt,
      specialistPolicy: SPECIALIST_POLICIES[params.specialist],
      decisionMode: params.decisionMode,
      intent: params.intent,
      confidence: params.confidence,
      conversationSummary: this.state.summary,
      pendingActionSummary: params.pendingActionSummary,
      missingSlots: params.missingSlots,
      toolResultSummary: params.toolResult ? summarizeToolResult(params.toolResult) : undefined,
      kbPassages: params.kbPassages,
      currentDateTime: params.currentDateTime,
    };

    const responseInput = [
      `Caller said: ${params.utterance}`,
      `Decision mode: ${params.decisionMode}`,
      `Intent: ${params.intent}`,
      `Missing slots: ${params.missingSlots.join(", ") || "none"}`,
      `Pending action: ${params.pendingActionSummary ?? "none"}`,
      `Tool result: ${params.toolResult ? summarizeToolResult(params.toolResult) : "none"}`,
    ].join("\n");

    const { result, retryReason } = await runWithModelGuardrails({
      agent: responseAgent,
      input: responseInput,
      runOptions: {
        stream: true,
        context,
        signal: params.signal,
      },
    });

    const stream = result as StreamedRunResult<any, Agent<any, any>>;
    const buffer = new SentenceBuffer();
    let text = "";

    const textStream = stream.toTextStream({ compatibleWithNodeStreams: true });
    for await (const chunk of textStream) {
      if (params.signal?.aborted) break;
      const piece = typeof chunk === "string" ? chunk : String(chunk);
      text += piece;
      for (const sentence of buffer.push(piece)) {
        await params.onSentence(sentence);
      }
    }

    const tail = buffer.flush();
    if (tail) {
      await params.onSentence(tail);
      text += text.endsWith(tail) ? "" : ` ${tail}`;
    }

    await stream.completed;
    if (stream.error) {
      throw stream.error;
    }

    return { text: text.trim(), retryReason };
  }

  private async generateRecoveryResponse(params: {
    utterance: string;
    error: string;
    onSentence: OnSentenceCallback;
    signal?: AbortSignal;
    kbPassages: string[];
    currentDateTime: string;
  }): Promise<string> {
    try {
      const context: ResponseContext = {
        basePrompt: this.agentConfig.basePrompt,
        specialistPolicy: SPECIALIST_POLICIES.general,
        decisionMode: DecisionModeSchema.parse("recovery"),
        intent: "other",
        confidence: 0.2,
        conversationSummary: this.state.summary,
        pendingActionSummary: null,
        missingSlots: [],
        toolResultSummary: `Runtime recovery needed: ${params.error.slice(0, 160)}`,
        kbPassages: params.kbPassages,
        currentDateTime: params.currentDateTime,
      };

      const { result } = await runWithModelGuardrails({
        agent: responseAgent,
        input: `Caller said: ${params.utterance}\nGenerate a brief recovery response and ask for a repeat.`,
        runOptions: { context, signal: params.signal },
      });
      const generated = String((result as any)?.finalOutput ?? "").trim();
      if (generated.length > 0) {
        await params.onSentence(generated);
        return generated;
      }
    } catch (error) {
      logger.warn("recovery generation failed", {
        callId: this.callId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const fallback = nextFallback(`${this.callId}:${this.state.turnNumber}`);
    await params.onSentence(fallback);
    return fallback;
  }

  async processTurn(params: {
    utterance: string;
    history: AgentInputItem[];
    onSentence: OnSentenceCallback;
    signal?: AbortSignal;
    kbPassages?: string[];
    currentDateTime?: string;
  }): Promise<TurnOrchestratorV2Result> {
    const turnStart = Date.now();
    const turnId = randomUUID();
    this.state.turnNumber += 1;

    const utterance = params.utterance.trim();
    const currentDateTime = params.currentDateTime ?? new Date().toISOString();
    const kbPassages = params.kbPassages ?? [];

    traceLog.turnStart(this.callId, turnId, utterance, {
      orchestrator: "v2",
      turn: this.state.turnNumber,
      activeIntent: this.state.activeIntent ?? "none",
    });

    try {
      if (env.NODE_ENV !== "development") {
        const inputCheck = await guardrailsEngine.checkInput(utterance, this.callId);
        if (inputCheck.blocked || inputCheck.action === "transfer") {
          const transferText = inputCheck.message || "Let me connect you with someone right away.";
          await params.onSentence(transferText);
          const diagnostics: TurnDiagnostics = {
            intent: this.state.activeIntent ?? undefined,
            confidence: this.state.intentConfidence || undefined,
            decisionMode: "guardrail_transfer",
            pendingAction: this.state.pendingAction?.request.name ?? null,
            modelProfile: this.agentConfig.llmProfileId || env.LLM_MODEL,
            turnLatencyMs: Date.now() - turnStart,
            specialist: inferSpecialist(this.state.activeIntent ?? "other"),
          };
          const out = AssistantTurnOutputSchema.parse({
            action: "transfer",
            text: transferText,
            agentName: VOICE_NAME,
            intent: this.state.activeIntent ?? "other",
            confidence: this.state.intentConfidence || 0,
            slots: this.getSlots(this.state.activeIntent ?? "other"),
            diagnostics,
          });

          const history = [...params.history];
          history.push({ role: "user", content: utterance } as AgentInputItem);
          history.push({ role: "assistant", content: [{ type: "output_text", text: transferText }] } as AgentInputItem);

          traceLog.turnEnd(this.callId, turnId, "transfer", {
            orchestrator: "v2",
            decisionMode: diagnostics.decisionMode,
            turnLatencyMs: diagnostics.turnLatencyMs,
          });

          return {
            turnId,
            action: out.action,
            text: out.text,
            agentName: out.agentName,
            history,
            intent: out.intent,
            confidence: out.confidence,
            slots: out.slots,
            diagnostics: out.diagnostics,
          };
        }
      }

      const interpretationCtx = this.buildInterpretationContext(utterance, kbPassages, currentDateTime);
      const interpretationRun = await runWithModelGuardrails({
        agent: interpretationAgent,
        input: utterance,
        runOptions: { context: interpretationCtx, signal: params.signal },
      });
      const interpretationRaw = (interpretationRun.result as any)?.finalOutput ?? {};
      const interpretation = TurnInterpretationSchema.parse(interpretationRaw);

      const intent = this.selectIntent(interpretation);
      const confidence = interpretation.confidence;
      this.state.activeIntent = intent;
      this.state.intentConfidence = confidence;

      const slots = this.getSlots(intent);
      const extracted = normalizeSlots(interpretation.extractedSlots);
      Object.assign(slots, extracted);
      const missing = this.missingSlots(intent, slots);
      const requestedTool = this.buildToolExecutionRequest(interpretation, interpretationCtx.availableTools);

      const decision = this.decideTurn({
        interpretation,
        intent,
        confidence,
        missingSlots: missing,
        requestedTool,
      });

      let toolResult: ToolExecutionResult | undefined;
      if (decision.toolExecution) {
        toolResult = await this.executeTool(decision.toolExecution);
      }

      const specialist = SpecialistRouteSchema.parse(
        interpretation.specialist || inferSpecialist(intent),
      );
      const pendingActionSummary = this.summarizePendingAction(this.state.pendingAction);

      const spoken = await this.streamResponse({
        utterance,
        decisionMode: decision.decisionMode,
        intent,
        confidence,
        specialist,
        missingSlots: missing,
        pendingActionSummary,
        toolResult,
        onSentence: params.onSentence,
        signal: params.signal,
        kbPassages,
        currentDateTime,
      });

      let spokenText = spoken.text;
      if (!spokenText) {
        spokenText = nextFallback(`${this.callId}:${turnId}`);
        await params.onSentence(spokenText);
      }

      this.mergeSummary(utterance, spokenText);

      const diagnostics: TurnDiagnostics = {
        intent,
        confidence,
        decisionMode: decision.decisionMode,
        pendingAction: this.state.pendingAction?.request.name ?? null,
        modelProfile: this.agentConfig.llmProfileId || env.LLM_MODEL,
        retryReason: [interpretationRun.retryReason, spoken.retryReason].filter(Boolean).join("|") || undefined,
        turnLatencyMs: Date.now() - turnStart,
        specialist,
      };

      const output = AssistantTurnOutputSchema.parse({
        action: decision.action,
        text: spokenText,
        agentName: VOICE_NAME,
        intent,
        confidence,
        slots,
        diagnostics,
      });

      const history = [...params.history];
      history.push({ role: "user", content: utterance } as AgentInputItem);
      history.push({
        role: "assistant",
        content: [{ type: "output_text", text: output.text }],
      } as AgentInputItem);

      traceLog.runOutput(
        this.callId,
        turnId,
        output.agentName,
        output.action,
        output.text.length,
        history.length,
        output.text,
        {
          orchestrator: "v2",
          decisionMode: output.diagnostics.decisionMode,
          intent: output.intent,
          confidence: output.confidence,
          pendingAction: output.diagnostics.pendingAction,
          modelProfile: output.diagnostics.modelProfile,
          retryReason: output.diagnostics.retryReason,
          turnLatencyMs: output.diagnostics.turnLatencyMs,
        },
      );
      traceLog.turnEnd(this.callId, turnId, output.action, {
        orchestrator: "v2",
        decisionMode: output.diagnostics.decisionMode,
        turnLatencyMs: output.diagnostics.turnLatencyMs,
      });

      return {
        turnId,
        action: output.action,
        text: output.text,
        agentName: output.agentName,
        history,
        intent: output.intent,
        confidence: output.confidence,
        slots: output.slots,
        diagnostics: output.diagnostics,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error("turn orchestrator v2 failed", { callId: this.callId, error: msg });
      const recoveryText = await this.generateRecoveryResponse({
        utterance,
        error: msg,
        onSentence: params.onSentence,
        signal: params.signal,
        kbPassages,
        currentDateTime,
      });

      const diagnostics: TurnDiagnostics = {
        intent: this.state.activeIntent ?? undefined,
        confidence: this.state.intentConfidence || undefined,
        decisionMode: "recovery",
        pendingAction: this.state.pendingAction?.request.name ?? null,
        modelProfile: this.agentConfig.llmProfileId || env.LLM_MODEL,
        retryReason: "v2_exception",
        turnLatencyMs: Date.now() - turnStart,
        specialist: inferSpecialist(this.state.activeIntent ?? "other"),
      };

      const history = [...params.history];
      history.push({ role: "user", content: utterance } as AgentInputItem);
      history.push({ role: "assistant", content: [{ type: "output_text", text: recoveryText }] } as AgentInputItem);

      traceLog.turnEnd(this.callId, turnId, "speak", {
        orchestrator: "v2",
        decisionMode: "recovery",
        error: msg,
        turnLatencyMs: diagnostics.turnLatencyMs,
      });

      return {
        turnId,
        action: "speak",
        text: recoveryText,
        agentName: VOICE_NAME,
        history,
        intent: this.state.activeIntent ?? undefined,
        confidence: this.state.intentConfidence || undefined,
        slots: this.getSlots(this.state.activeIntent ?? "other"),
        diagnostics,
      };
    }
  }
}
