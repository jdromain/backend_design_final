import { createLogger } from "@rezovo/logging";
import {
  RealtimeSession,
  type RealtimeItem,
  type RealtimeSessionConfig,
} from "@openai/agents/realtime";
import type { RtpBridgeConnection } from "../../media/rtpBridgeClient";
import { env } from "../../env";
import type { CallSession, OnSentenceCallback } from "../callSession";
import { fetchKbPassages } from "../openai-agents";
import { guardrailsEngine, type GuardrailResult } from "../openai-agents/guardrails";
import { sessionStore } from "../openai-agents/sessionStore";
import {
  buildResponseInstructions,
  inferIntentFromAgentName,
  inferSpecialistFromAgentName,
  isStateChangingTool,
  normalizeApprovalStateAfterTurn,
  prepareApprovalStateForUserTurn,
  type ApprovalGateState,
  type CallContext,
} from "../openai-agents/agents";
import { isShortLeadIn, sanitizeTransferNarration } from "../../voice/formatting";
import { VOICE_SAFER_REPHRASE } from "../../voice/callerPhrases";
import {
  pickFirstSilencePrompt,
  pickSecondSilencePrompt,
  SILENCE_FINAL_FAREWELL,
} from "../../voice/silencePrompts";
import type { TurnDiagnostics } from "../openai-agents";
import {
  buildRealtimeSessionConfig,
  validateRealtimeSessionConfig,
} from "./configValidator";
import { getRealtimeAgentByName, getStartingRealtimeAgent } from "./realtimeAgents";
import { extractSentenceChunks } from "./sentenceChunker";

const logger = createLogger({ service: "realtime-core", module: "realtimeConversation" });

const KB_FETCH_TIMEOUT_MS = Math.max(100, env.REALTIME_KB_FETCH_TIMEOUT_MS);
const PERSIST_THROTTLE_MS = Math.max(50, env.REALTIME_PERSIST_THROTTLE_MS);
const EMPTY_RESPONSE_GRACE_MS = Math.max(200, env.REALTIME_EMPTY_RESPONSE_GRACE_MS);
const MIN_CHUNK_CHARS = Math.max(8, env.REALTIME_TTS_MIN_CHUNK_CHARS);
const MAX_CHUNK_CHARS = Math.max(MIN_CHUNK_CHARS + 8, env.REALTIME_TTS_MAX_CHUNK_CHARS);
const MAX_CHUNK_WAIT_MS = Math.max(80, env.REALTIME_TTS_MAX_CHUNK_WAIT_MS);

export type ConversationStopReason =
  | "bridge_closed"
  | "signal_abort"
  | "timeout"
  | "end"
  | "error";

type TurnRuntimeMetrics = {
  turnSeq: number;
  responseCreateSeq: number;
  turnKey: string;
  turnState: "transcript_received" | "response_requested" | "streaming" | "finalized";
  userText: string;
  ingressStartedAt: number | null;
  transcriptAt: number;
  responseRequestedAt: number | null;
  responseCreatedAt: number | null;
  firstTextDeltaAt: number | null;
  firstTtsAt: number | null;
  responseDoneAt: number | null;
  finalizedAt: number | null;
  emptyPassCount: number;
  chunksDispatched: number;
  queueWaitSamples: number[];
  finalizedResponseId: string | null;
  duplicateFinalizeCount: number;
  ragFallbackUsed: boolean;
};

type ResponseRuntimeState = {
  textBuffer: string;
  fullText: string;
  metrics: TurnRuntimeMetrics;
  turnKey: string;
  pendingLeadIn: string | null;
  assembledChunkBuffer: string;
  assembledChunkTimer: NodeJS.Timeout | null;
};

type RunRealtimeConversationOptions = {
  session: CallSession;
  bridgeConnection: RtpBridgeConnection | null;
  onSentence: OnSentenceCallback;
  signal?: AbortSignal;
  initialUtterance?: string;
  maxCallDurationMs: number;
  onTurnDiagnostics?: (diagnostics: TurnDiagnostics) => void;
  onCallerAudioBytes?: (bytes: number) => void;
  /** Fires after barge-in (user spoke while assistant was responding). Bump TTS generation to drop stale audio. */
  onBargeIn?: () => void;
  /** When input guardrails block, play this via external TTS instead of `response.create`. */
  onInputBlocked?: (message: string) => void | Promise<void>;
};

function formatOpeningHours(openingHours: CallSession["context"]["agentConfig"]["openingHours"]): string {
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

function toArrayBuffer(data: Buffer): ArrayBuffer {
  const view = new Uint8Array(data.byteLength);
  view.set(data);
  return view.buffer;
}

function eventResponseId(event: Record<string, unknown>): string | null {
  const direct = event.response_id;
  if (typeof direct === "string" && direct.length > 0) return direct;

  const response = event.response;
  if (response && typeof response === "object") {
    const id = (response as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) return id;
  }

  return null;
}

function pickResponseAction(utterance: string, text: string): "speak" | "end" {
  const loweredText = text.toLowerCase();
  const loweredUtterance = utterance.toLowerCase();

  if (
    /\b(bye|goodbye|take care|have a great day)\b/.test(loweredText) &&
    /\b(bye|goodbye|that'?s all|thank you|thanks|done)\b/.test(loweredUtterance)
  ) {
    return "end";
  }

  return "speak";
}

type RouteHint = "booking" | "cancellation" | "complaint" | "info" | null;

function inferRouteHint(utterance: string): RouteHint {
  const text = utterance.toLowerCase();

  if (/\b(cancel|cancellation|resched|reschedule|move my appointment|change my reservation)\b/.test(text)) {
    return "cancellation";
  }
  if (/\b(complaint|manager|supervisor|frustrat|angry|upset|bad service|terrible)\b/.test(text)) {
    return "complaint";
  }
  if (/\b(book|booking|appointment|reserve|reservation|schedule)\b/.test(text)) {
    return "booking";
  }
  if (
    /\b(hours|open|close|location|address|price|pricing|menu|services?|vibe|atmosphere|establishment|about|tell me more|information)\b/.test(
      text,
    )
  ) {
    return "info";
  }

  return null;
}

function routeHintToAgentName(hint: RouteHint): string | null {
  switch (hint) {
    case "booking":
      return "Booking Specialist";
    case "cancellation":
      return "Cancellation Specialist";
    case "complaint":
      return "Customer Care Specialist";
    case "info":
      return "Information Specialist";
    default:
      return null;
  }
}

function determineDecisionMode(
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

function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function hashPercent(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash % 100;
}


function fastLocalChunkGuardrail(text: string): string {
  const suspiciousPiiPatterns = [
    /\b\d{3}-\d{2}-\d{4}\b/,
    /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,
  ];
  for (const pattern of suspiciousPiiPatterns) {
    if (pattern.test(text)) return VOICE_SAFER_REPHRASE;
  }
  return text;
}

async function applyOutputGuardrail(
  callId: string,
  responseId: string,
  text: string,
  fullTextForModeration: string,
  moderationCache: Map<string, Promise<{ blocked: boolean; message?: string }>>,
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return "";

  const localChecked = fastLocalChunkGuardrail(trimmed);

  if (env.NODE_ENV === "development") {
    return localChecked;
  }

  const cached =
    moderationCache.get(responseId) ??
    Promise.race([
      guardrailsEngine
        .checkOutput(fullTextForModeration.trim().slice(0, 2000), callId)
        .then((result) => ({ blocked: result.blocked, message: result.message })),
      new Promise<{ blocked: boolean; message?: string }>((resolve) =>
        setTimeout(() => resolve({ blocked: false }), Math.max(50, env.REALTIME_OUTPUT_MODERATION_TIMEOUT_MS)),
      ),
    ]).catch(() => ({ blocked: false }));
  moderationCache.set(responseId, cached);

  const outputCheck = await cached;
  if (!outputCheck.blocked) {
    return localChecked;
  }

  return outputCheck.message || VOICE_SAFER_REPHRASE;
}

export async function runRealtimeConversation({
  session,
  bridgeConnection,
  onSentence,
  signal,
  initialUtterance,
  maxCallDurationMs,
  onTurnDiagnostics,
  onCallerAudioBytes,
  onBargeIn,
  onInputBlocked,
}: RunRealtimeConversationOptions): Promise<ConversationStopReason> {
  const { agentConfig } = session.context;
  const kbNamespace = agentConfig.kbNamespace;
  const inCanary =
    env.REALTIME_CANARY_PERCENT >= 100
      ? true
      : hashPercent(session.id) < Math.max(0, Math.min(100, env.REALTIME_CANARY_PERCENT));
  const enableLifecycleFix = env.REALTIME_LIFECYCLE_FIX_ENABLED && inCanary;
  const enableChunkQueueV2 = env.REALTIME_CHUNK_QUEUE_V2_ENABLED && inCanary;
  const enableBargeClearPacing = env.REALTIME_BARGE_CLEAR_PACING_ENABLED && inCanary;
  const enableRagReliability = env.REALTIME_RAG_RELIABILITY_ENABLED && inCanary;
  logger.info("realtime rollout flags", {
    callId: session.id,
    inCanary,
    canaryPercent: env.REALTIME_CANARY_PERCENT,
    enableLifecycleFix,
    enableChunkQueueV2,
    enableBargeClearPacing,
    enableRagReliability,
  });

  const callContext: CallContext = {
    orgId: session.context.orgId,
    businessId: session.context.businessId,
    callId: session.id,
    currentDateTime: new Date().toISOString(),
    agentBasePrompt: agentConfig.basePrompt,
    calendlyAccessToken: agentConfig.calendly?.accessToken,
    calendlyEventTypeUri: agentConfig.calendly?.eventTypeUri,
    calendlyTimezone: agentConfig.calendly?.timezone,
    restaurantId: agentConfig.opentable?.restaurantId,
    kbPassages: [],
    kbHealth: {
      status: "unknown",
      totalQueries: 0,
      hitQueries: 0,
      zeroHitStreak: 0,
    },
    lastNamespaceUsed: kbNamespace,
    openingHours: formatOpeningHours(agentConfig.openingHours),
    slotMemory: {},
    pendingAction: null,
    approvedActionHash: null,
    approvalGateState: "none",
  };

  let currentRealtimeAgent = getStartingRealtimeAgent();
  const restored = await sessionStore.getRealtimeConversationState(session.id);
  if (restored) {
    callContext.slotMemory = restored.context.slotMemory;
    callContext.pendingAction = restored.context.pendingAction;
    callContext.approvedActionHash = restored.context.approvedActionHash;
    callContext.approvalGateState = restored.context.approvalGateState;
    callContext.currentDateTime = restored.context.currentDateTime;
    callContext.kbPassages = restored.context.kbPassages;
    callContext.kbHealth = restored.context.kbHealth;
    callContext.lastNamespaceUsed = restored.context.lastNamespaceUsed;

    session.restoreRealtimeSnapshot({
      transcript: restored.transcript,
      turnCount: restored.turnCount,
      latestIntent: restored.latestIntent,
      latestIntentConfidence: restored.latestIntentConfidence,
      latestSlots: restored.latestSlots,
      agentName: restored.currentAgentName,
    });

    currentRealtimeAgent = getRealtimeAgentByName(restored.currentAgentName) ?? currentRealtimeAgent;

    logger.info("realtime conversation state restored", {
      callId: session.id,
      turnCount: restored.turnCount,
      transcriptLines: restored.transcript.length,
      activeAgent: currentRealtimeAgent.name,
      historyLen: restored.realtimeHistory.length,
    });
  }

  const runtimeConfig = buildRealtimeSessionConfig();
  const validation = validateRealtimeSessionConfig(runtimeConfig as Partial<RealtimeSessionConfig>);
  if (!validation.valid) {
    throw new Error(`invalid realtime session config: ${validation.errors.join("; ")}`);
  }

  const realtimeSession = new RealtimeSession<CallContext>(currentRealtimeAgent, {
    transport: "websocket",
    model: env.LLM_MODEL,
    context: callContext,
    config: runtimeConfig,
    historyStoreAudio: false,
  });

  await realtimeSession.connect({
    apiKey: env.OPENAI_API_KEY,
    model: env.LLM_MODEL,
  });

  if (restored?.realtimeHistory && restored.realtimeHistory.length > 0) {
    realtimeSession.updateHistory(restored.realtimeHistory as RealtimeItem[]);
    await realtimeSession.updateAgent(currentRealtimeAgent);
  }

  let stopReason: ConversationStopReason = "bridge_closed";
  let stopped = false;
  let stopResolver: ((reason: ConversationStopReason) => void) | null = null;

  const stopPromise = new Promise<ConversationStopReason>((resolve) => {
    stopResolver = resolve;
  });

  let silenceLadderTimer: ReturnType<typeof setInterval> | null = null;

  const stop = (reason: ConversationStopReason): void => {
    if (stopped) return;
    stopped = true;
    stopReason = reason;
    if (silenceLadderTimer) {
      clearInterval(silenceLadderTimer);
      silenceLadderTimer = null;
    }
    if (stopResolver) {
      stopResolver(reason);
    }
  };

  const SILENCE_L1_MS = 6_000;
  const SILENCE_L2_MS = 16_000;
  const SILENCE_L3_MS = 24_000;
  const SILENCE_END_MS = 32_000;

  let lastUserActivityAt = Date.now();
  let sentSilence1 = false;
  let sentSilence2 = false;
  let sentSilence3 = false;
  silenceLadderTimer = setInterval(() => {
    if (stopped) return;
    const idle = Date.now() - lastUserActivityAt;
    if (idle >= SILENCE_END_MS) {
      stop("timeout");
      return;
    }
    if (idle >= SILENCE_L3_MS && !sentSilence3 && sentSilence2) {
      sentSilence3 = true;
      try {
        const instr = buildResponseInstructions(callContext, realtimeSession.currentAgent.name);
        const line = SILENCE_FINAL_FAREWELL;
        realtimeSession.transport.sendEvent({
          type: "response.create",
          response: {
            instructions: `${instr} The caller is still on the line but quiet. In one short sentence, say exactly: ${line}`,
          },
        });
      } catch {
        /* ignore */
      }
      return;
    }
    if (idle >= SILENCE_L2_MS && !sentSilence2 && sentSilence1) {
      sentSilence2 = true;
      try {
        const instr = buildResponseInstructions(callContext, realtimeSession.currentAgent.name);
        const line = pickSecondSilencePrompt(session.id);
        realtimeSession.transport.sendEvent({
          type: "response.create",
          response: {
            instructions: `${instr} The caller is still quiet. In one very short, warm sentence, say exactly: ${line}`,
          },
        });
      } catch {
        /* ignore */
      }
      return;
    }
    if (idle >= SILENCE_L1_MS && !sentSilence1) {
      sentSilence1 = true;
      try {
        const instr = buildResponseInstructions(callContext, realtimeSession.currentAgent.name);
        const line = pickFirstSilencePrompt(session.id);
        realtimeSession.transport.sendEvent({
          type: "response.create",
          response: {
            instructions: `${instr} The caller has gone quiet. In one very short, warm sentence, say exactly: ${line}`,
          },
        });
      } catch {
        /* ignore */
      }
    }
  }, 1_000);

  let persistTimer: NodeJS.Timeout | null = null;
  const persistNow = async (): Promise<void> => {
    await sessionStore.saveRealtimeConversationState(session.id, {
      callId: session.id,
      realtimeHistory: realtimeSession.history,
      currentAgentName: realtimeSession.currentAgent.name,
      context: {
        slotMemory: callContext.slotMemory,
        pendingAction: callContext.pendingAction,
        approvedActionHash: callContext.approvedActionHash,
        approvalGateState: callContext.approvalGateState,
        currentDateTime: callContext.currentDateTime,
        kbPassages: callContext.kbPassages,
        kbHealth: callContext.kbHealth,
        lastNamespaceUsed: callContext.lastNamespaceUsed,
      },
      transcript: session.getTranscript(),
      turnCount: session.getTurnCount(),
      latestIntent: inferIntentFromAgentName(realtimeSession.currentAgent.name),
      latestIntentConfidence: 0.76,
      latestSlots: callContext.slotMemory,
      emptyPassCountByCall,
    });
  };

  const schedulePersist = (): void => {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      void persistNow().catch((error) => {
        logger.warn("realtime conversation state persistence failed", {
          callId: session.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, PERSIST_THROTTLE_MS);
  };

  const responseStates = new Map<string, ResponseRuntimeState>();
  const toolCallsByTurn = new Map<string, Set<string>>();
  const responseTextTail = new Map<string, string>();
  const toolStartedAt = new Map<string, number>();
  const finalizedTurnKeys = new Set<string>();
  const emptyFinalizeTimers = new Map<string, NodeJS.Timeout>();
  const responseModerationCache = new Map<string, Promise<{ blocked: boolean; message?: string }>>();

  let pendingTurnMetrics: TurnRuntimeMetrics | null = null;
  let currentIngressStartedAt: number | null = null;
  let lastUserText = "";
  let responseCreateSeq = 0;
  let activeTurnKey: string | null = null;
  let emptyPassCountByCall = restored?.emptyPassCountByCall ?? 0;
  let duplicateFinalizeCountByCall = 0;
  let bargeInClearCount = 0;
  /** Throttle VAD / early barge to avoid flapping. */
  let lastEarlyBargeAt = 0;
  let totalChunksDispatched = 0;
  const queueWaitSamplesByCall: number[] = [];
  let ragTotalQueries = 0;
  let ragHitQueries = 0;
  let ragFallbackCount = 0;

  let queueGeneration = 0;
  const chunkQueue: Array<{
    text: string;
    responseId: string;
    turnKey: string;
    generation: number;
    metrics: TurnRuntimeMetrics;
    enqueuedAt: number;
  }> = [];
  let queueBusy = false;

  const clearChunkQueue = (): number => {
    const existing = chunkQueue.length;
    queueGeneration++;
    chunkQueue.length = 0;
    return existing;
  };

  const pumpChunkQueue = async (): Promise<void> => {
    if (queueBusy) return;
    queueBusy = true;

    try {
      while (chunkQueue.length > 0 && !stopped) {
        const next = chunkQueue.shift();
        if (!next) continue;
        if (next.generation !== queueGeneration) continue;
        if (finalizedTurnKeys.has(next.turnKey)) continue;

        const guardrailStartedAt = Date.now();
        if (next.metrics.finalizedResponseId) continue;
        const safe = await applyOutputGuardrail(
          session.id,
          next.responseId,
          sanitizeTransferNarration(next.text),
          next.text,
          responseModerationCache,
        );
        const guardrailMs = Date.now() - guardrailStartedAt;
        if (!safe) continue;

        const isFirstTtsThisTurn = next.metrics.chunksDispatched === 0;
        if (next.metrics.firstTtsAt === null) {
          next.metrics.firstTtsAt = Date.now();
        }

        const dispatchStartedAt = Date.now();
        const queueWaitMs = dispatchStartedAt - next.enqueuedAt;
        next.metrics.queueWaitSamples.push(queueWaitMs);
        queueWaitSamplesByCall.push(queueWaitMs);
        try {
          await onSentence(safe);
          next.metrics.chunksDispatched += 1;
          totalChunksDispatched += 1;
          if (isFirstTtsThisTurn) {
            logger.info("voice tuning eagerness", {
              tag: "voice-tuning",
              callId: session.id,
              path: "realtime",
              turnKey: next.turnKey,
              end_of_user_speech_to_first_tts_synthesis_start_ms: next.metrics.firstTtsAt! - next.metrics.transcriptAt,
            });
          }
          logger.info("realtime sentence dispatched", {
            callId: session.id,
            responseId: next.responseId,
            turnSeq: next.metrics.turnSeq,
            responseCreateSeq: next.metrics.responseCreateSeq,
            queueWaitMs,
            guardrailMs,
            dispatchMs: Date.now() - dispatchStartedAt,
            textLen: safe.length,
            queueDepthAfterDispatch: chunkQueue.length,
          });
        } catch (error) {
          logger.warn("tts sentence dispatch failed", {
            callId: session.id,
            responseId: next.responseId,
            turnSeq: next.metrics.turnSeq,
            responseCreateSeq: next.metrics.responseCreateSeq,
            guardrailMs,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } finally {
      queueBusy = false;
    }
  };

  const enqueueChunk = (
    text: string,
    responseId: string,
    turnKey: string,
    metrics: TurnRuntimeMetrics,
  ): void => {
    chunkQueue.push({
      text,
      responseId,
      turnKey,
      generation: queueGeneration,
      metrics,
      enqueuedAt: Date.now(),
    });
    void pumpChunkQueue();
  };

  let previousInputTokens = 0;
  let previousOutputTokens = 0;

  const recordUsageDelta = (): void => {
    const usageRecord = realtimeSession.usage as unknown as {
      inputTokens?: number;
      outputTokens?: number;
    };

    const inputTokens = usageRecord.inputTokens ?? 0;
    const outputTokens = usageRecord.outputTokens ?? 0;

    const inputDelta = Math.max(0, inputTokens - previousInputTokens);
    const outputDelta = Math.max(0, outputTokens - previousOutputTokens);

    previousInputTokens = inputTokens;
    previousOutputTokens = outputTokens;

    if (inputDelta > 0 || outputDelta > 0) {
      session.addLlmUsage(inputDelta, outputDelta);
    }
  };

  const scheduleAssembledFlush = (state: ResponseRuntimeState, responseId: string): void => {
    if (state.assembledChunkTimer) return;
    state.assembledChunkTimer = setTimeout(() => {
      state.assembledChunkTimer = null;
      const text = state.assembledChunkBuffer.trim();
      if (!text) return;
      enqueueChunk(text, responseId, state.turnKey, state.metrics);
      state.assembledChunkBuffer = "";
    }, MAX_CHUNK_WAIT_MS);
  };

  const flushAssembledChunk = (
    state: ResponseRuntimeState,
    responseId: string,
    force: boolean,
  ): void => {
    if (state.assembledChunkTimer) {
      clearTimeout(state.assembledChunkTimer);
      state.assembledChunkTimer = null;
    }

    if (!state.assembledChunkBuffer.trim() && state.pendingLeadIn) {
      state.assembledChunkBuffer = state.pendingLeadIn;
      state.pendingLeadIn = null;
    }

    let working = state.assembledChunkBuffer.trim();
    if (!working) return;

    while (working.length > MAX_CHUNK_CHARS) {
      const splitAtSpace = working.lastIndexOf(" ", MAX_CHUNK_CHARS);
      const splitIdx = splitAtSpace > Math.floor(MAX_CHUNK_CHARS * 0.6) ? splitAtSpace : MAX_CHUNK_CHARS;
      const head = working.slice(0, splitIdx).trim();
      if (head) {
        enqueueChunk(head, responseId, state.turnKey, state.metrics);
      }
      working = working.slice(splitIdx).trim();
    }

    if (working.length >= MIN_CHUNK_CHARS || force) {
      enqueueChunk(working, responseId, state.turnKey, state.metrics);
      state.assembledChunkBuffer = "";
      return;
    }

    state.assembledChunkBuffer = working;
    scheduleAssembledFlush(state, responseId);
  };

  const pushSentenceIntoAssembler = (
    state: ResponseRuntimeState,
    responseId: string,
    sentence: string,
  ): void => {
    if (!enableChunkQueueV2) {
      const passthrough = sanitizeTransferNarration(sentence.trim());
      if (passthrough) {
        enqueueChunk(passthrough, responseId, state.turnKey, state.metrics);
      }
      return;
    }

    let nextSentence = sanitizeTransferNarration(sentence.trim());
    if (!nextSentence) return;

    if (!state.assembledChunkBuffer.trim() && isShortLeadIn(nextSentence)) {
      if (state.pendingLeadIn) {
        nextSentence = `${state.pendingLeadIn} ${nextSentence}`;
        state.pendingLeadIn = null;
      } else {
        state.pendingLeadIn = nextSentence;
        return;
      }
    }

    if (state.pendingLeadIn) {
      nextSentence = `${state.pendingLeadIn} ${nextSentence}`;
      state.pendingLeadIn = null;
    }

    if (state.assembledChunkBuffer.trim().length > 0) {
      state.assembledChunkBuffer = `${state.assembledChunkBuffer.trim()} ${nextSentence}`;
    } else {
      state.assembledChunkBuffer = nextSentence;
    }

    if (state.assembledChunkBuffer.length >= MAX_CHUNK_CHARS) {
      flushAssembledChunk(state, responseId, false);
      return;
    }

    if (state.assembledChunkBuffer.length >= MIN_CHUNK_CHARS && /[.!?]$/.test(nextSentence)) {
      flushAssembledChunk(state, responseId, false);
      return;
    }

    scheduleAssembledFlush(state, responseId);
  };

  const clearEmptyFinalizeTimer = (turnKey: string): void => {
    const timer = emptyFinalizeTimers.get(turnKey);
    if (timer) {
      clearTimeout(timer);
      emptyFinalizeTimers.delete(turnKey);
    }
  };

  const completeTurn = async (
    state: ResponseRuntimeState,
    responseId: string,
    finalText: string,
    finalizedByEmptyTimeout: boolean,
  ): Promise<void> => {
    const turnKey = state.turnKey;
    const metrics = state.metrics;

    if (finalizedTurnKeys.has(turnKey)) {
      metrics.duplicateFinalizeCount += 1;
      duplicateFinalizeCountByCall += 1;
      return;
    }

    finalizedTurnKeys.add(turnKey);
    clearEmptyFinalizeTimer(turnKey);

    metrics.finalizedResponseId = responseId;
    metrics.finalizedAt = Date.now();
    metrics.turnState = "finalized";
    metrics.responseDoneAt = metrics.responseDoneAt ?? metrics.finalizedAt;

    if (finalText.length > 0) {
      session.markRealtimeAgentTurn(finalText);
    }

    normalizeApprovalStateAfterTurn(callContext);
    session.setRealtimeAgentState(realtimeSession.currentAgent.name, callContext.slotMemory);

    const ttft =
      metrics.firstTextDeltaAt === null ? 0 : metrics.firstTextDeltaAt - metrics.transcriptAt;
    const firstTextDeltaToFirstTts =
      metrics.firstTextDeltaAt !== null && metrics.firstTtsAt !== null
        ? metrics.firstTtsAt - metrics.firstTextDeltaAt
        : undefined;
    const toolCalls = Array.from(toolCallsByTurn.get(turnKey) ?? []);

    const queueWaitP95 = percentile(metrics.queueWaitSamples, 95);
    const timelineBase = metrics.ingressStartedAt ?? metrics.transcriptAt;
    const diagnostics: TurnDiagnostics = {
      intent: inferIntentFromAgentName(realtimeSession.currentAgent.name),
      confidence: toolCalls.length > 0 ? 0.88 : 0.74,
      decisionMode: determineDecisionMode(toolCalls, callContext.approvalGateState),
      pendingAction: callContext.pendingAction?.toolName ?? null,
      modelProfile: env.LLM_MODEL,
      turnLatencyMs:
        metrics.responseDoneAt !== null && metrics.ingressStartedAt !== null
          ? metrics.responseDoneAt - metrics.ingressStartedAt
          : metrics.responseDoneAt !== null
            ? metrics.responseDoneAt - metrics.transcriptAt
            : 0,
      specialist: inferSpecialistFromAgentName(realtimeSession.currentAgent.name),
      history_len: realtimeSession.history.length,
      active_agent: realtimeSession.currentAgent.name,
      tool_calls: toolCalls,
      approval_gate_state: callContext.approvalGateState,
      ttft_ms: ttft,
      llm_total_ms: metrics.responseDoneAt !== null ? metrics.responseDoneAt - metrics.transcriptAt : 0,
      ingress_to_transcript_ms:
        metrics.ingressStartedAt === null ? undefined : metrics.transcriptAt - metrics.ingressStartedAt,
      transcript_to_first_text_delta_ms:
        metrics.firstTextDeltaAt === null ? undefined : metrics.firstTextDeltaAt - metrics.transcriptAt,
      first_text_delta_to_first_tts_ms: firstTextDeltaToFirstTts,
      turn_total_ms:
        metrics.responseDoneAt !== null && metrics.ingressStartedAt !== null
          ? metrics.responseDoneAt - metrics.ingressStartedAt
          : undefined,
      empty_passes: metrics.emptyPassCount,
      chunks_synthesized: metrics.chunksDispatched,
      queue_wait_p95_ms: queueWaitP95,
      rag_fallback_used: metrics.ragFallbackUsed,
      timeline_ms: {
        transcript: Math.max(0, metrics.transcriptAt - timelineBase),
        response_requested:
          metrics.responseRequestedAt === null ? undefined : Math.max(0, metrics.responseRequestedAt - timelineBase),
        first_text_delta:
          metrics.firstTextDeltaAt === null ? undefined : Math.max(0, metrics.firstTextDeltaAt - timelineBase),
        first_tts: metrics.firstTtsAt === null ? undefined : Math.max(0, metrics.firstTtsAt - timelineBase),
        finalized: metrics.finalizedAt === null ? undefined : Math.max(0, metrics.finalizedAt - timelineBase),
      },
    };

    session.setRealtimeTurnDiagnostics(diagnostics);
    onTurnDiagnostics?.(diagnostics);

    logger.info("realtime turn finalized", {
      callId: session.id,
      responseId,
      turnSeq: metrics.turnSeq,
      responseCreateSeq: metrics.responseCreateSeq,
      turnState: metrics.turnState,
      activeAgent: realtimeSession.currentAgent.name,
      outputLen: finalText.length,
      toolCalls,
      approvalGateState: callContext.approvalGateState,
      finalizedByEmptyTimeout,
      emptyPasses: metrics.emptyPassCount,
      chunksSynthesized: metrics.chunksDispatched,
      queueWaitP95Ms: diagnostics.queue_wait_p95_ms,
      ingressToTranscriptMs: diagnostics.ingress_to_transcript_ms,
      transcriptToFirstTextDeltaMs: diagnostics.transcript_to_first_text_delta_ms,
      firstTextDeltaToFirstTtsMs: diagnostics.first_text_delta_to_first_tts_ms,
      llmTotalMs: diagnostics.llm_total_ms,
      turnTotalMs: diagnostics.turn_total_ms,
    });

    recordUsageDelta();
    await persistNow();

    if (finalText.length > 0) {
      const action = pickResponseAction(lastUserText, finalText);
      if (action === "end") {
        stop("end");
      }
    }

    toolCallsByTurn.delete(turnKey);
    if (activeTurnKey === turnKey) {
      activeTurnKey = null;
    }

    for (const [id, rs] of responseStates.entries()) {
      if (rs.turnKey === turnKey) {
        if (rs.assembledChunkTimer) clearTimeout(rs.assembledChunkTimer);
        responseStates.delete(id);
        responseTextTail.delete(id);
        responseModerationCache.delete(id);
      }
    }
  };

  const finalizeTurn = async (responseId: string): Promise<void> => {
    const state = responseStates.get(responseId);
    if (!state) return;

    const trailing = responseTextTail.get(responseId);
    if (trailing && trailing.trim().length > 0) {
      pushSentenceIntoAssembler(state, responseId, trailing.trim());
      state.fullText += trailing;
      responseTextTail.delete(responseId);
    }
    flushAssembledChunk(state, responseId, true);

    state.metrics.responseDoneAt = Date.now();
    const finalText = sanitizeTransferNarration(state.fullText.trim());
    const turnKey = state.turnKey;

    if (enableLifecycleFix && finalText.length === 0) {
      state.metrics.emptyPassCount += 1;
      emptyPassCountByCall += 1;
      logger.info("realtime empty response pass", {
        callId: session.id,
        responseId,
        turnSeq: state.metrics.turnSeq,
        responseCreateSeq: state.metrics.responseCreateSeq,
        turnKey,
        emptyPasses: state.metrics.emptyPassCount,
      });

      responseStates.delete(responseId);
      responseTextTail.delete(responseId);
      responseModerationCache.delete(responseId);

      if (!emptyFinalizeTimers.has(turnKey)) {
        const timer = setTimeout(() => {
          emptyFinalizeTimers.delete(turnKey);
          if (finalizedTurnKeys.has(turnKey) || stopped) return;
          void completeTurn(state, responseId, "", true).catch((error) => {
            logger.warn("empty-pass finalization failed", {
              callId: session.id,
              turnKey,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }, EMPTY_RESPONSE_GRACE_MS);
        emptyFinalizeTimers.set(turnKey, timer);
      }

      return;
    }

    await completeTurn(state, responseId, finalText, false);
  };

  const maybeRefreshKb = async (
    utterance: string,
  ): Promise<{
    skipped: boolean;
    timedOut: boolean;
    durationMs: number;
    passageCount: number;
    namespaceUsed: string | null;
    fallbackUsed: boolean;
    matchCount: number;
  }> => {
    if (!kbNamespace || utterance.trim().length < 3) {
      return {
        skipped: true,
        timedOut: false,
        durationMs: 0,
        passageCount: callContext.kbPassages.length,
        namespaceUsed: callContext.lastNamespaceUsed ?? kbNamespace ?? null,
        fallbackUsed: false,
        matchCount: callContext.kbPassages.length,
      };
    }

    const startedAt = Date.now();
    const timeoutResult = { timeout: true } as const;
    const runRetrieve = async (namespace: string): Promise<string[] | typeof timeoutResult> => {
      const ac = new AbortController();
      let timer: NodeJS.Timeout | null = null;
      try {
        ragTotalQueries += 1;
        const outcome = await Promise.race<string[] | typeof timeoutResult>([
          fetchKbPassages(
            session.id,
            utterance,
            session.context.orgId,
            session.context.businessId,
            namespace,
            ac.signal,
          ).catch(() => [] as string[]),
          new Promise<typeof timeoutResult>((resolve) => {
            timer = setTimeout(() => {
              ac.abort();
              resolve(timeoutResult);
            }, env.VOICE_KB_RACE_MS);
          }),
        ]);
        return outcome;
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    const primaryNamespace = kbNamespace;
    let namespaceUsed = primaryNamespace;
    let fallbackUsed = false;
    let timedOut = false;
    let passages: string[] = [];

    const primary = await runRetrieve(primaryNamespace);
    if ("timeout" in primary) {
      timedOut = true;
    } else {
      passages = primary;
    }

    if (
      enableRagReliability &&
      !timedOut &&
      passages.length === 0 &&
      primaryNamespace !== "general"
    ) {
      const fallback = await runRetrieve("general");
      fallbackUsed = true;
      ragFallbackCount += 1;
      namespaceUsed = "general";
      if ("timeout" in fallback) {
        timedOut = true;
      } else {
        passages = fallback;
      }
    }

    if (passages.length > 0) {
      callContext.kbPassages = passages;
      ragHitQueries += 1;
    }

    const nowIso = new Date().toISOString();
    const prevHealth = callContext.kbHealth ?? {
      status: "unknown" as const,
      totalQueries: 0,
      hitQueries: 0,
      zeroHitStreak: 0,
    };
    const hit = passages.length > 0;
    const totalQueries = prevHealth.totalQueries + 1;
    const hitQueries = prevHealth.hitQueries + (hit ? 1 : 0);
    const zeroHitStreak = hit ? 0 : prevHealth.zeroHitStreak + 1;
    callContext.kbHealth = {
      status: hit ? "healthy" : zeroHitStreak >= 2 ? "degraded" : "unknown",
      totalQueries,
      hitQueries,
      zeroHitStreak,
      lastCheckedAt: nowIso,
      lastHitAt: hit ? nowIso : prevHealth.lastHitAt,
      lastNamespaceUsed: namespaceUsed,
      lastMatchCount: passages.length,
    };
    callContext.lastNamespaceUsed = namespaceUsed;

    return {
      skipped: false,
      timedOut,
      durationMs: Date.now() - startedAt,
      passageCount: callContext.kbPassages.length,
      namespaceUsed,
      fallbackUsed,
      matchCount: passages.length,
    };
  };

  if (enableRagReliability && kbNamespace) {
    const startupProbe = await maybeRefreshKb("hours location menu services");
    logger.info("realtime kb health startup probe", {
      callId: session.id,
      namespace: kbNamespace,
      timedOut: startupProbe.timedOut,
      durationMs: startupProbe.durationMs,
      matchCount: startupProbe.matchCount,
      fallbackUsed: startupProbe.fallbackUsed,
      namespaceUsed: startupProbe.namespaceUsed,
      kbHealthStatus: callContext.kbHealth?.status ?? "unknown",
    });
  }

  const createTurnMetrics = (
    turnSeq: number,
    responseCreateSeqValue: number,
    userText: string,
    ingressStartedAt: number | null,
    transcriptAt: number,
  ): TurnRuntimeMetrics => ({
    turnSeq,
    responseCreateSeq: responseCreateSeqValue,
    turnKey: `${turnSeq}:${responseCreateSeqValue}`,
    turnState: "transcript_received",
    userText,
    ingressStartedAt,
    transcriptAt,
    responseRequestedAt: null,
    responseCreatedAt: null,
    firstTextDeltaAt: null,
    firstTtsAt: null,
    responseDoneAt: null,
    finalizedAt: null,
    emptyPassCount: 0,
    chunksDispatched: 0,
    queueWaitSamples: [],
    finalizedResponseId: null,
    duplicateFinalizeCount: 0,
    ragFallbackUsed: false,
  });

  let transcriptQueue = Promise.resolve();

  realtimeSession.on("agent_start", (_context, agent) => {
    logger.info("realtime agent turn started", {
      callId: session.id,
      agent: agent.name,
    });
  });

  realtimeSession.on("agent_end", (_context, agent, output) => {
    logger.info("realtime agent turn completed", {
      callId: session.id,
      agent: agent.name,
      outputPreview: output.slice(0, 220),
    });
  });

  realtimeSession.on("agent_handoff", (_context, fromAgent, toAgent) => {
    session.setRealtimeAgentState(toAgent.name, callContext.slotMemory);
    if (fromAgent.name === toAgent.name) {
      logger.debug("realtime agent refresh", {
        callId: session.id,
        agent: toAgent.name,
      });
    } else {
      logger.info("realtime agent handoff", {
        callId: session.id,
        from: fromAgent.name,
        to: toAgent.name,
      });
    }
    schedulePersist();
  });

  realtimeSession.on("agent_tool_start", (_context, agent, tool) => {
    if (activeTurnKey) {
      const set = toolCallsByTurn.get(activeTurnKey) ?? new Set<string>();
      set.add(tool.name);
      toolCallsByTurn.set(activeTurnKey, set);
    }
    toolStartedAt.set(`${agent.name}:${tool.name}`, Date.now());
    logger.info("realtime tool start", {
      callId: session.id,
      agent: agent.name,
      tool: tool.name,
      approvalGateState: callContext.approvalGateState,
      activeTurnKey,
    });
  });

  realtimeSession.on("agent_tool_end", (_context, agent, tool, result) => {
    const toolKey = `${agent.name}:${tool.name}`;
    const startedAt = toolStartedAt.get(toolKey);
    if (startedAt) toolStartedAt.delete(toolKey);
    logger.info("realtime tool end", {
      callId: session.id,
      agent: agent.name,
      tool: tool.name,
      resultPreview: result.slice(0, 220),
      durationMs: startedAt ? Date.now() - startedAt : undefined,
      approvalGateState: callContext.approvalGateState,
    });
    schedulePersist();
  });

  realtimeSession.on("tool_approval_requested", (_context, agent, approvalRequest) => {
    logger.info("realtime tool approval requested", {
      callId: session.id,
      agent: agent.name,
      approvalType: approvalRequest.type,
      pendingAction: callContext.pendingAction?.toolName ?? null,
      approvalGateState: callContext.approvalGateState,
    });
  });

  realtimeSession.on("guardrail_tripped", (_context, agent, error) => {
    logger.warn("realtime output guardrail tripped", {
      callId: session.id,
      agent: agent.name,
      error: error.message,
    });
  });

  realtimeSession.on("history_updated", () => {
    schedulePersist();
  });

  realtimeSession.on("error", (errorEvent) => {
    logger.error("realtime session error", {
      callId: session.id,
      error: errorEvent.error instanceof Error ? errorEvent.error.message : String(errorEvent.error),
    });
    stop("error");
  });

  realtimeSession.on("transport_event", (rawEvent) => {
    const event = rawEvent as Record<string, unknown>;
    const eventType = typeof event.type === "string" ? event.type : "unknown";

    if (eventType === "input_audio_buffer.speech_started" && env.REALTIME_EARLY_BARGE_ON_SPEECH_STARTED) {
      const t = Date.now();
      if (t - lastEarlyBargeAt < env.BARGE_IN_COOLDOWN_MS) {
        return;
      }
      lastEarlyBargeAt = t;
      const t0 = t;
      const qBefore = clearChunkQueue();
      onBargeIn?.();
      realtimeSession.interrupt();
      if (enableBargeClearPacing && bridgeConnection) {
        bridgeConnection.clearPlayback();
        bargeInClearCount += 1;
      }
      logger.info("voice tuning interruption", {
        tag: "voice-tuning",
        callId: session.id,
        stage: "realtime_speech_started_barge",
        barge_in_to_audio_queue_clear_ms: Date.now() - t0,
        cleared_queued_sentences: qBefore,
        tts_queue_generation_after: queueGeneration,
      });
      return;
    }

    if (eventType === "conversation.item.input_audio_transcription.completed") {
      transcriptQueue = transcriptQueue
        .then(async () => {
          const transcript = typeof event.transcript === "string" ? event.transcript.trim() : "";
          if (!transcript) return;

          const transcriptAt = Date.now();
          lastUserActivityAt = transcriptAt;
          sentSilence1 = false;
          sentSilence2 = false;
          sentSilence3 = false;

          const guardRaceMs = env.VOICE_INPUT_GUARD_RACE_MS;
          const inputCheck = await Promise.race<GuardrailResult>([
            guardrailsEngine.checkInput(transcript, session.id),
            new Promise<GuardrailResult>((resolve) =>
              setTimeout(() => resolve({ blocked: false, action: "none" }), guardRaceMs),
            ),
          ]);
          const tAfterGuard = Date.now();
          if (inputCheck.blocked && onInputBlocked) {
            const msg = inputCheck.message || "I can’t help with that right now. How else can I help?";
            await onInputBlocked(msg);
            return;
          }

          const tBargeStart = Date.now();
          const interruptedQueueLen = clearChunkQueue();
          onBargeIn?.();
          realtimeSession.interrupt();
          if (enableBargeClearPacing && bridgeConnection) {
            bridgeConnection.clearPlayback();
            bargeInClearCount += 1;
          }
          logger.info("voice tuning interruption", {
            tag: "voice-tuning",
            callId: session.id,
            stage: "realtime_transcript_completed_barge",
            barge_in_to_audio_queue_clear_ms: Date.now() - tBargeStart,
            cleared_queued_sentences: interruptedQueueLen,
            tts_queue_generation: queueGeneration,
          });

          lastUserText = transcript;
          session.markRealtimeUserTurn(transcript);

          prepareApprovalStateForUserTurn(callContext, transcript);
          callContext.currentDateTime = new Date().toISOString();

          responseCreateSeq += 1;
          pendingTurnMetrics = createTurnMetrics(
            session.getTurnCount(),
            responseCreateSeq,
            transcript,
            currentIngressStartedAt,
            transcriptAt,
          );
          activeTurnKey = pendingTurnMetrics.turnKey;
          toolCallsByTurn.set(activeTurnKey, new Set<string>());
          currentIngressStartedAt = null;

          const routeHint = inferRouteHint(transcript);
          const preferredAgentName = routeHintToAgentName(routeHint);
          const activeBeforeRoute = realtimeSession.currentAgent.name;
          let routeApplied = false;
          if (
            activeBeforeRoute === "Receptionist" &&
            preferredAgentName &&
            preferredAgentName !== activeBeforeRoute
          ) {
            const preferredAgent = getRealtimeAgentByName(preferredAgentName);
            if (preferredAgent) {
              await realtimeSession.updateAgent(preferredAgent);
              routeApplied = true;
            }
          }

          const tKb0 = Date.now();
          const kbRefresh = await maybeRefreshKb(transcript);
          const tAfterKb = Date.now();
          if (pendingTurnMetrics) {
            pendingTurnMetrics.ragFallbackUsed = kbRefresh.fallbackUsed;
          }

          logger.info("realtime transcript completed", {
            callId: session.id,
            transcriptPreview: transcript.slice(0, 220),
            turnSeq: pendingTurnMetrics?.turnSeq ?? session.getTurnCount(),
            approvalGateState: callContext.approvalGateState,
            pendingAction: callContext.pendingAction?.toolName ?? null,
            interruptedQueuedSentences: interruptedQueueLen,
            routeHint: routeHint ?? "none",
            activeAgentBeforeRoute: activeBeforeRoute,
            activeAgentAfterRoute: realtimeSession.currentAgent.name,
            routeApplied,
            kbSkipped: kbRefresh.skipped,
            kbTimedOut: kbRefresh.timedOut,
            kbFetchMs: kbRefresh.durationMs,
            kbPassageCount: kbRefresh.passageCount,
            kbNamespaceUsed: kbRefresh.namespaceUsed,
            kbFallbackUsed: kbRefresh.fallbackUsed,
            kbMatchCount: kbRefresh.matchCount,
            kbHealthStatus: callContext.kbHealth?.status ?? "unknown",
            activeTurnKey,
            bargeInClearCount,
          });

          await persistNow();

          if (pendingTurnMetrics) {
            pendingTurnMetrics.turnState = "response_requested";
            pendingTurnMetrics.responseRequestedAt = Date.now();
          }
          const tResponseCreate = Date.now();
          logger.info("realtime response requested", {
            callId: session.id,
            turnSeq: pendingTurnMetrics?.turnSeq ?? session.getTurnCount(),
            responseCreateSeq,
            activeAgent: realtimeSession.currentAgent.name,
            activeTurnKey,
          });
          const responseInstr = buildResponseInstructions(callContext, realtimeSession.currentAgent.name);
          realtimeSession.transport.sendEvent({
            type: "response.create",
            response: { instructions: responseInstr },
          });
          logger.info("voice tuning eagerness", {
            tag: "voice-tuning",
            callId: session.id,
            path: "realtime",
            end_of_user_speech_to_response_create_ms: tResponseCreate - transcriptAt,
            end_of_user_speech_to_guard_done_ms: tAfterGuard - transcriptAt,
            end_of_user_speech_to_kb_done_ms: tAfterKb - transcriptAt,
            guard_race_config_ms: guardRaceMs,
            kb_wall_ms: tAfterKb - tKb0,
            kb_retrieval_ms: kbRefresh.durationMs,
          });
        })
        .catch((error) => {
          logger.warn("realtime transcript processing failed", {
            callId: session.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return;
    }

    if (eventType === "response.created") {
      const responseId = eventResponseId(event);
      if (!responseId) return;

      if (!responseStates.has(responseId)) {
        const fallbackMetrics = createTurnMetrics(
          session.getTurnCount(),
          responseCreateSeq,
          lastUserText,
          null,
          Date.now(),
        );
        const metrics = pendingTurnMetrics ?? fallbackMetrics;
        if (!activeTurnKey) {
          activeTurnKey = metrics.turnKey;
          toolCallsByTurn.set(activeTurnKey, toolCallsByTurn.get(activeTurnKey) ?? new Set<string>());
        }
        metrics.responseCreatedAt = Date.now();
        responseStates.set(responseId, {
          textBuffer: "",
          fullText: "",
          metrics,
          turnKey: metrics.turnKey,
          pendingLeadIn: null,
          assembledChunkBuffer: "",
          assembledChunkTimer: null,
        });
      }

      const state = responseStates.get(responseId);
      if (!state) return;
      state.metrics.responseCreatedAt = state.metrics.responseCreatedAt ?? Date.now();
      clearEmptyFinalizeTimer(state.turnKey);

      logger.info("realtime response created", {
        callId: session.id,
        responseId,
        turnSeq: state?.metrics.turnSeq,
        responseCreateSeq: state?.metrics.responseCreateSeq,
        activeAgent: realtimeSession.currentAgent.name,
        turnKey: state.turnKey,
        activeTurnKey,
      });

      pendingTurnMetrics = null;
      return;
    }

    if (eventType === "response.output_text.delta") {
      const responseId = eventResponseId(event);
      if (!responseId) return;

      const delta = typeof event.delta === "string" ? event.delta : "";
      if (!delta) return;

      let state = responseStates.get(responseId);
      if (!state) {
        const fallbackMetrics = createTurnMetrics(
          session.getTurnCount(),
          responseCreateSeq,
          lastUserText,
          null,
          Date.now(),
        );
        const metrics = pendingTurnMetrics ?? fallbackMetrics;
        if (!activeTurnKey) {
          activeTurnKey = metrics.turnKey;
          toolCallsByTurn.set(activeTurnKey, toolCallsByTurn.get(activeTurnKey) ?? new Set<string>());
        }
        state = {
          textBuffer: "",
          fullText: "",
          metrics,
          turnKey: metrics.turnKey,
          pendingLeadIn: null,
          assembledChunkBuffer: "",
          assembledChunkTimer: null,
        };
        responseStates.set(responseId, state);
        pendingTurnMetrics = null;
      }

      if (state.metrics.firstTextDeltaAt === null) {
        state.metrics.firstTextDeltaAt = Date.now();
        state.metrics.turnState = "streaming";
        logger.info("realtime first text delta", {
          callId: session.id,
          responseId,
          turnSeq: state.metrics.turnSeq,
          responseCreateSeq: state.metrics.responseCreateSeq,
          transcriptToFirstTextDeltaMs: state.metrics.firstTextDeltaAt - state.metrics.transcriptAt,
          activeAgent: realtimeSession.currentAgent.name,
        });
        if (state.metrics.transcriptAt) {
          logger.info("voice tuning eagerness", {
            tag: "voice-tuning",
            callId: session.id,
            path: "realtime",
            turnKey: state.turnKey,
            end_of_user_speech_to_first_model_output_ms: state.metrics.firstTextDeltaAt! - state.metrics.transcriptAt,
            responseId,
          });
        }
      }

      state.textBuffer += delta;
      state.fullText += delta;

      const extracted = extractSentenceChunks(state.textBuffer);
      state.textBuffer = extracted.remainder;
      responseTextTail.set(responseId, state.textBuffer);

      for (const sentence of extracted.sentences) {
        pushSentenceIntoAssembler(state, responseId, sentence);
      }
      return;
    }

    if (eventType === "response.done") {
      const responseId = eventResponseId(event);
      if (!responseId) return;
      const state = responseStates.get(responseId);
      logger.info("realtime response done event", {
        callId: session.id,
        responseId,
        activeAgent: realtimeSession.currentAgent.name,
        turnKey: state?.turnKey,
        activeTurnKey,
      });
      void finalizeTurn(responseId);
    }
  });

  if (bridgeConnection) {
    bridgeConnection.onClose(() => {
      logger.info("rtp bridge connection closed during realtime conversation", {
        callId: session.id,
      });
      stop("bridge_closed");
    });

    bridgeConnection.onError((error) => {
      logger.warn("rtp bridge connection error during realtime conversation", {
        callId: session.id,
        error: error.message,
      });
    });

    bridgeConnection.onAudio((frame) => {
      if (stopped) return;
      if (currentIngressStartedAt === null) {
        currentIngressStartedAt = Date.now();
      }
      lastUserActivityAt = Date.now();
      onCallerAudioBytes?.(frame.payload.length);
      realtimeSession.sendAudio(toArrayBuffer(frame.payload));
    });
  }

  if (signal) {
    signal.addEventListener("abort", () => {
      stop("signal_abort");
    });
  }

  const timeout = setTimeout(() => {
    logger.warn("realtime conversation max duration reached", {
      callId: session.id,
      maxCallDurationMs,
    });
    stop("timeout");
  }, maxCallDurationMs);

  if (initialUtterance && initialUtterance.trim().length > 0 && initialUtterance !== "I need to book an appointment") {
    const utterance = initialUtterance.trim();
    lastUserText = utterance;
    session.markRealtimeUserTurn(utterance);

    prepareApprovalStateForUserTurn(callContext, utterance);
    callContext.currentDateTime = new Date().toISOString();

    responseCreateSeq += 1;
    pendingTurnMetrics = createTurnMetrics(
      session.getTurnCount(),
      responseCreateSeq,
      utterance,
      Date.now(),
      Date.now(),
    );
    pendingTurnMetrics.turnState = "response_requested";
    pendingTurnMetrics.responseRequestedAt = Date.now();
    activeTurnKey = pendingTurnMetrics.turnKey;
    toolCallsByTurn.set(activeTurnKey, new Set<string>());

    const kbRefresh = await maybeRefreshKb(utterance);
    if (pendingTurnMetrics) {
      pendingTurnMetrics.ragFallbackUsed = kbRefresh.fallbackUsed;
    }
    logger.info("realtime initial utterance processed", {
      callId: session.id,
      turnSeq: session.getTurnCount(),
      kbSkipped: kbRefresh.skipped,
      kbTimedOut: kbRefresh.timedOut,
      kbFetchMs: kbRefresh.durationMs,
      kbPassageCount: kbRefresh.passageCount,
      kbNamespaceUsed: kbRefresh.namespaceUsed,
      kbFallbackUsed: kbRefresh.fallbackUsed,
      kbMatchCount: kbRefresh.matchCount,
      activeAgent: realtimeSession.currentAgent.name,
      activeTurnKey,
    });
    await persistNow();

    realtimeSession.sendMessage(utterance);
  }

  const reason = await stopPromise;
  clearTimeout(timeout);

  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  for (const timer of emptyFinalizeTimers.values()) {
    clearTimeout(timer);
  }
  emptyFinalizeTimers.clear();
  for (const state of responseStates.values()) {
    if (state.assembledChunkTimer) {
      clearTimeout(state.assembledChunkTimer);
    }
  }

  try {
    await persistNow();
  } catch {
    // best effort only
  }

  realtimeSession.close();

  logger.info("realtime conversation ended", {
    callId: session.id,
    reason,
    activeAgent: realtimeSession.currentAgent.name,
    transcriptLines: session.getTranscript().length,
    empty_pass_rate:
      session.getTurnCount() === 0 ? 0 : Number((emptyPassCountByCall / session.getTurnCount()).toFixed(4)),
    duplicate_turn_finalize_rate:
      session.getTurnCount() === 0
        ? 0
        : Number((duplicateFinalizeCountByCall / session.getTurnCount()).toFixed(4)),
    tts_chunks_per_turn:
      session.getTurnCount() === 0 ? 0 : Number((totalChunksDispatched / session.getTurnCount()).toFixed(2)),
    tts_queue_wait_p95: percentile(queueWaitSamplesByCall, 95) ?? 0,
    rag_hit_rate: ragTotalQueries === 0 ? 0 : Number((ragHitQueries / ragTotalQueries).toFixed(4)),
    barge_in_clear_count: bargeInClearCount,
    rag_fallback_count: ragFallbackCount,
  });

  return stopReason;
}
