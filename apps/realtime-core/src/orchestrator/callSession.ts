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
  type RunResult,
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
import { runStreamWithModelGuardrails, runWithModelGuardrails, validateRunInputHistory } from "./openai-agents/modelGuardrails";
import { sessionStore } from "./openai-agents/sessionStore";

export type OrchestratorResponse =
  | { type: "speak"; text: string }
  | { type: "handoff"; reason: string; text?: string }
  | { type: "end"; text: string };

export type OnSentenceCallback = (sentence: string) => void | Promise<void>;

const logger = createLogger({ service: "realtime-core", module: "callSession" });

const FALLBACK_STREAM_REPLY = "I can help with that. Could you share one more detail?";
const LOG_TEXT_PREVIEW = 220;

function textPreview(text: string, maxLen = LOG_TEXT_PREVIEW): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
}

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
    const raw = toolCall.rawItem as unknown;
    if (!raw || typeof raw !== "object") continue;

    const rawRecord = raw as Record<string, unknown>;
    const rawType = typeof rawRecord.type === "string" ? rawRecord.type : "";
    const rawName = typeof rawRecord.name === "string" ? rawRecord.name : "";

    if ((rawType === "function_call" || rawType === "hosted_tool_call") && rawName) {
      calls.push(rawName);
      continue;
    }

    if (rawType === "computer_call") {
      calls.push("computer_call");
    }
  }

  return calls;
}

function extractAssistantTextFromHistory(history: AgentInputItem[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const item = history[i] as unknown as Record<string, unknown>;
    if (!item || item.role !== "assistant" || !Array.isArray(item.content)) continue;
    const texts = (item.content as Array<Record<string, unknown>>)
      .filter((part) => part.type === "output_text" && typeof part.text === "string")
      .map((part) => String(part.text).trim())
      .filter((text) => text.length > 0);
    if (texts.length > 0) {
      return texts.join(" ");
    }
  }
  return "";
}

function historyRole(item: AgentInputItem): string {
  const role = (item as unknown as Record<string, unknown>).role;
  return typeof role === "string" ? role : "unknown";
}

function summarizeHistoryTail(history: AgentInputItem[], maxItems = 4): Array<Record<string, unknown>> {
  return history.slice(-maxItems).map((item) => {
    const raw = item as unknown as Record<string, unknown>;
    const content = Array.isArray(raw.content) ? raw.content : [];
    return {
      role: historyRole(item),
      contentTypes: content
        .map((part) => (part && typeof part === "object" ? (part as Record<string, unknown>).type : undefined))
        .filter((type): type is string => typeof type === "string"),
      status: typeof raw.status === "string" ? raw.status : undefined,
    };
  });
}

function errorName(error: unknown): string {
  if (error instanceof Error && error.name) return error.name;
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === "string" && name.length > 0 ? name : "UnknownError";
}

function errorStackPreview(error: unknown): string | undefined {
  if (!(error instanceof Error) || typeof error.stack !== "string") return undefined;
  return error.stack.split("\n").slice(0, 4).join("\n");
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
        logger.warn("empty user utterance, returning local fallback", {
          callId: this.id,
          turnId,
          turn: this.turnCount,
          activeAgent: this.lastAgentName,
        });
        return { type: "speak", text: this.localFallbackForTurn(this.turnCount) };
      }

      logger.info("turn started", {
        callId: this.id,
        turnId,
        turn: this.turnCount,
        activeAgent: this.lastAgentName,
        historyLen: this.history.length,
        utterancePreview: textPreview(cleanedUtterance),
      });

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
        logger.info("input guardrail evaluated", {
          callId: this.id,
          turnId,
          action: inputCheck.action,
          blocked: inputCheck.blocked,
          messagePreview: inputCheck.message ? textPreview(inputCheck.message) : null,
          activeAgent: this.lastAgentName,
        });

        if (inputCheck.blocked || inputCheck.action === "transfer") {
          const transferText = inputCheck.message || "Let me connect you with someone right away.";
          await this.emitSentenceWithOutputGuardrail(transferText, onSentence);
          logger.warn("response emitted from input guardrail transfer", {
            callId: this.id,
            turnId,
            source: "guardrail_transfer",
            agent: this.lastAgentName,
            textPreview: textPreview(transferText),
          });
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
          logger.warn("response emitted from input guardrail warning", {
            callId: this.id,
            turnId,
            source: "guardrail_warn",
            agent: this.lastAgentName,
            textPreview: textPreview(warningText),
          });
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

      // Validate only the new user item; keep prior SDK history untouched.
      const validatedUserInput = validateRunInputHistory([buildUserInputItem(cleanedUtterance)]);
      if (validatedUserInput.history.length === 0) {
        throw new Error("validated run history was empty");
      }
      if (validatedUserInput.issues.length > 0 || validatedUserInput.truncated) {
        logger.warn("user input item sanitized before run", {
          callId: this.id,
          turnId,
          issueCount: validatedUserInput.issues.length,
          truncated: validatedUserInput.truncated,
        });
      }

      this.history = [...this.history, validatedUserInput.history[0]];
      const agentBeforeRun = this.lastAgentName;
      logger.info("llm run starting", {
        callId: this.id,
        turnId,
        agentBeforeRun,
        historyLen: this.history.length,
        approvalGateState: this.callContext.approvalGateState,
        pendingActionTool: this.callContext.pendingAction?.toolName ?? null,
      });

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
        // Preserve exact SDK history shape between turns (reasoning/tool linkage).
        trustInputHistory: true,
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
          logger.info("llm first token", {
            callId: this.id,
            turnId,
            agentAtRunStart: agentBeforeRun,
            ttftMs,
          });
        }

        fullText += chunk;
        sentenceBuffer += chunk;

        const extracted = extractSentences(sentenceBuffer);
        sentenceBuffer = extracted.remainder;

        for (const sentence of extracted.sentences) {
          const safeSentence = await this.emitSentenceWithOutputGuardrail(sentence, onSentence);
          logger.info("agent sentence emitted", {
            callId: this.id,
            turnId,
            source: "model_stream",
            agentAtRunStart: agentBeforeRun,
            textPreview: textPreview(safeSentence),
          });
          emittedAtLeastOneSentence = emittedAtLeastOneSentence || safeSentence.length > 0;
        }
      }

      if (sentenceBuffer.trim().length > 0) {
        const safeTail = await this.emitSentenceWithOutputGuardrail(sentenceBuffer.trim(), onSentence);
        logger.info("agent sentence emitted", {
          callId: this.id,
          turnId,
          source: "model_stream_tail",
          agentAtRunStart: agentBeforeRun,
          textPreview: textPreview(safeTail),
        });
        emittedAtLeastOneSentence = emittedAtLeastOneSentence || safeTail.length > 0;
      }

      await streamResult.completed;
      traceLog.streamComplete(this.id, turnId, true);

      const llmTotalMs = Date.now() - llmStart;
      this.history = streamResult.history;
      this.currentAgent = streamResult.currentAgent ?? streamResult.lastAgent ?? this.currentAgent;
      this.lastAgentName = this.currentAgent.name;
      logger.info("llm run completed", {
        callId: this.id,
        turnId,
        agentBeforeRun,
        agentAfterRun: this.lastAgentName,
        handoffOccurred: agentBeforeRun !== this.lastAgentName,
        newItemsCount: streamResult.newItems.length,
      });

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
        logger.warn("no stream sentence emitted, using stream fallback reply", {
          callId: this.id,
          turnId,
          source: "empty_stream_fallback",
          agentAfterRun: this.lastAgentName,
          textPreview: textPreview(fallback),
        });
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
      logger.info("turn completed", {
        callId: this.id,
        turnId,
        responseAction,
        agent: this.lastAgentName,
        toolCalls,
        approvalGateState: this.callContext.approvalGateState,
        finalTextPreview: textPreview(finalText),
        ttftMs,
        llmTotalMs,
      });

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
      const streamSignalAborted = this.abortController?.signal.aborted ?? false;
      if (msg === "Aborted") {
        logger.info("turn aborted (caller hangup)", { callId: this.id });
        throw error;
      }

      traceLog.streamError(this.id, turnId, msg);
      logger.error("error processing user input (streaming)", {
        callId: this.id,
        turnId,
        error: msg,
        errorName: errorName(error),
        stackPreview: errorStackPreview(error),
        streamSignalAborted,
        historyLen: this.history.length,
        historyTail: summarizeHistoryTail(this.history),
        activeAgent: this.lastAgentName,
      });

      if (msg.includes("Model did not produce a final response")) {
        try {
          logger.warn("stream produced no final response, retrying in non-stream mode", {
            callId: this.id,
            turnId,
            activeAgent: this.lastAgentName,
            historyLen: this.history.length,
            streamSignalAborted,
            historyTail: summarizeHistoryTail(this.history),
          });

          const recoveryContext = new RunContext<CallContext>(this.callContext);
          const recovery = await runWithModelGuardrails({
            agent: this.currentAgent,
            input: this.history,
            runOptions: {
              context: recoveryContext,
              signal: this.abortController?.signal ?? undefined,
            },
            trustInputHistory: true,
          });

          const recoveredResult = recovery.result as RunResult<CallContext, Agent<CallContext, any>>;
          const recoveredText =
            (typeof recoveredResult.finalOutput === "string" ? recoveredResult.finalOutput.trim() : "") ||
            extractAssistantTextFromHistory(recoveredResult.history);

          if (recoveredText) {
            await this.emitSentenceWithOutputGuardrail(recoveredText, onSentence);

            this.history = recoveredResult.history;
            this.currentAgent = recoveredResult.lastAgent ?? this.currentAgent;
            this.lastAgentName = this.currentAgent.name;
            normalizeApprovalStateAfterTurn(this.callContext);

            this.latestIntent = inferIntentFromAgentName(this.lastAgentName);
            this.latestIntentConfidence = 0.72;
            this.latestSlots = { ...this.callContext.slotMemory };
            this.context.slots = {
              ...(this.context.slots as Record<string, unknown>),
              ...this.latestSlots,
            } as CallSessionContext["slots"];

            this.addTranscriptEntry({
              from: "agent",
              text: recoveredText,
              timestamp: new Date().toISOString(),
            });

            this.addLlmUsage(recoveryContext.usage.inputTokens, recoveryContext.usage.outputTokens);

            this.lastTurnDiagnostics = {
              intent: this.latestIntent,
              confidence: this.latestIntentConfidence || undefined,
              decisionMode: "recovery",
              pendingAction: this.callContext.pendingAction?.toolName ?? null,
              modelProfile: recovery.modelProfile,
              retryReason: "stream_no_final_response_recovered_non_stream",
              turnLatencyMs: Date.now() - turnStart,
              specialist: inferSpecialistFromAgentName(this.lastAgentName),
              history_len: this.history.length,
              active_agent: this.lastAgentName,
              tool_calls: [],
              approval_gate_state: this.callContext.approvalGateState,
              ttft_ms: 0,
              llm_total_ms: 0,
            };

            logger.info("non-stream recovery succeeded after stream finalization failure", {
              callId: this.id,
              turnId,
              activeAgent: this.lastAgentName,
              textPreview: textPreview(recoveredText),
            });

            await this.persistConversationState();
            return { type: "speak", text: recoveredText };
          }

          logger.warn("non-stream recovery returned no text output", {
            callId: this.id,
            turnId,
            activeAgent: this.lastAgentName,
          });
        } catch (recoveryError) {
          logger.error("non-stream recovery failed after stream finalization failure", {
            callId: this.id,
            turnId,
            error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
            errorName: errorName(recoveryError),
            stackPreview: errorStackPreview(recoveryError),
            historyLen: this.history.length,
            historyTail: summarizeHistoryTail(this.history),
          });
        }
      }

      const fallback = this.localFallbackForTurn(this.turnCount);
      await this.emitSentenceWithOutputGuardrail(fallback, onSentence);
      this.history = [...this.history, buildAssistantOutputItem(fallback)];
      logger.warn("session exception fallback emitted", {
        callId: this.id,
        turnId,
        source: "session_exception",
        agent: this.lastAgentName,
        error: msg,
        errorName: errorName(error),
        streamSignalAborted,
        fallbackTextPreview: textPreview(fallback),
        historyLen: this.history.length,
      });
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

  markRealtimeUserTurn(text: string, timestamp = new Date().toISOString()): void {
    this.turnCount++;
    this.addTranscriptEntry({
      from: "user",
      text: text.trim(),
      timestamp,
    });
  }

  markRealtimeAgentTurn(text: string, timestamp = new Date().toISOString()): void {
    this.addTranscriptEntry({
      from: "agent",
      text: text.trim(),
      timestamp,
    });
  }

  setRealtimeAgentState(agentName: string, slotMemory: Record<string, unknown>): void {
    this.lastAgentName = agentName;
    this.latestIntent = inferIntentFromAgentName(agentName);
    this.latestIntentConfidence = 0.76;
    this.latestSlots = { ...slotMemory };
    this.context.slots = {
      ...(this.context.slots as Record<string, unknown>),
      ...slotMemory,
    } as CallSessionContext["slots"];
  }

  setRealtimeTurnDiagnostics(diagnostics: TurnDiagnostics): void {
    this.lastTurnDiagnostics = diagnostics;
  }

  restoreRealtimeSnapshot(snapshot: {
    transcript: CallTranscriptEntry[];
    turnCount: number;
    latestIntent?: string;
    latestIntentConfidence?: number;
    latestSlots?: Record<string, unknown>;
    agentName?: string;
  }): void {
    this.context.transcript = snapshot.transcript;
    this.turnCount = snapshot.turnCount;
    this.latestIntent = snapshot.latestIntent;
    this.latestIntentConfidence = snapshot.latestIntentConfidence ?? 0;
    this.latestSlots = snapshot.latestSlots ?? {};
    if (snapshot.agentName) {
      this.lastAgentName = snapshot.agentName;
    }
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
