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
import { processTurn, triageAgent, fetchKbPassages, type OnSentenceCallback } from "./openai-agents";
import { bookingAgent, cancelAgent, complaintAgent } from "./openai-agents/agents";
import { traceLog } from "../traceLog";

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

  // SDK-managed state: these are updated after each turn from stream.history / stream.currentAgent
  private history: AgentInputItem[] = [];
  private currentAgent: Agent<any, any> = triageAgent;

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

    logger.info("call session created", {
      callId: this.id,
      tenantId: phoneConfig.tenantId,
      businessId: phoneConfig.businessId,
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

  // ---- Keyword-based intent detection for turn 1 ----

  private selectAgentForFirstTurn(utterance: string): Agent<any, any> {
    const t = utterance.toLowerCase();
    if (/\b(book|appointment|schedule|meeting|reservation|reserve)\b/.test(t)) return bookingAgent;
    if (/\b(cancel)\b/.test(t)) return cancelAgent;
    if (/\b(complaint|complain|unhappy|upset|frustrated|speak.*manager)\b/.test(t)) return complaintAgent;
    return triageAgent;
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

      // On turn 1, use keyword intent detection to skip triage when intent is clear
      if (this.turnCount === 1) {
        this.currentAgent = this.selectAgentForFirstTurn(utterance);
        logger.info("intent pre-detection", {
          callId: this.id,
          agent: this.currentAgent.name,
          utterance: utterance.slice(0, 100),
        });
      }

      this.addTranscriptEntry({
        from: "user",
        text: utterance,
        timestamp: new Date().toISOString(),
      });

      const result = await processTurn({
        utterance,
        callId: this.id,
        history: this.history,
        currentAgent: this.currentAgent,
        agentConfig: this.context.agentConfig,
        phoneConfig: this.context.phoneNumberConfig,
        onSentence,
        currentDateTime: this.context.startedAt.toISOString(),
        signal: this.abortController.signal,
        kbPassages: this.kbPassages,
      });

      // SDK manages history and agent routing
      this.history = result.history;
      this.currentAgent = result.currentAgent;
      this.lastAgentName = result.agentName;

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
      });

      return this.mapActionToResponse(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg === "Aborted") {
        logger.info("turn aborted (caller hangup)", { callId: this.id });
        throw error;
      }

      logger.error("error processing user input (streaming)", { callId: this.id, error: msg });

      const fallback = "I apologize, I'm having a bit of trouble. Could you repeat that?";
      this.addTranscriptEntry({
        from: "agent",
        text: fallback,
        timestamp: new Date().toISOString(),
      });
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
    return {
      current: {
        activeIntent: this.inferIntentFromAgent(this.lastAgentName),
        intentConfidence: 0.9,
        slots: this.context.slots ?? {},
      },
    };
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
    };
    return map[agentName];
  }
}
