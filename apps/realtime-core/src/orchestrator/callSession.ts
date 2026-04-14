/**
 * CallSession -- Manages per-call state using a single OpenAI Agents SDK run loop.
 */

import { v4 as uuidv4 } from "uuid";
import { createLogger } from "@rezovo/logging";
import {
  AgentConfigSnapshot,
  CallSessionContext,
  CallTranscriptEntry,
  PhoneNumberConfig,
} from "@rezovo/core-types";
import {
  RunContext,
  type Agent,
  type AgentInputItem,
  type RunItem,
  type RunToolCallItem,
} from "@openai/agents";
import { UsageTracker } from "./usageTracker";
import { fetchKbPassages } from "./openai-agents";
import type { TurnDiagnostics } from "./openai-agents";
import { traceLog, summarizeHistoryForTrace } from "../traceLog";
import { env } from "../env";
import { guardrailsEngine } from "./openai-agents/guardrails";
import {
  getAgentByName,
  getStartingAgent,
  inferIntentFromAgentName,
  inferSpecialistFromAgentName,
  isStateChangingTool,
  normalizeApprovalStateAfterTurn,
  prepareApprovalStateForUserTurn,
  type ApprovalGateState,
  type CallContext,
} from "./openai-agents/agents";
import { runStreamWithModelGuardrails, validateRunInputHistory } from "./openai-agents/modelGuardrails";
import { sessionStore } from "./openai-agents/sessionStore";

export type OrchestratorResponse =
  | { type: "speak"; text: string }
  | { type: "handoff"; reason: string; text?: string }
  | { type: "end"; text: string };

export type OnSentenceCallback = (sentence: string) => void | Promise<void>;

const logger = createLogger({ service: "realtime-core", module: "callSession" });

const FALLBACK_STREAM_REPLY = "I can help with that. Could you share one more detail?";

function formatOpeningHours(openingHours: AgentConfigSnapshot["openingHours"]): string {
  const days = Object.entries(openingHours ?? {});
  if (days.length === 0) return "";

  return days
    .map(([day, windows]) => {
      const formatted = (windows ?? [])
        .map((window) => `${window.open}-${window.close}`)
        .join(", ");
      return formatted ? `${day}: ${formatted}` : `${day}: closed`;
    })
    .join(" | ");
}

function buildUserInputItem(text: string): AgentInputItem {
  return {
    role: "user",
    content: [{ type: "input_text", text }],
  } as AgentInputItem;
}

function buildAssistantOutputItem(text: string): AgentInputItem {
  return {
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text }],
  } as AgentInputItem;
}

function extractSentences(buffer: string): { sentences: string[]; remainder: string } {
  const sentences: string[] = [];
  let last = 0;

  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i];
    if (ch !== "." && ch !== "!" && ch !== "?") continue;

    const next = buffer[i + 1];
    if (next !== undefined && !/\s/.test(next)) continue;

    const sentence = buffer.slice(last, i + 1).trim();
    if (sentence.length > 0) {
      sentences.push(sentence);
    }
    last = i + 1;
  }

  return {
    sentences,
    remainder: buffer.slice(last),
  };
}

function extractToolCalls(runItems: RunItem[]): string[] {
  const calls: string[] = [];

  for (const item of runItems) {
    if (item.type !== "tool_call_item") continue;

    const toolCall = item as RunToolCallItem;
    const raw = toolCall.rawItem;
    if (!raw) continue;

    if (raw.type === "function_call" || raw.type === "hosted_tool_call") {
      calls.push(raw.name);
      continue;
    }

    if (raw.type === "computer_call") {
      calls.push("computer_call");
    }
  }

  return calls;
}

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

  private history: AgentInputItem[] = [];
  private currentAgent: Agent<CallContext, any>;
  private lastAgentName = "Receptionist";

  private kbPassages: string[] = [];
  private kbFetchPromise: Promise<string[]> | null = null;

  private restoreCompleted = false;
  private restoredFromStore = false;
  private restoreInFlight: Promise<boolean> | null = null;

  private readonly callContext: CallContext;

  constructor(
    phoneConfig: PhoneNumberConfig,
    agentConfig: AgentConfigSnapshot,
    opts?: { callId?: string; token?: string },
  ) {
    this.id = opts?.callId || uuidv4();
    this.context = {
      callId: this.id,
      orgId: phoneConfig.orgId,
      businessId: phoneConfig.businessId,
      phoneNumberConfig: phoneConfig,
      agentConfig,
      stage: "greeting",
      slots: {},
      transcript: [],
      startedAt: new Date(),
    };

    this.callContext = {
      orgId: phoneConfig.orgId,
      businessId: phoneConfig.businessId,
      callId: this.id,
      currentDateTime: new Date().toISOString(),
      agentBasePrompt: agentConfig.basePrompt,
      calendlyAccessToken: agentConfig.calendly?.accessToken,
      calendlyEventTypeUri: agentConfig.calendly?.eventTypeUri,
      calendlyTimezone: agentConfig.calendly?.timezone,
      restaurantId: agentConfig.opentable?.restaurantId,
      kbPassages: [],
      openingHours: formatOpeningHours(agentConfig.openingHours),
      slotMemory: {},
      pendingAction: null,
      approvedActionHash: null,
      approvalGateState: "none",
    };

    this.currentAgent = getStartingAgent();
    this.lastAgentName = this.currentAgent.name;

    this.usage = new UsageTracker();
    this.usage.startTimer();

    logger.info("call session created", {
      callId: this.id,
      orgId: phoneConfig.orgId,
      businessId: phoneConfig.businessId,
      orchestrator: "sdk_native",
    });
  }

  async restoreFromStore(): Promise<boolean> {
    if (this.restoreCompleted) return this.restoredFromStore;
    if (this.restoreInFlight) return this.restoreInFlight;

    this.restoreInFlight = (async () => {
      try {
        const restored = await sessionStore.getConversationState(this.id);
        if (!restored) {
          this.restoreCompleted = true;
          this.restoredFromStore = false;
          return false;
        }

        this.history = restored.history;
        this.currentAgent = getAgentByName(restored.currentAgentName) ?? getStartingAgent();
        this.lastAgentName = this.currentAgent.name;

        this.callContext.slotMemory = restored.context.slotMemory;
        this.callContext.pendingAction = restored.context.pendingAction;
        this.callContext.approvedActionHash = restored.context.approvedActionHash;
        this.callContext.approvalGateState = restored.context.approvalGateState;
        this.callContext.currentDateTime = restored.context.currentDateTime;

        this.kbPassages = restored.context.kbPassages;
        this.callContext.kbPassages = this.kbPassages;

        this.context.transcript = restored.transcript;
        this.turnCount = restored.turnCount;
        this.latestIntent = restored.latestIntent;
        this.latestIntentConfidence = restored.latestIntentConfidence ?? 0;
        this.latestSlots = restored.latestSlots ?? {};
        this.context.slots = {
          ...(this.context.slots as Record<string, unknown>),
          ...this.latestSlots,
        } as CallSessionContext["slots"];

        this.restoreCompleted = true;
        this.restoredFromStore = true;

        logger.info("conversation state restored", {
          callId: this.id,
          historyLen: this.history.length,
          activeAgent: this.lastAgentName,
          turnCount: this.turnCount,
        });

        return true;
      } catch (error) {
        logger.warn("failed to restore conversation state", {
          callId: this.id,
          error: error instanceof Error ? error.message : String(error),
        });
        this.restoreCompleted = true;
        this.restoredFromStore = false;
        return false;
      } finally {
        this.restoreInFlight = null;
      }
    })();

    return this.restoreInFlight;
  }

  greet(): OrchestratorResponse {
    if (this.restoredFromStore && this.history.length > 0) {
      return { type: "speak", text: "" };
    }

    const greetingText =
      (this.context.agentConfig as unknown as { greetingMessage?: string }).greetingMessage ||
      "Hello! Thanks for calling. How can I help you today?";

    this.addTranscriptEntry({
      from: "agent",
      text: greetingText,
      timestamp: new Date().toISOString(),
    });

    this.history.push(buildAssistantOutputItem(greetingText));

    const { agentConfig } = this.context;
    if (agentConfig.kbNamespace) {
      this.kbFetchPromise = fetchKbPassages(
        this.id,
        "business services hours pricing appointments",
        agentConfig.orgId,
        agentConfig.businessId,
        agentConfig.kbNamespace,
      ).catch(() => []);
    }

    this.callContext.kbPassages = this.kbPassages;
    void this.persistConversationState();

    traceLog.sessionGreet(this.id, greetingText.length);
    return { type: "speak", text: greetingText };
  }

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

    const turnStart = Date.now();
    const turnId = uuidv4();

    try {
      await this.restoreFromStore();

      const cleanedUtterance = utterance.trim();
      if (!cleanedUtterance) {
        return { type: "speak", text: this.localFallbackForTurn(this.turnCount) };
      }

      if (this.kbFetchPromise) {
        this.kbPassages = await this.kbFetchPromise;
        this.kbFetchPromise = null;
        this.callContext.kbPassages = this.kbPassages;
      }

      await this.refreshKbForUtterance(cleanedUtterance);

      this.addTranscriptEntry({
        from: "user",
        text: cleanedUtterance,
        timestamp: new Date().toISOString(),
      });

      if (env.NODE_ENV !== "development") {
        const inputCheck = await guardrailsEngine.checkInput(cleanedUtterance, this.id);

        if (inputCheck.blocked || inputCheck.action === "transfer") {
          const transferText = inputCheck.message || "Let me connect you with someone right away.";
          await this.emitSentenceWithOutputGuardrail(transferText, onSentence);
          this.applyGuardrailHistory(cleanedUtterance, transferText);

          this.lastTurnDiagnostics = {
            intent: this.latestIntent,
            confidence: this.latestIntentConfidence || undefined,
            decisionMode: "guardrail_transfer",
            pendingAction: this.callContext.pendingAction?.toolName ?? null,
            modelProfile: env.LLM_MODEL,
            turnLatencyMs: Date.now() - turnStart,
            specialist: inferSpecialistFromAgentName(this.lastAgentName),
            history_len: this.history.length,
            active_agent: this.lastAgentName,
            tool_calls: [],
            approval_gate_state: this.callContext.approvalGateState,
            ttft_ms: 0,
            llm_total_ms: 0,
          };

          await this.persistConversationState();
          return { type: "handoff", reason: "guardrail_transfer", text: transferText };
        }

        if (inputCheck.action === "warn" && inputCheck.message) {
          const warningText = inputCheck.message;
          await this.emitSentenceWithOutputGuardrail(warningText, onSentence);
          this.applyGuardrailHistory(cleanedUtterance, warningText);

          this.lastTurnDiagnostics = {
            intent: this.latestIntent,
            confidence: this.latestIntentConfidence || undefined,
            decisionMode: "recovery",
            pendingAction: this.callContext.pendingAction?.toolName ?? null,
            modelProfile: env.LLM_MODEL,
            turnLatencyMs: Date.now() - turnStart,
            specialist: inferSpecialistFromAgentName(this.lastAgentName),
            history_len: this.history.length,
            active_agent: this.lastAgentName,
            tool_calls: [],
            approval_gate_state: this.callContext.approvalGateState,
            ttft_ms: 0,
            llm_total_ms: 0,
          };

          await this.persistConversationState();
          return { type: "speak", text: warningText };
        }
      }

      prepareApprovalStateForUserTurn(this.callContext, cleanedUtterance);
      this.callContext.currentDateTime = new Date().toISOString();
      this.callContext.kbPassages = this.kbPassages;

      const candidateInput = [...this.history, buildUserInputItem(cleanedUtterance)];
      const validatedInput = validateRunInputHistory(candidateInput);
      if (validatedInput.history.length === 0) {
        throw new Error("validated run history was empty");
      }

      this.history = validatedInput.history;

      traceLog.turnStart(this.id, turnId, cleanedUtterance, {
        orchestrator: "sdk_native",
        turn: this.turnCount,
        activeAgent: this.lastAgentName,
      });
      traceLog.runInput(this.id, turnId, this.lastAgentName, this.history.length, summarizeHistoryForTrace(this.history));

      const runContext = new RunContext<CallContext>(this.callContext);
      const llmStart = Date.now();

      const runResponse = await runStreamWithModelGuardrails({
        agent: this.currentAgent,
        input: this.history,
        runOptions: {
          context: runContext,
          signal: this.abortController.signal,
        },
      });

      const streamResult = runResponse.result;

      let fullText = "";
      let sentenceBuffer = "";
      let ttftMs = 0;
      let emittedAtLeastOneSentence = false;

      const textStream = streamResult.toTextStream({ compatibleWithNodeStreams: true });
      for await (const rawChunk of textStream) {
        const chunk = String(rawChunk ?? "");
        if (!chunk) continue;

        if (ttftMs === 0) {
          ttftMs = Date.now() - llmStart;
          traceLog.streamFirstToken(this.id, turnId, ttftMs, this.lastAgentName);
        }

        fullText += chunk;
        sentenceBuffer += chunk;

        const extracted = extractSentences(sentenceBuffer);
        sentenceBuffer = extracted.remainder;

        for (const sentence of extracted.sentences) {
          const safeSentence = await this.emitSentenceWithOutputGuardrail(sentence, onSentence);
          emittedAtLeastOneSentence = emittedAtLeastOneSentence || safeSentence.length > 0;
        }
      }

      if (sentenceBuffer.trim().length > 0) {
        const safeTail = await this.emitSentenceWithOutputGuardrail(sentenceBuffer.trim(), onSentence);
        emittedAtLeastOneSentence = emittedAtLeastOneSentence || safeTail.length > 0;
      }

      await streamResult.completed;
      traceLog.streamComplete(this.id, turnId, true);

      const llmTotalMs = Date.now() - llmStart;
      this.history = streamResult.history;
      this.currentAgent = streamResult.currentAgent ?? streamResult.lastAgent ?? this.currentAgent;
      this.lastAgentName = this.currentAgent.name;

      normalizeApprovalStateAfterTurn(this.callContext);

      this.latestIntent = inferIntentFromAgentName(this.lastAgentName);
      const toolCalls = extractToolCalls(streamResult.newItems);
      this.latestIntentConfidence = toolCalls.length > 0 ? 0.88 : 0.74;

      this.latestSlots = { ...this.callContext.slotMemory };
      this.context.slots = {
        ...(this.context.slots as Record<string, unknown>),
        ...this.latestSlots,
      } as CallSessionContext["slots"];

      if (!emittedAtLeastOneSentence) {
        const fallback = FALLBACK_STREAM_REPLY;
        await this.emitSentenceWithOutputGuardrail(fallback, onSentence);
        fullText = fullText.trim() ? fullText : fallback;
      }

      const finalText = fullText.trim() || FALLBACK_STREAM_REPLY;
      this.addTranscriptEntry({
        from: "agent",
        text: finalText,
        timestamp: new Date().toISOString(),
      });

      this.addLlmUsage(runContext.usage.inputTokens, runContext.usage.outputTokens);

      const responseAction = this.pickResponseAction(cleanedUtterance, finalText);

      this.lastTurnDiagnostics = {
        intent: this.latestIntent,
        confidence: this.latestIntentConfidence || undefined,
        decisionMode:
          responseAction === "transfer"
            ? "transfer"
            : responseAction === "end"
              ? "end"
              : this.determineDecisionMode(toolCalls, this.callContext.approvalGateState),
        pendingAction: this.callContext.pendingAction?.toolName ?? null,
        modelProfile: runResponse.modelProfile,
        retryReason: runResponse.retryReason,
        turnLatencyMs: Date.now() - turnStart,
        specialist: inferSpecialistFromAgentName(this.lastAgentName),
        history_len: this.history.length,
        active_agent: this.lastAgentName,
        tool_calls: toolCalls,
        approval_gate_state: this.callContext.approvalGateState,
        ttft_ms: ttftMs,
        llm_total_ms: llmTotalMs,
      };

      traceLog.turnTimingSummary(this.id, turnId, {
        guardrailsMs: 0,
        llmTtftMs: ttftMs,
        llmTotalMs,
        totalTurnMs: Date.now() - turnStart,
      });

      traceLog.runOutput(
        this.id,
        turnId,
        this.lastAgentName,
        responseAction,
        finalText.length,
        this.history.length,
        finalText,
        {
          toolCalls,
          approvalGateState: this.callContext.approvalGateState,
        },
      );
      traceLog.sessionResponse(this.id, turnId, responseAction, finalText);

      await this.persistConversationState();

      if (responseAction === "transfer") {
        return { type: "handoff", reason: this.lastAgentName, text: finalText };
      }

      if (responseAction === "end") {
        return { type: "end", text: finalText };
      }

      return { type: "speak", text: finalText };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg === "Aborted") {
        logger.info("turn aborted (caller hangup)", { callId: this.id });
        throw error;
      }

      traceLog.streamError(this.id, turnId, msg);
      logger.error("error processing user input (streaming)", { callId: this.id, error: msg });

      const fallback = this.localFallbackForTurn(this.turnCount);
      await this.emitSentenceWithOutputGuardrail(fallback, onSentence);
      this.addTranscriptEntry({
        from: "agent",
        text: fallback,
        timestamp: new Date().toISOString(),
      });

      this.lastTurnDiagnostics = {
        intent: this.latestIntent,
        confidence: this.latestIntentConfidence || undefined,
        decisionMode: "recovery",
        pendingAction: this.callContext.pendingAction?.toolName ?? null,
        modelProfile: env.LLM_MODEL,
        retryReason: "session_exception",
        turnLatencyMs: Date.now() - turnStart,
        specialist: inferSpecialistFromAgentName(this.lastAgentName),
        history_len: this.history.length,
        active_agent: this.lastAgentName,
        tool_calls: [],
        approval_gate_state: this.callContext.approvalGateState,
        ttft_ms: 0,
        llm_total_ms: 0,
      };

      await this.persistConversationState();
      return { type: "speak", text: fallback };
    } finally {
      this.processing = false;
      this.abortController = null;
    }
  }

  async receiveUser(utterance: string): Promise<OrchestratorResponse> {
    return this.receiveUserStreaming(utterance, async () => undefined);
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      logger.info("call session aborted", { callId: this.id });
    }
  }

  addTtsUsage(chars: number, seconds: number): void {
    this.usage.addTts(chars, seconds);
  }

  addLlmUsage(inputTokens: number, outputTokens: number): void {
    this.usage.addLlmTokens(inputTokens, outputTokens);
  }

  getUsageSnapshot() {
    return this.usage.snapshot();
  }

  getTranscript(): CallTranscriptEntry[] {
    return this.context.transcript;
  }

  getAgentHistory(): AgentInputItem[] {
    return this.history;
  }

  getCurrentAgentName(): string {
    return this.lastAgentName;
  }

  getStateMachine(): {
    current: {
      activeIntent?: string;
      intentConfidence?: number;
      slots: Record<string, unknown>;
    };
  } {
    return {
      current: {
        activeIntent: this.latestIntent,
        intentConfidence: this.latestIntentConfidence || undefined,
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

  async cleanup(): Promise<void> {
    this.usage.stopTimer();
    await sessionStore.clearConversationState(this.id);
    logger.debug("call session cleaned up", { callId: this.id });
  }

  private async refreshKbForUtterance(utterance: string): Promise<void> {
    const namespace = this.context.agentConfig.kbNamespace;
    if (!namespace || utterance.length < 3) return;

    try {
      const passages = await fetchKbPassages(
        this.id,
        utterance,
        this.context.orgId,
        this.context.businessId,
        namespace,
      );
      if (passages.length > 0) {
        this.kbPassages = passages;
        this.callContext.kbPassages = passages;
      }
    } catch {
      // best effort only
    }
  }

  private async emitSentenceWithOutputGuardrail(
    sentence: string,
    onSentence: OnSentenceCallback,
  ): Promise<string> {
    const trimmed = sentence.trim();
    if (!trimmed) return "";

    if (env.NODE_ENV === "development") {
      await onSentence(trimmed);
      return trimmed;
    }

    const outputCheck = await guardrailsEngine.checkOutput(trimmed, this.id);
    if (!outputCheck.blocked) {
      await onSentence(trimmed);
      return trimmed;
    }

    const fallback = outputCheck.message || "I apologize, let me rephrase that.";
    await onSentence(fallback);
    return fallback;
  }

  private determineDecisionMode(
    toolCalls: string[],
    approvalGateState: ApprovalGateState,
  ): TurnDiagnostics["decisionMode"] {
    if (approvalGateState === "awaiting_confirmation" && toolCalls.length === 0) {
      return "confirm_then_execute";
    }

    if (toolCalls.length === 0) {
      return "direct_response";
    }

    if (toolCalls.some((toolName) => isStateChangingTool(toolName))) {
      return "execute_confirmed";
    }

    return "execute_read_only";
  }

  private pickResponseAction(utterance: string, text: string): "speak" | "transfer" | "end" {
    const loweredText = text.toLowerCase();
    const loweredUtterance = utterance.toLowerCase();

    if (
      /\b(connect|transfer)\b/.test(loweredText) &&
      /\b(manager|someone|person|human|representative|agent)\b/.test(loweredText)
    ) {
      return "transfer";
    }

    if (
      /\b(bye|goodbye|take care|have a great day)\b/.test(loweredText) &&
      /\b(bye|goodbye|that'?s all|thank you|thanks|done)\b/.test(loweredUtterance)
    ) {
      return "end";
    }

    return "speak";
  }

  private applyGuardrailHistory(userText: string, agentText: string): void {
    this.history = [...this.history, buildUserInputItem(userText), buildAssistantOutputItem(agentText)];
    this.addTranscriptEntry({
      from: "agent",
      text: agentText,
      timestamp: new Date().toISOString(),
    });
  }

  private async persistConversationState(): Promise<void> {
    await sessionStore.saveConversationState(this.id, {
      callId: this.id,
      history: this.history,
      currentAgentName: this.lastAgentName,
      context: {
        slotMemory: this.callContext.slotMemory,
        pendingAction: this.callContext.pendingAction,
        approvedActionHash: this.callContext.approvedActionHash,
        approvalGateState: this.callContext.approvalGateState,
        currentDateTime: this.callContext.currentDateTime,
        kbPassages: this.callContext.kbPassages,
      },
      transcript: this.context.transcript,
      turnCount: this.turnCount,
      latestIntent: this.latestIntent,
      latestIntentConfidence: this.latestIntentConfidence || undefined,
      latestSlots: this.latestSlots,
    });
  }

  private addTranscriptEntry(entry: CallTranscriptEntry): void {
    this.context.transcript.push(entry);
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
