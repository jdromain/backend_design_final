/**
 * CallSession -- Manages per-call state using the OpenAI Agents SDK natively.
 *
 * Key changes from previous version:
 *   - history and currentAgent are managed by the SDK (stream.history, stream.currentAgent)
 *   - No more ConversationStateMachine (SDK handles routing via handoffs)
 *   - No more manual agent selection or intent detection
 *   - Concurrency guard and abort support preserved
 */

import { v4 as uuidv4 } from "uuid";
import { createLogger } from "@rezovo/logging";
import {
  AgentConfigSnapshot,
  CallSessionContext,
  CallTranscriptEntry,
  PhoneNumberConfig,
} from "@rezovo/core-types";
import type { Agent, AgentInputItem } from "@openai/agents";
import { UsageTracker } from "./usageTracker";
import {
  processTurn,
  triageAgent,
  fetchKbPassages,
  TurnOrchestratorV2,
  type OnSentenceCallback,
  type TurnDiagnostics,
} from "./openai-agents";
import { traceLog } from "../traceLog";
import { env } from "../env";

export type OrchestratorResponse =
  | { type: "speak"; text: string }
  | { type: "handoff"; reason: string; text?: string }
  | { type: "end"; text: string };

const logger = createLogger({ service: "realtime-core", module: "callSession" });

export class CallSession {
  readonly id: string;
  readonly context: CallSessionContext;

  private usage: UsageTracker;
  private turnCount = 0;
  private processing = false;
  private abortController: AbortController | null = null;
  private latestIntent?: string;
  private latestIntentConfidence = 0;
  private latestSlots: Record<string, unknown> = {};
  private lastTurnDiagnostics: TurnDiagnostics | null = null;

  // SDK-managed state: these are updated after each turn from stream.history / stream.currentAgent
  private history: AgentInputItem[] = [];
  private currentAgent: Agent<any, any> = triageAgent;
  private readonly useOrchestratorV2: boolean;
  private readonly turnOrchestratorV2: TurnOrchestratorV2 | null;

  // Track the last active agent name for persistence/logging
  private lastAgentName = "Receptionist";

  // Session-level KB cache: fetched once during greet(), reused on every turn
  private kbPassages: string[] = [];
  private kbFetchPromise: Promise<string[]> | null = null;

  constructor(
    phoneConfig: PhoneNumberConfig,
    agentConfig: AgentConfigSnapshot,
    opts?: { callId?: string; token?: string },
  ) {
    this.id = opts?.callId || uuidv4();
    this.context = {
      callId: this.id,
      tenantId: phoneConfig.tenantId,
      businessId: phoneConfig.businessId,
      phoneNumberConfig: phoneConfig,
      agentConfig,
      stage: "greeting",
      slots: {},
      transcript: [],
      startedAt: new Date(),
    };
    this.usage = new UsageTracker();
    this.usage.startTimer();
    this.useOrchestratorV2 = this.shouldUseOrchestratorV2(phoneConfig.tenantId);
    this.turnOrchestratorV2 = this.useOrchestratorV2
      ? new TurnOrchestratorV2(this.id, agentConfig, phoneConfig)
      : null;

    logger.info("call session created", {
      callId: this.id,
      tenantId: phoneConfig.tenantId,
      businessId: phoneConfig.businessId,
      orchestrator: this.useOrchestratorV2 ? "v2" : "legacy",
    });
  }

  // ---- Greeting ----

  greet(): OrchestratorResponse {
    const greetingText =
      (this.context.agentConfig as any).greetingMessage ||
      "Hello! Thanks for calling. How can I help you today?";

    this.addTranscriptEntry({
      from: "agent",
      text: greetingText,
      timestamp: new Date().toISOString(),
    });

    // Seed the SDK history with the greeting as an assistant message
    this.history.push({
      role: "assistant" as const,
      content: [{ type: "output_text" as const, text: greetingText }],
    } as AgentInputItem);

    // Start KB pre-fetch in background — runs while greeting TTS is synthesizing and playing.
    // By the time the caller responds, KB is already ready. Avoids blocking every turn.
    const { agentConfig } = this.context;
    if (agentConfig.kbNamespace) {
      this.kbFetchPromise = fetchKbPassages(
        this.id,
        "business services hours pricing appointments",
        agentConfig.tenantId,
        agentConfig.businessId,
        agentConfig.kbNamespace,
      ).catch(() => []);
    }

    traceLog.sessionGreet(this.id, greetingText.length);
    return { type: "speak", text: greetingText };
  }

  // ---- Streaming Turn Processing ----

  async receiveUserStreaming(
    utterance: string,
    onSentence: OnSentenceCallback,
  ): Promise<OrchestratorResponse> {
    if (this.processing) {
      logger.warn("receiveUserStreaming called while already processing", { callId: this.id });
      return { type: "speak", text: "One moment, I'm still working on your last request." };
    }

    this.processing = true;
    this.turnCount++;
    this.abortController = new AbortController();

    try {
      // Drain the background KB pre-fetch on the first turn (it was started in greet())
      if (this.kbFetchPromise) {
        this.kbPassages = await this.kbFetchPromise;
        this.kbFetchPromise = null;
      }

      this.addTranscriptEntry({
        from: "user",
        text: utterance,
        timestamp: new Date().toISOString(),
      });

      const result =
        this.turnOrchestratorV2
          ? await this.turnOrchestratorV2.processTurn({
              utterance,
              history: this.history,
              currentAgent: this.currentAgent,
              onSentence,
              currentDateTime: new Date().toISOString(),
              signal: this.abortController.signal,
              kbPassages: this.kbPassages,
            })
          : await processTurn({
              utterance,
              callId: this.id,
              history: this.history,
              currentAgent: this.currentAgent,
              agentConfig: this.context.agentConfig,
              phoneConfig: this.context.phoneNumberConfig,
              onSentence,
              currentDateTime: new Date().toISOString(),
              signal: this.abortController.signal,
              kbPassages: this.kbPassages,
            });

      // SDK manages history and agent routing
      this.history = result.history;
      this.currentAgent = result.currentAgent;
      this.lastAgentName = result.agentName;
      if (result.intent) this.latestIntent = result.intent;
      if (typeof result.confidence === "number") this.latestIntentConfidence = result.confidence;
      if (result.slots) {
        this.latestSlots = { ...this.latestSlots, ...result.slots };
        this.context.slots = {
          ...(this.context.slots as Record<string, unknown>),
          ...result.slots,
        } as any;
      }
      if (result.diagnostics) {
        this.lastTurnDiagnostics = result.diagnostics;
      }

      traceLog.sessionResponse(this.id, result.turnId, result.action, result.text);

      this.addTranscriptEntry({
        from: "agent",
        text: result.text,
        timestamp: new Date().toISOString(),
      });

      logger.info("turn complete (streamed)", {
        callId: this.id,
        turn: this.turnCount,
        userText: utterance.slice(0, 100),
        agentAction: result.action,
        agentName: result.agentName,
        agentText: result.text?.slice(0, 150),
        historyLen: this.history.length,
        intent: this.latestIntent,
        intentConfidence: this.latestIntentConfidence || undefined,
        decisionMode: result.diagnostics?.decisionMode,
        pendingAction: result.diagnostics?.pendingAction,
        modelProfile: result.diagnostics?.modelProfile,
        retryReason: result.diagnostics?.retryReason,
      });

      return this.mapActionToResponse(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg === "Aborted") {
        logger.info("turn aborted (caller hangup)", { callId: this.id });
        throw error;
      }

      logger.error("error processing user input (streaming)", { callId: this.id, error: msg });

      const fallback = this.localFallbackForTurn(this.turnCount);
      this.addTranscriptEntry({
        from: "agent",
        text: fallback,
        timestamp: new Date().toISOString(),
      });
      this.lastTurnDiagnostics = {
        intent: this.latestIntent,
        confidence: this.latestIntentConfidence || undefined,
        decisionMode: "recovery",
        pendingAction: null,
        modelProfile: this.context.agentConfig.llmProfileId || env.LLM_MODEL,
        retryReason: "session_exception",
        turnLatencyMs: 0,
        specialist: "general",
      };
      return { type: "speak", text: fallback };
    } finally {
      this.processing = false;
      this.abortController = null;
    }
  }

  // ---- Non-streaming fallback (delegates to streaming with no-op callback) ----

  async receiveUser(utterance: string): Promise<OrchestratorResponse> {
    let fullText = "";
    const result = await this.receiveUserStreaming(utterance, async (sentence) => {
      fullText += sentence + " ";
    });
    return result;
  }

  // ---- Abort (called on hangup) ----

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      logger.info("call session aborted", { callId: this.id });
    }
  }

  // ---- Helpers ----

  private mapActionToResponse(result: {
    action: string;
    text: string;
    agentName: string;
  }): OrchestratorResponse {
    switch (result.action) {
      case "transfer":
        return { type: "handoff", reason: result.agentName, text: result.text };
      case "end":
        return { type: "end", text: result.text };
      case "speak":
      default:
        return { type: "speak", text: result.text };
    }
  }

  private addTranscriptEntry(entry: CallTranscriptEntry): void {
    this.context.transcript.push(entry);
  }

  // ---- Usage Tracking ----

  addTtsUsage(chars: number, seconds: number): void {
    this.usage.addTts(chars, seconds);
  }

  addLlmUsage(inputTokens: number, outputTokens: number): void {
    this.usage.addLlmTokens(inputTokens, outputTokens);
  }

  getUsageSnapshot() {
    return this.usage.snapshot();
  }

  // ---- Accessors ----

  getTranscript(): CallTranscriptEntry[] {
    return this.context.transcript;
  }

  getAgentHistory(): AgentInputItem[] {
    return this.history;
  }

  getCurrentAgentName(): string {
    return this.lastAgentName;
  }

  /**
   * Compatibility shim for callController persistence.
   * Returns a minimal state object matching what the controller expects.
   */
  getStateMachine(): { current: { activeIntent?: string; intentConfidence?: number; slots: Record<string, unknown> } } {
    const inferred = this.latestIntent ?? this.inferIntentFromAgent(this.lastAgentName);
    return {
      current: {
        activeIntent: inferred,
        intentConfidence: this.latestIntentConfidence || (inferred ? 0.75 : undefined),
        slots: Object.keys(this.latestSlots).length > 0 ? this.latestSlots : this.context.slots ?? {},
      },
    };
  }

  getLastTurnDiagnostics(): TurnDiagnostics | null {
    return this.lastTurnDiagnostics;
  }

  getTurnCount(): number {
    return this.turnCount;
  }

  // ---- Cleanup ----

  async cleanup(): Promise<void> {
    this.usage.stopTimer();
    logger.debug("call session cleaned up", { callId: this.id });
  }

  // ---- Private ----

  private inferIntentFromAgent(agentName: string): string | undefined {
    const map: Record<string, string> = {
      "Booking Specialist": "create_booking",
      "Cancellation Specialist": "cancel_booking",
      "Customer Care Specialist": "complaint",
      "Information Specialist": "info_request",
      Receptionist: "triage",
      "Voice Concierge": this.latestIntent ?? "other",
    };
    return map[agentName];
  }

  private shouldUseOrchestratorV2(tenantId: string): boolean {
    if (!env.RTC_ORCHESTRATOR_V2_ENABLED) return false;
    const allowList = env.RTC_ORCHESTRATOR_V2_TENANTS
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return allowList.length === 0 || allowList.includes(tenantId);
  }

  private localFallbackForTurn(turn: number): string {
    const fallbackPool = [
      "I'm sorry, I missed that. Could you say it once more?",
      "I didn't catch that clearly. Can you repeat it for me?",
      "Let's try that again. What can I help you with?",
    ] as const;
    return fallbackPool[turn % fallbackPool.length];
  }
}
