import { createLogger } from "@rezovo/logging";
import { ConfigCache } from "../config-cache/cache";
import { fetchConfigSnapshot } from "../config-cache/fetcher";
import { CallEndReason, CallEndedPayload, PhoneNumberConfig } from "@rezovo/core-types";
import { EventPublisher } from "../events/eventPublisher";
import { CallSession } from "../orchestrator/callSession";
import { runRealtimeConversation } from "../orchestrator/realtime/realtimeConversation";
import { sessionStore } from "../orchestrator/openai-agents/sessionStore";
import { createTtsProvider } from "../media/ttsElevenLabs";
import { BillingQuotaClient } from "../billingClient";
import { MediaSession, RtpBridgeClient, RtpBridgeConnection } from "../media/rtpBridgeClient";
import { SttClient, TranscriptSegment } from "../media/sttClient";
import { persistCallStart, persistCallEnd, persistCallEvent, TranscriptLine } from "../callPersistence";
import { env } from "../env";
import { traceLog } from "../traceLog";
import type { TurnDiagnostics } from "../orchestrator/openai-agents";

const logger = createLogger({ service: "realtime-core", module: "callController" });

const SHORT_LEAD_INS = new Set([
  "got it.",
  "got it!",
  "thanks.",
  "thank you.",
  "thank you!",
  "perfect.",
  "great.",
  "sure.",
  "okay.",
  "ok.",
  "absolutely.",
  "of course.",
]);

export function sanitizeTransferNarration(text: string): string {
  let out = text;
  out = out.replace(
    /\b(i('|’)ll|let me)\s+(get|connect|transfer|put)\s+you\s+(over|through|with|to)\s+(to\s+)?(the\s+)?(right\s+)?(specialist|team|agent)(\s+now)?[.!]?/gi,
    "I can help with that.",
  );
  out = out.replace(/\bone moment,\s*please[.!]?/gi, "");
  return out.replace(/\s{2,}/g, " ").trim();
}

export function isShortLeadIn(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return normalized.length > 0 && normalized.length <= 14 && SHORT_LEAD_INS.has(normalized);
}

export function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function computeAdaptiveDebounceMs(text: string, confidence?: number): number {
  const base = Math.max(300, Math.min(1200, env.LEGACY_FINAL_DEBOUNCE_MS));
  const trimmed = text.trim();

  // Short utterances: add headroom so callers aren't cut off mid-thought.
  if (trimmed.length < 24) {
    return Math.max(400, Math.min(1200, Math.floor(base * 1.3)));
  }
  // High-confidence long utterances still need the full base; don't shorten aggressively.
  if (typeof confidence === "number" && confidence >= 0.92 && trimmed.length >= 40) {
    return Math.max(300, Math.min(900, Math.floor(base * 0.95)));
  }

  return base;
}

export type InboundCallArgs = {
  callId?: string;
  did: string;
  orgId: string;
  lob?: string;
  callerNumber?: string;
  initialUtterance?: string;
};

type ControllerDeps = {
  cache: ConfigCache;
  events: EventPublisher;
  billing: BillingQuotaClient;
  media: RtpBridgeClient;
  elevenApiKey?: string;
  elevenVoiceId?: string;
};

type LegacyTurnTiming = {
  ingressStartedAt: number | null;
  sttFinalizedAt: number;
  sttFinalSegments?: number;
  sttFinalAssemblyMs?: number;
  sttFinalDebounceWaitMs?: number;
  sttAssembledChars?: number;
  sttFinalAvgConfidence?: number;
  bufferedWhileProcessingMs?: number;
};

type TtsDispatchMetrics = {
  synthesisMs: number;
  firstByteMs?: number;
  bytes: number;
  chunkCount: number;
  bridgeDispatchMs: number;
  dispatchAborted: boolean;
  attempt: number;
};

export class CallController {
  constructor(private deps: ControllerDeps) {}

  async handleInboundCall(args: InboundCallArgs, ctx?: { signal?: AbortSignal }): Promise<void> {
    const { callId, did, orgId, lob, initialUtterance } = args;
    let phoneConfig = this.deps.cache.getRoute(did, orgId, lob);

    // Lazy hydration: if cache misses, fetch from platform-api for this organization
    if (!phoneConfig) {
      logger.info("cache miss, fetching config from platform-api", { did, orgId, lob });
      try {
        const snapshot = await fetchConfigSnapshot(orgId, lob ?? "default");
        this.deps.cache.replaceFromSnapshot(snapshot);
        phoneConfig = this.deps.cache.getRoute(did, orgId, lob);
        if (phoneConfig) {
          logger.info("cache hydrated for organization on demand", { did, orgId });
        }
      } catch (err) {
        logger.warn("lazy config fetch failed", { error: (err as Error).message, orgId });
      }
    }

    if (!phoneConfig) {
      logger.warn("no phone config after lazy fetch, routing to voicemail", { did, orgId, lob });
      await this.persistFallbackFailure(callId, orgId, "missing_config", "error");
      this.routeToFallback("missing_config");
      return;
    }
    if (phoneConfig.routeType !== "ai") {
      logger.info("non-ai route, returning early", { did, orgId, routeType: phoneConfig.routeType });
      this.routeToFallback("non_ai_route", phoneConfig);
      return;
    }

    const agentConfig = this.deps.cache.getAgent(phoneConfig.agentConfigId ?? "");
    if (!agentConfig) {
      logger.warn("missing agent config", { agentConfigId: phoneConfig.agentConfigId });
      await this.persistFallbackFailure(callId, orgId, "missing_agent_config", "error");
      this.routeToFallback("missing_agent_config", phoneConfig);
      return;
    }

    try {
      const quota = await this.deps.billing.canStartCall(orgId);
      if (!quota.allowed) {
        logger.warn("quota denied, routing to voicemail", { orgId, reason: quota.reason });
        await this.persistFallbackFailure(callId, orgId, quota.reason ?? "quota_denied", "quota_denied");
        this.routeToFallback("quota_denied", phoneConfig);
        return;
      }
    } catch (err) {
      logger.error("billing quota failed", { error: (err as Error).message });
      await this.persistFallbackFailure(callId, orgId, "quota_error", "error");
      this.routeToFallback("quota_error", phoneConfig);
      return;
    }

    let session: CallSession | null = null;
    let mediaSession: MediaSession | null = null;
    let callStarted = false;
    let endReason: CallEndReason = "normal_completion";
    let outcome: CallEndedPayload["outcome"] = "handled";

    try {
      this.throwIfAborted(ctx?.signal);
      session = new CallSession(phoneConfig, agentConfig, { callId });
      if (env.CONVERSATION_ENGINE !== "realtime_agents") {
        await session.restoreFromStore();
      }
      mediaSession = await this.deps.media.startSession({ callId: session.id, did, orgId });

      await this.publishCallStarted({ session, did, orgId, phoneConfig, callerNumber: args.callerNumber });
      callStarted = true;
      traceLog.callStart(session.id, { did, orgId });

      await this.handleDialogue(session, initialUtterance ?? "I need to book an appointment", mediaSession, ctx?.signal);
    } catch (err) {
      const error = err as Error;
      if (error.name === "CallerHangup") {
        endReason = "caller_hangup";
        outcome = "abandoned";
        logger.info("call aborted by caller", { did, orgId });
      } else {
        endReason = "error";
        outcome = "failed";
        logger.error("call handling failed", { did, orgId, error: error.message });
      }
      if (!callStarted) {
        await this.persistFallbackFailure(callId, orgId, "call_start_failure", "error");
        this.routeToFallback("call_start_failure", phoneConfig);
      }
    } finally {
      if (session && mediaSession && callStarted) {
        await this.publishCallEnded(session, mediaSession, { endReason, outcome });
      } else if (mediaSession) {
        mediaSession.stop();
      }
    }
  }

  private async handleDialogue(
    session: CallSession,
    initialUtterance: string,
    mediaSession: MediaSession,
    signal?: AbortSignal
  ): Promise<void> {
    const tts =
      this.deps.elevenApiKey && this.deps.elevenVoiceId
        ? createTtsProvider({
            apiKey: this.deps.elevenApiKey,
            voiceId: this.deps.elevenVoiceId,
            modelId: env.ELEVEN_MODEL_ID || undefined,
          })
        : null;

    // Connect to RTP bridge for audio streaming
    let bridgeConnection: RtpBridgeConnection | null = null;
    try {
      bridgeConnection = await this.deps.media.connect(session.id);
      logger.info("connected to RTP bridge", { callId: session.id });
    } catch (err) {
      logger.warn("RTP bridge connection failed, will operate without live audio", {
        callId: session.id,
        error: (err as Error).message,
      });
    }

    if (env.CONVERSATION_ENGINE === "realtime_agents") {
      await this.handleDialogueRealtime(
        session,
        initialUtterance,
        mediaSession,
        bridgeConnection,
        tts,
        signal,
      );
      return;
    }

    // Initialize STT client using env object
    const stt = new SttClient({
      provider: env.STT_PROVIDER,
      apiKey: env.STT_API_KEY,
      model: env.STT_MODEL,
      endpointingMs: env.LEGACY_STT_ENDPOINTING_MS,
      utteranceEndMs: env.LEGACY_STT_UTTERANCE_END_MS,
    });

    // 1. Send greeting
    this.throwIfAborted(signal);
    const greet = session.greet();
    if (tts && greet.type === "speak" && greet.text.trim().length > 0) {
      const ttsStart = Date.now();
      await this.synthesizeAndSend(tts, greet.text, mediaSession, bridgeConnection,
        (chars, seconds) => session.addTtsUsage(chars, seconds), signal);
      traceLog.autoMessage(session.id, "greeting", greet.text, Date.now() - ttsStart);
    }

    const minChunkChars = Math.max(8, env.LEGACY_TTS_MIN_CHUNK_CHARS);
    const maxChunkChars = Math.max(minChunkChars + 8, env.LEGACY_TTS_MAX_CHUNK_CHARS);
    const maxChunkWaitMs = Math.max(80, env.LEGACY_TTS_MAX_CHUNK_WAIT_MS);
    let callEnded = false;

    // 2. Legacy TTS queue + assembler (single-flight dispatch, non-blocking for LLM stream)
    let ttsQueueGeneration = 0;
    let ttsQueueBusy = false;
    let lastBargeClearAt = 0;
    const ttsQueue: Array<{
      text: string;
      turnKey: string;
      generation: number;
      enqueuedAt: number;
    }> = [];
    const turnAssembler = new Map<
      string,
      {
        buffer: string;
        pendingLeadIn: string | null;
        flushTimer: ReturnType<typeof setTimeout> | null;
      }
    >();
    const turnTtsMetrics = new Map<
      string,
      {
        chunksDispatched: number;
        queueWaitSamples: number[];
        firstTtsAt: number | null;
        firstByteSamples: number[];
        synthesisSamples: number[];
        bridgeDispatchSamples: number[];
        bytesSynthesized: number;
      }
    >();
    const callLatencyMetrics = {
      ingressToSttFinalMs: [] as number[],
      sttFinalToRunRequestMs: [] as number[],
      runRequestToFirstTextMs: [] as number[],
      firstTextToFirstTtsMs: [] as number[],
      turnTotalMs: [] as number[],
      ttsQueueWaitMs: [] as number[],
      ttsFirstByteMs: [] as number[],
      ttsSynthesisMs: [] as number[],
      sttFinalSegments: [] as number[],
      bufferedWhileProcessingMs: [] as number[],
    };

    const clearAssemblerState = (turnKey: string): void => {
      const state = turnAssembler.get(turnKey);
      if (!state) return;
      if (state.flushTimer) clearTimeout(state.flushTimer);
      turnAssembler.delete(turnKey);
    };

    const getTurnMetrics = (turnKey: string) => {
      const existing = turnTtsMetrics.get(turnKey);
      if (existing) return existing;
      const created = {
        chunksDispatched: 0,
        queueWaitSamples: [],
        firstTtsAt: null,
        firstByteSamples: [],
        synthesisSamples: [],
        bridgeDispatchSamples: [],
        bytesSynthesized: 0,
      };
      turnTtsMetrics.set(turnKey, created);
      return created;
    };

    const enqueueChunk = (turnKey: string, text: string): void => {
      const trimmed = sanitizeTransferNarration(text.trim());
      if (!trimmed) return;
      ttsQueue.push({
        text: trimmed,
        turnKey,
        generation: ttsQueueGeneration,
        enqueuedAt: Date.now(),
      });
      void pumpTtsQueue();
    };

    const scheduleAssemblerFlush = (turnKey: string): void => {
      const state = turnAssembler.get(turnKey);
      if (!state || state.flushTimer) return;
      state.flushTimer = setTimeout(() => {
        state.flushTimer = null;
        flushAssembler(turnKey, true);
      }, maxChunkWaitMs);
    };

    const flushAssembler = (turnKey: string, force: boolean): void => {
      const state = turnAssembler.get(turnKey);
      if (!state) return;

      if (!state.buffer.trim() && state.pendingLeadIn) {
        state.buffer = state.pendingLeadIn;
        state.pendingLeadIn = null;
      }

      let working = state.buffer.trim();
      if (!working) return;

      while (working.length > maxChunkChars) {
        const splitAtSpace = working.lastIndexOf(" ", maxChunkChars);
        const splitIdx = splitAtSpace > Math.floor(maxChunkChars * 0.6) ? splitAtSpace : maxChunkChars;
        const head = working.slice(0, splitIdx).trim();
        if (head) enqueueChunk(turnKey, head);
        working = working.slice(splitIdx).trim();
      }

      if (working.length >= minChunkChars || force) {
        enqueueChunk(turnKey, working);
        state.buffer = "";
        return;
      }

      state.buffer = working;
      scheduleAssemblerFlush(turnKey);
    };

    const appendSentence = (turnKey: string, sentence: string): void => {
      if (!tts) return;
      const safeSentence = sanitizeTransferNarration(sentence.trim());
      if (!safeSentence) return;

      const state =
        turnAssembler.get(turnKey) ??
        (() => {
          const created = { buffer: "", pendingLeadIn: null as string | null, flushTimer: null as ReturnType<typeof setTimeout> | null };
          turnAssembler.set(turnKey, created);
          return created;
        })();

      let nextSentence = safeSentence;
      if (!state.buffer.trim() && isShortLeadIn(nextSentence)) {
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

      state.buffer = state.buffer.trim().length > 0 ? `${state.buffer.trim()} ${nextSentence}` : nextSentence;
      if (state.buffer.length >= maxChunkChars) {
        flushAssembler(turnKey, false);
        return;
      }

      if (state.buffer.length >= minChunkChars && /[.!?]$/.test(nextSentence)) {
        flushAssembler(turnKey, false);
        return;
      }

      scheduleAssemblerFlush(turnKey);
    };

    const interruptLegacyTts = (reason: string): void => {
      if (!tts) return;
      const now = Date.now();
      if (now - lastBargeClearAt < 400) return;
      lastBargeClearAt = now;

      const dropped = ttsQueue.length;
      ttsQueueGeneration++;
      ttsQueue.length = 0;
      for (const state of turnAssembler.values()) {
        if (state.flushTimer) clearTimeout(state.flushTimer);
        state.flushTimer = null;
        state.buffer = "";
        state.pendingLeadIn = null;
      }
      if (bridgeConnection) {
        bridgeConnection.clearPlayback();
      }
      logger.info("legacy tts queue interrupted", {
        callId: session.id,
        reason,
        droppedChunks: dropped,
      });
    };

    const hasTtsPlayingSince = (ms: number): boolean => {
      for (const metrics of turnTtsMetrics.values()) {
        if (metrics.firstTtsAt !== null && Date.now() - metrics.firstTtsAt >= ms) return true;
      }
      return false;
    };

    const pumpTtsQueue = async (): Promise<void> => {
      if (!tts || ttsQueueBusy) return;
      ttsQueueBusy = true;
      try {
        while (ttsQueue.length > 0 && !callEnded) {
          const next = ttsQueue.shift();
          if (!next) continue;
          if (next.generation !== ttsQueueGeneration) continue;

          const metrics = getTurnMetrics(next.turnKey);
          if (metrics.firstTtsAt === null) {
            metrics.firstTtsAt = Date.now();
          }
          const queueWaitMs = Date.now() - next.enqueuedAt;
          metrics.queueWaitSamples.push(queueWaitMs);

          // While the agent itself is speaking, reset the silence clock so the
          // silence monitor does not trip mid-response with "Are you still there?".
          lastActivityAt = Date.now();

          const synthesisMs = await this.synthesizeAndSend(
            tts,
            next.text,
            mediaSession,
            bridgeConnection,
            (chars, seconds) => session.addTtsUsage(chars, seconds),
            signal,
            () => next.generation === ttsQueueGeneration && !callEnded,
            (dispatchMetrics) => {
              if (typeof dispatchMetrics.firstByteMs === "number") {
                metrics.firstByteSamples.push(dispatchMetrics.firstByteMs);
              }
              metrics.synthesisSamples.push(dispatchMetrics.synthesisMs);
              metrics.bridgeDispatchSamples.push(dispatchMetrics.bridgeDispatchMs);
              metrics.bytesSynthesized += dispatchMetrics.bytes;
            },
          );
          // Bump again after the chunk finishes dispatching so the 8s grace
          // window starts from the last agent audio, not the start of the turn.
          lastActivityAt = Date.now();
          if (synthesisMs <= 0) continue;

          const sentenceIndex = metrics.chunksDispatched;
          metrics.chunksDispatched += 1;
          traceLog.ttsSentence(session.id, next.turnKey, sentenceIndex, next.text.length, synthesisMs);
        }
      } finally {
        ttsQueueBusy = false;
        // Final bump when the queue drains completely.
        lastActivityAt = Date.now();
      }
    };

    // 3. START CONVERSATIONAL LOOP — STT ↔ LLM ↔ TTS
    let transcriptBuffer = "";
    let isProcessing = false;
    let pendingUtterance: string | null = null;
    let pendingUtteranceIngressAt: number | null = null;
    let pendingUtteranceSttFinalAt: number | null = null;
    let pendingTurnTiming: LegacyTurnTiming | null = null;
    let pendingUtteranceBufferedAt: number | null = null;

    // Silence detection state
    let lastActivityAt = Date.now();
    const SILENCE_PROMPT_MS = Math.max(1_000, env.LEGACY_SILENCE_PROMPT_MS);
    const MAX_SILENCE_PROMPTS = Math.max(1, env.LEGACY_MAX_SILENCE_PROMPTS);
    const silenceCheckIntervalMs = Math.max(250, env.LEGACY_SILENCE_CHECK_INTERVAL_MS);
    let silencePromptCount = 0;
    let pendingFinalUtterance = "";
    let pendingFinalTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingFinalFirstAt: number | null = null;
    let pendingFinalLastAt: number | null = null;
    let pendingFinalSegments = 0;
    let pendingFinalConfidenceSum = 0;
    let pendingFinalConfidenceCount = 0;

    const mergeTurnTiming = (base: LegacyTurnTiming | null, next: LegacyTurnTiming): LegacyTurnTiming => {
      if (!base) return { ...next };
      return {
        ingressStartedAt:
          base.ingressStartedAt === null
            ? next.ingressStartedAt
            : next.ingressStartedAt === null
              ? base.ingressStartedAt
              : Math.min(base.ingressStartedAt, next.ingressStartedAt),
        sttFinalizedAt: Math.max(base.sttFinalizedAt, next.sttFinalizedAt),
        sttFinalSegments: (base.sttFinalSegments ?? 0) + (next.sttFinalSegments ?? 0),
        sttFinalAssemblyMs: (base.sttFinalAssemblyMs ?? 0) + (next.sttFinalAssemblyMs ?? 0),
        sttFinalDebounceWaitMs:
          (base.sttFinalDebounceWaitMs ?? 0) + (next.sttFinalDebounceWaitMs ?? 0),
        sttAssembledChars: (base.sttAssembledChars ?? 0) + (next.sttAssembledChars ?? 0),
        sttFinalAvgConfidence:
          base.sttFinalAvgConfidence ?? next.sttFinalAvgConfidence,
        bufferedWhileProcessingMs: Math.max(
          base.bufferedWhileProcessingMs ?? 0,
          next.bufferedWhileProcessingMs ?? 0,
        ),
      };
    };

    const processTurn = async (
      userText: string,
      sttStreamRef: { close: () => void },
      timing?: LegacyTurnTiming,
    ) => {
      isProcessing = true;
      lastActivityAt = Date.now();
      silencePromptCount = 0;
      const turnKey = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      traceLog.sttFinal(session.id, userText, {
        sttFinalSegments: timing?.sttFinalSegments,
        sttFinalAssemblyMs: timing?.sttFinalAssemblyMs,
        sttFinalDebounceWaitMs: timing?.sttFinalDebounceWaitMs,
      });
      logger.info("processing user utterance", { callId: session.id, text: userText });
      logger.info("turn processing started", {
        callId: session.id,
        activeAgent: session.getCurrentAgentName(),
        utterancePreview: userText.slice(0, 220),
        turnKey,
        sttFinalSegments: timing?.sttFinalSegments,
        sttFinalAssemblyMs: timing?.sttFinalAssemblyMs,
        sttFinalDebounceWaitMs: timing?.sttFinalDebounceWaitMs,
        sttBufferedWhileProcessingMs: timing?.bufferedWhileProcessingMs,
      });
      try {
        const response = await session.receiveUserStreaming(
          userText,
          async (sentence: string) => {
            if (!callEnded) appendSentence(turnKey, sentence);
          },
          timing,
        );
        flushAssembler(turnKey, true);
        clearAssemblerState(turnKey);
        void pumpTtsQueue();

        logger.info("turn processing completed", {
          callId: session.id,
          responseType: response.type,
          activeAgent: session.getCurrentAgentName(),
          turnKey,
          responsePreview: (response.text ?? "").slice(0, 220),
        });

        const turnDiagnostics = session.getLastTurnDiagnostics();
        if (turnDiagnostics) {
          const ttsMetrics = getTurnMetrics(turnKey);
          const queueWaitP95 = percentile(ttsMetrics.queueWaitSamples, 95);
          const firstByteP95 = percentile(ttsMetrics.firstByteSamples, 95);
          const synthesisP95 = percentile(ttsMetrics.synthesisSamples, 95);
          const bridgeDispatchP95 = percentile(ttsMetrics.bridgeDispatchSamples, 95);
          const finalizedAt = Date.now();
          const ingressToTranscriptMs =
            typeof timing?.ingressStartedAt === "number"
              ? Math.max(0, timing.sttFinalizedAt - timing.ingressStartedAt)
              : undefined;
          const sttFinalToRunMs =
            typeof turnDiagnostics.stt_final_to_run_request_ms === "number"
              ? turnDiagnostics.stt_final_to_run_request_ms
              : undefined;
          const runRequestToFirstTextMs =
            typeof turnDiagnostics.run_request_to_first_text_ms === "number"
              ? turnDiagnostics.run_request_to_first_text_ms
              : undefined;
          const responseRequestedAt =
            typeof timing?.sttFinalizedAt === "number" && typeof sttFinalToRunMs === "number"
              ? timing.sttFinalizedAt + sttFinalToRunMs
              : undefined;
          const firstTextAt =
            typeof responseRequestedAt === "number" && typeof runRequestToFirstTextMs === "number"
              ? responseRequestedAt + runRequestToFirstTextMs
              : undefined;
          const firstTextDeltaToFirstTtsMs =
            typeof firstTextAt === "number" && ttsMetrics.firstTtsAt !== null
              ? Math.max(0, ttsMetrics.firstTtsAt - firstTextAt)
              : turnDiagnostics.first_text_delta_to_first_tts_ms;
          const turnTotalMs =
            typeof timing?.ingressStartedAt === "number"
              ? Math.max(0, finalizedAt - timing.ingressStartedAt)
              : turnDiagnostics.turnLatencyMs;
          const timelineBase =
            timing?.ingressStartedAt ?? timing?.sttFinalizedAt ?? finalizedAt;
          const enriched: TurnDiagnostics = {
            ...turnDiagnostics,
            ingress_to_transcript_ms: ingressToTranscriptMs,
            transcript_to_first_text_delta_ms:
              typeof sttFinalToRunMs === "number" && typeof runRequestToFirstTextMs === "number"
                ? sttFinalToRunMs + runRequestToFirstTextMs
                : undefined,
            first_text_delta_to_first_tts_ms: firstTextDeltaToFirstTtsMs,
            turn_total_ms: turnTotalMs,
            chunks_synthesized: ttsMetrics.chunksDispatched,
            tts_chunks_per_turn: ttsMetrics.chunksDispatched,
            queue_wait_p95_ms: queueWaitP95,
            tts_first_byte_p95_ms: firstByteP95,
            tts_synthesis_p95_ms: synthesisP95,
            tts_bridge_dispatch_p95_ms: bridgeDispatchP95,
            tts_total_bytes: ttsMetrics.bytesSynthesized,
            stt_final_segments: timing?.sttFinalSegments,
            stt_final_assembly_ms: timing?.sttFinalAssemblyMs,
            stt_final_debounce_wait_ms: timing?.sttFinalDebounceWaitMs,
            stt_buffered_while_processing_ms: timing?.bufferedWhileProcessingMs,
            stt_assembled_chars: timing?.sttAssembledChars,
            stt_final_avg_confidence: timing?.sttFinalAvgConfidence,
            timeline_ms: {
              transcript:
                typeof timing?.sttFinalizedAt === "number"
                  ? Math.max(0, timing.sttFinalizedAt - timelineBase)
                  : undefined,
              response_requested:
                typeof responseRequestedAt === "number"
                  ? Math.max(0, responseRequestedAt - timelineBase)
                  : undefined,
              first_text_delta:
                typeof firstTextAt === "number"
                  ? Math.max(0, firstTextAt - timelineBase)
                  : undefined,
              first_tts:
                ttsMetrics.firstTtsAt !== null
                  ? Math.max(0, ttsMetrics.firstTtsAt - timelineBase)
                  : undefined,
              finalized: Math.max(0, finalizedAt - timelineBase),
            },
          };
          if (typeof ingressToTranscriptMs === "number") {
            callLatencyMetrics.ingressToSttFinalMs.push(ingressToTranscriptMs);
          }
          if (typeof sttFinalToRunMs === "number") {
            callLatencyMetrics.sttFinalToRunRequestMs.push(sttFinalToRunMs);
          }
          if (typeof runRequestToFirstTextMs === "number") {
            callLatencyMetrics.runRequestToFirstTextMs.push(runRequestToFirstTextMs);
          }
          if (typeof firstTextDeltaToFirstTtsMs === "number") {
            callLatencyMetrics.firstTextToFirstTtsMs.push(firstTextDeltaToFirstTtsMs);
          }
          if (typeof turnTotalMs === "number") {
            callLatencyMetrics.turnTotalMs.push(turnTotalMs);
          }
          if (typeof queueWaitP95 === "number") {
            callLatencyMetrics.ttsQueueWaitMs.push(queueWaitP95);
          }
          if (typeof firstByteP95 === "number") {
            callLatencyMetrics.ttsFirstByteMs.push(firstByteP95);
          }
          if (typeof synthesisP95 === "number") {
            callLatencyMetrics.ttsSynthesisMs.push(synthesisP95);
          }
          if (typeof timing?.sttFinalSegments === "number") {
            callLatencyMetrics.sttFinalSegments.push(timing.sttFinalSegments);
          }
          if (typeof timing?.bufferedWhileProcessingMs === "number") {
            callLatencyMetrics.bufferedWhileProcessingMs.push(timing.bufferedWhileProcessingMs);
          }
          logger.info("legacy turn timing", {
            callId: session.id,
            turnKey,
            activeAgent: session.getCurrentAgentName(),
            sttFinalSegments: timing?.sttFinalSegments,
            sttFinalAssemblyMs: timing?.sttFinalAssemblyMs,
            sttFinalDebounceWaitMs: timing?.sttFinalDebounceWaitMs,
            sttBufferedWhileProcessingMs: timing?.bufferedWhileProcessingMs,
            sttAssembledChars: timing?.sttAssembledChars,
            ingressToTranscriptMs,
            sttFinalToRunRequestMs: sttFinalToRunMs,
            runRequestToFirstTextMs,
            firstTextDeltaToFirstTtsMs,
            ttsQueueWaitP95Ms: queueWaitP95,
            ttsFirstByteP95Ms: firstByteP95,
            ttsSynthesisP95Ms: synthesisP95,
            ttsBridgeDispatchP95Ms: bridgeDispatchP95,
            turnTotalMs,
            modelProfile: turnDiagnostics.modelProfile,
            retryReason: turnDiagnostics.retryReason,
          });
          const persistStartedAt = Date.now();
          persistCallEvent({
            callId: session.id,
            orgId: session.context.orgId,
            eventType: "turn_diagnostic",
            payload: enriched,
          })
            .then(() => {
              const durationMs = Date.now() - persistStartedAt;
              if (durationMs > 350) {
                logger.info("turn diagnostics persistence latency", {
                  callId: session.id,
                  turnKey,
                  durationMs,
                });
              }
            })
            .catch((err) => logger.warn("turn diagnostics persistence failed", {
              callId: session.id,
              error: err instanceof Error ? err.message : String(err),
            }));
        }

        if (response.type === "end") {
          callEnded = true;
          sttStreamRef.close();
        }
      } catch (error) {
        logger.error("error processing turn", {
          callId: session.id,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        isProcessing = false;
        transcriptBuffer = "";
        // Drain buffered utterance that arrived while we were busy
        if (pendingUtterance && !callEnded) {
          const next = pendingUtterance;
          const nextTiming = pendingTurnTiming ?? {
            ingressStartedAt: pendingUtteranceIngressAt,
            sttFinalizedAt: pendingUtteranceSttFinalAt ?? Date.now(),
          };
          if (pendingUtteranceBufferedAt !== null) {
            nextTiming.bufferedWhileProcessingMs = Math.max(
              nextTiming.bufferedWhileProcessingMs ?? 0,
              Date.now() - pendingUtteranceBufferedAt,
            );
          }
          pendingUtterance = null;
          pendingUtteranceIngressAt = null;
          pendingUtteranceSttFinalAt = null;
          pendingTurnTiming = null;
          pendingUtteranceBufferedAt = null;
          await processTurn(next, sttStreamRef, nextTiming);
        }
      }
    };

    const clearPendingFinalTimer = () => {
      if (!pendingFinalTimer) return;
      clearTimeout(pendingFinalTimer);
      pendingFinalTimer = null;
    };

    const flushPendingFinalUtterance = async (
      sttStreamRef: { close: () => void },
      flushReason: "debounce_timeout" | "manual_flush" = "manual_flush",
    ) => {
      const userText = pendingFinalUtterance.trim();
      const finalizedAt = pendingFinalLastAt ?? Date.now();
      const firstFinalAt = pendingFinalFirstAt ?? finalizedAt;
      const sttFinalSegments = pendingFinalSegments;
      const sttFinalAssemblyMs = Math.max(0, finalizedAt - firstFinalAt);
      const sttFinalDebounceWaitMs = Math.max(0, Date.now() - finalizedAt);
      const sttFinalAvgConfidence =
        pendingFinalConfidenceCount > 0
          ? Number((pendingFinalConfidenceSum / pendingFinalConfidenceCount).toFixed(4))
          : undefined;
      pendingFinalUtterance = "";
      pendingFinalFirstAt = null;
      pendingFinalLastAt = null;
      pendingFinalSegments = 0;
      pendingFinalConfidenceSum = 0;
      pendingFinalConfidenceCount = 0;
      if (!userText || callEnded) return;
      const timing: LegacyTurnTiming = {
        ingressStartedAt: pendingUtteranceIngressAt,
        sttFinalizedAt: finalizedAt,
        sttFinalSegments,
        sttFinalAssemblyMs,
        sttFinalDebounceWaitMs,
        sttAssembledChars: userText.length,
        sttFinalAvgConfidence,
      };
      logger.info("stt final utterance assembled", {
        callId: session.id,
        flushReason,
        sttFinalSegments,
        sttFinalAssemblyMs,
        sttFinalDebounceWaitMs,
        sttFinalAvgConfidence,
        chars: userText.length,
      });

      if (isProcessing) {
        pendingUtterance = pendingUtterance ? `${pendingUtterance} ${userText}` : userText;
        pendingTurnTiming = mergeTurnTiming(pendingTurnTiming, timing);
        pendingUtteranceIngressAt = pendingTurnTiming.ingressStartedAt;
        pendingUtteranceSttFinalAt = pendingTurnTiming.sttFinalizedAt;
        pendingUtteranceBufferedAt = pendingUtteranceBufferedAt ?? Date.now();
        logger.debug("turn in progress, buffering utterance", {
          callId: session.id,
          chars: userText.length,
          sttFinalSegments,
        });
        return;
      }

      pendingUtteranceIngressAt = null;
      pendingUtteranceSttFinalAt = null;
      pendingTurnTiming = null;
      pendingUtteranceBufferedAt = null;
      await processTurn(userText, sttStreamRef, timing);
    };

    // 2b. Process initial utterance if provided (e.g. from IVR text input)
    if (initialUtterance && initialUtterance.trim().length > 0 && initialUtterance !== "I need to book an appointment") {
      this.throwIfAborted(signal);
      const response = await session.receiveUserStreaming(
        initialUtterance,
        async (sentence: string) => {
          appendSentence("initial", sentence);
        },
        {
          ingressStartedAt: Date.now(),
          sttFinalizedAt: Date.now(),
        },
      );
      flushAssembler("initial", true);
      clearAssemblerState("initial");
      void pumpTtsQueue();
      if (response.type === "end") {
        await session.cleanup();
        if (bridgeConnection) bridgeConnection.close();
        return;
      }
    }

    try {
      // Create a dummy connection for STT if no bridge (required by startStream signature)
      const sttConnection = bridgeConnection ?? { callId: session.id } as RtpBridgeConnection;

      const sttStream = await stt.startStream(
        sttConnection,
        async (segment: TranscriptSegment) => {
          if (callEnded) return;

          const trimmedSegmentText = segment.text.trim();
          if (trimmedSegmentText.length > 0) {
            // Any speech activity (partial or final) resets the silence timeout.
            lastActivityAt = Date.now();
            if (pendingUtteranceIngressAt === null) {
              pendingUtteranceIngressAt = segment.timestamp || Date.now();
            }
            // Only interrupt TTS when we are confident the caller is really speaking:
            // on a final, or on a substantial partial once TTS has been playing long
            // enough that it's unlikely to be tts echo / throat-clearing.
            const isSubstantialPartial =
              !segment.isFinal && trimmedSegmentText.length > 8 && hasTtsPlayingSince(400);
            if (segment.isFinal || isSubstantialPartial) {
              interruptLegacyTts(segment.isFinal ? "caller_speaking_final" : "caller_speaking_partial");
            }
          }

          // Accumulate partial transcripts (for future barge-in support)
          if (!segment.isFinal) {
            transcriptBuffer = segment.text;
            logger.debug("partial transcript", { callId: session.id, text: segment.text });
            return;
          }

          const userText = segment.text.trim();
          if (userText.length === 0) return;

          // Deepgram can finalize one thought in multiple short segments.
          // Debounce finals so we send one coherent user turn to the LLM.
          pendingFinalUtterance = pendingFinalUtterance
            ? `${pendingFinalUtterance} ${userText}`
            : userText;
          const finalAt = segment.timestamp || Date.now();
          if (pendingFinalFirstAt === null) {
            pendingFinalFirstAt = finalAt;
          }
          pendingFinalLastAt = finalAt;
          pendingFinalSegments += 1;
          if (typeof segment.confidence === "number") {
            pendingFinalConfidenceSum += segment.confidence;
            pendingFinalConfidenceCount += 1;
          }
          pendingUtteranceSttFinalAt = finalAt;
          clearPendingFinalTimer();
          const debounceMs = computeAdaptiveDebounceMs(userText, segment.confidence);
          pendingFinalTimer = setTimeout(() => {
            void flushPendingFinalUtterance(sttStream, "debounce_timeout");
          }, debounceMs);
        }
      );

      // Silence detection: prompt if no caller activity for SILENCE_PROMPT_MS.
      // Also skip while the agent is still speaking (ttsQueue draining) or mid-turn.
      const silenceCheck = setInterval(async () => {
        if (callEnded || isProcessing) return;
        if (ttsQueueBusy || ttsQueue.length > 0) return;
        if (Date.now() - lastActivityAt < SILENCE_PROMPT_MS) return;
        if (transcriptBuffer.trim().length > 0 || pendingFinalUtterance.trim().length > 0) return;

        if (silencePromptCount >= MAX_SILENCE_PROMPTS) {
          logger.info("max silence prompts reached, ending call", { callId: session.id });
          callEnded = true;
          sttStream.close();
          return;
        }

        silencePromptCount++;
        const idleForMs = Date.now() - lastActivityAt;
        lastActivityAt = Date.now();
        const prompt = silencePromptCount === 1
          ? "Are you still there?"
          : "I'll let you go — have a great day, goodbye!";
        logger.info("silence prompt", {
          callId: session.id,
          attempt: silencePromptCount,
          prompt,
          idleForMs,
          ttsQueueDepth: ttsQueue.length,
          ttsQueueBusy,
        });
        logger.info("system prompt emitted", {
          callId: session.id,
          source: "silence_monitor",
          activeAgent: session.getCurrentAgentName(),
          textPreview: prompt,
        });
        if (tts) {
          try {
            const ttsStart = Date.now();
            await this.synthesizeAndSend(tts, prompt, mediaSession, bridgeConnection,
              (chars, seconds) => session.addTtsUsage(chars, seconds), signal);
            traceLog.autoMessage(session.id, "silence_prompt", prompt, Date.now() - ttsStart);
          } catch {
            // non-fatal
          }
        }
        if (silencePromptCount >= MAX_SILENCE_PROMPTS) {
          callEnded = true;
          sttStream.close();
        }
      }, silenceCheckIntervalMs);

      // Pipe audio from bridge → STT
      if (bridgeConnection) {
        bridgeConnection.onAudio((frame) => {
          sttStream.write(frame);
          mediaSession.markCallerFrame(frame.payload.length);
        });
      }

      // Keep loop alive until call ends, signal aborted, or timeout
      await new Promise<void>((resolve) => {
        const maxCallDuration =
          (session.context.agentConfig.maxCallDurationSec ?? env.LEGACY_DEFAULT_MAX_CALL_DURATION_SEC) * 1000;
        const timeout = setTimeout(() => {
          logger.warn("call timeout reached", { callId: session.id, maxCallDuration });
          callEnded = true;
          clearInterval(silenceCheck);
          clearPendingFinalTimer();
          sttStream.close();
          resolve();
        }, maxCallDuration);

        if (signal) {
          signal.addEventListener("abort", () => {
            logger.info("call aborted by signal", { callId: session.id });
            clearTimeout(timeout);
            callEnded = true;
            clearInterval(silenceCheck);
            clearPendingFinalTimer();
            sttStream.close();
            resolve();
          });
        }

        // Poll for callEnded flag
        const check = setInterval(() => {
          if (callEnded) {
            clearTimeout(timeout);
            clearInterval(check);
            clearInterval(silenceCheck);
            clearPendingFinalTimer();
            resolve();
          }
        }, Math.max(50, env.LEGACY_CALL_END_POLL_INTERVAL_MS));
      });
    } catch (error) {
      logger.error("dialogue loop error", {
        callId: session.id,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      callEnded = true;
      ttsQueueGeneration++;
      ttsQueue.length = 0;
      for (const state of turnAssembler.values()) {
        if (state.flushTimer) clearTimeout(state.flushTimer);
      }
      turnAssembler.clear();
      turnTtsMetrics.clear();
      if (bridgeConnection) bridgeConnection.close();
      logger.info("legacy call timing summary", {
        callId: session.id,
        turns: session.getTurnCount(),
        p50_ingress_to_stt_final_ms: percentile(callLatencyMetrics.ingressToSttFinalMs, 50),
        p95_ingress_to_stt_final_ms: percentile(callLatencyMetrics.ingressToSttFinalMs, 95),
        p95_stt_final_to_run_request_ms: percentile(callLatencyMetrics.sttFinalToRunRequestMs, 95),
        p95_run_request_to_first_text_ms: percentile(callLatencyMetrics.runRequestToFirstTextMs, 95),
        p95_first_text_to_first_tts_ms: percentile(callLatencyMetrics.firstTextToFirstTtsMs, 95),
        p95_turn_total_ms: percentile(callLatencyMetrics.turnTotalMs, 95),
        p95_tts_queue_wait_ms: percentile(callLatencyMetrics.ttsQueueWaitMs, 95),
        p95_tts_first_byte_ms: percentile(callLatencyMetrics.ttsFirstByteMs, 95),
        p95_tts_synthesis_ms: percentile(callLatencyMetrics.ttsSynthesisMs, 95),
        p95_stt_final_segments_per_turn: percentile(callLatencyMetrics.sttFinalSegments, 95),
        p95_stt_buffered_while_processing_ms: percentile(callLatencyMetrics.bufferedWhileProcessingMs, 95),
      });
      traceLog.callEnd(session.id, { turns: session.getTranscript().length });
      await session.cleanup();
      logger.info("dialogue loop ended", { callId: session.id, turns: session.getTranscript().length });
    }
  }

  private async handleDialogueRealtime(
    session: CallSession,
    initialUtterance: string,
    mediaSession: MediaSession,
    bridgeConnection: RtpBridgeConnection | null,
    tts: ReturnType<typeof createTtsProvider> | null,
    signal?: AbortSignal,
  ): Promise<void> {
    let sentenceIndex = 0;

    try {
      const restored = await sessionStore.getRealtimeConversationState(session.id);
      const shouldGreet = !restored || restored.transcript.length === 0;
      const greetingText =
        (session.context.agentConfig as unknown as { greetingMessage?: string }).greetingMessage ||
        "Hello! Thanks for calling. How can I help you today?";

      if (shouldGreet) {
        session.markRealtimeAgentTurn(greetingText);
        if (tts && greetingText.trim().length > 0) {
          const ttsStart = Date.now();
          await this.synthesizeAndSend(
            tts,
            greetingText,
            mediaSession,
            bridgeConnection,
            (chars, seconds) => session.addTtsUsage(chars, seconds),
            signal,
          );
          traceLog.autoMessage(session.id, "greeting", greetingText, Date.now() - ttsStart);
        }
      }

      const stopReason = await runRealtimeConversation({
        session,
        bridgeConnection,
        initialUtterance,
        signal,
        maxCallDurationMs:
          (session.context.agentConfig.maxCallDurationSec ?? env.LEGACY_DEFAULT_MAX_CALL_DURATION_SEC) * 1000,
        onCallerAudioBytes: (bytes) => mediaSession.markCallerFrame(bytes),
        onSentence: async (sentence) => {
          if (!tts) return;
          const synthesisMs = await this.synthesizeAndSend(
            tts,
            sentence,
            mediaSession,
            bridgeConnection,
            (chars, seconds) => session.addTtsUsage(chars, seconds),
            signal,
          );
          traceLog.ttsSentence(session.id, "", sentenceIndex++, sentence.length, synthesisMs);
        },
        onTurnDiagnostics: (diagnostics) => {
          persistCallEvent({
            callId: session.id,
            orgId: session.context.orgId,
            eventType: "turn_diagnostic",
            payload: diagnostics,
          }).catch((err) =>
            logger.warn("turn diagnostics persistence failed", {
              callId: session.id,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        },
      });

      logger.info("realtime dialogue loop ended", {
        callId: session.id,
        reason: stopReason,
        turns: session.getTurnCount(),
      });
    } catch (error) {
      logger.error("realtime dialogue loop error", {
        callId: session.id,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (bridgeConnection) bridgeConnection.close();
      traceLog.callEnd(session.id, { turns: session.getTranscript().length });
      await session.cleanup();
    }
  }

  private async publishCallStarted(params: {
    session: CallSession;
    did: string;
    orgId: string;
    phoneConfig: PhoneNumberConfig;
    callerNumber?: string;
  }) {
    const { session, did, orgId, phoneConfig, callerNumber } = params;
    await this.deps.events.callStarted({
      orgId,
      callId: session.id,
      did,
      businessId: phoneConfig.businessId,
      routeType: phoneConfig.routeType,
      agentConfigId: phoneConfig.agentConfigId,
      agentConfigVersion: this.deps.cache.getAgent(phoneConfig.agentConfigId!)?.version,
      startedAt: session.context.startedAt.toISOString()
    });

    // Persist to Postgres via platform-api
    persistCallStart({
      callId: session.id,
      orgId,
      phoneNumber: did,
      callerNumber: callerNumber ?? "unknown",
      agentConfigId: phoneConfig.agentConfigId,
      agentConfigVer: this.deps.cache.getAgent(phoneConfig.agentConfigId!)?.version,
      startedAt: session.context.startedAt.toISOString(),
    }).catch(err => logger.warn("call-start persistence failed", { error: (err as Error).message }));
  }

  private async publishCallEnded(
    session: CallSession,
    mediaSession: MediaSession,
    overrides?: { endReason?: CallEndReason; outcome?: CallEndedPayload["outcome"] }
  ): Promise<void> {
    const stats = mediaSession.stop();
    const usage = session.getUsageSnapshot();
    usage.callDurationSec = Math.ceil(stats.durationMs / 1000);

    await this.deps.events.callEnded({
      orgId: session.context.orgId,
      callId: session.id,
      did: session.context.phoneNumberConfig.did,
      businessId: session.context.businessId,
      routeType: session.context.phoneNumberConfig.routeType,
      agentConfigId: session.context.agentConfig.id,
      agentConfigVersion: session.context.agentConfig.version,
      startedAt: stats.startedAt,
      endedAt: stats.endedAt,
      durationMs: stats.durationMs,
      endReason: overrides?.endReason ?? "normal_completion",
      outcome: overrides?.outcome ?? "handled",
      usage
    });

    // Persist call end + transcript to Postgres via platform-api
    const transcript = session.getTranscript();
    const transcriptLines: TranscriptLine[] = transcript.map((entry, idx) => ({
      sequence: idx + 1,
      speaker: entry.from,
      text: entry.text,
      spokenAt: entry.timestamp ?? new Date().toISOString(),
    }));

    const sm = session.getStateMachine().current;

    persistCallEnd({
      callId: session.id,
      orgId: session.context.orgId,
      endReason: overrides?.endReason ?? "normal_completion",
      outcome: overrides?.outcome ?? "handled",
      durationSec: usage.callDurationSec,
      classifiedIntent: sm?.activeIntent ?? undefined,
      intentConfidence: sm?.intentConfidence ?? undefined,
      finalIntent: sm?.activeIntent ?? undefined,
      slotsCollected: sm?.slots,
      turnCount: session.getTurnCount(),
      llmTokensIn: usage.llmInputTokens,
      llmTokensOut: usage.llmOutputTokens,
      ttsChars: usage.ttsCharacters,
      sttSeconds: usage.sttSeconds,
      transcript: transcriptLines,
    }).catch(err => logger.warn("call-end persistence failed", { error: (err as Error).message }));
  }

  private routeToFallback(reason: string, phoneConfig?: PhoneNumberConfig) {
    logger.info("falling back", {
      reason,
      fallbackQueue: phoneConfig?.queueExtension,
      fallbackRoute: phoneConfig?.routeType ?? "voicemail"
    });
  }

  private async persistFallbackFailure(
    callId: string | undefined,
    orgId: string,
    failureType: string,
    endReason: "error" | "timeout" | "quota_denied"
  ): Promise<void> {
    if (!callId) return;
    await persistCallEnd({
      callId,
      orgId,
      endReason,
      outcome: "failed",
      failureType,
      durationSec: 0,
      turnCount: 0,
      transcript: [],
    }).catch((err) => logger.warn("fallback call-end persistence failed", { callId, error: (err as Error).message }));
  }

  /**
   * Synthesize TTS and send audio through bridge back to caller.
   * Returns synthesis duration in ms, or 0 if synthesis failed.
   */
  private async synthesizeAndSend(
    tts: ReturnType<typeof createTtsProvider>,
    text: string,
    mediaSession: MediaSession,
    bridgeConnection: RtpBridgeConnection | null,
    usageCb: (chars: number, seconds: number) => void,
    signal?: AbortSignal,
    dispatchGuard?: () => boolean,
    onDispatchMetrics?: (metrics: TtsDispatchMetrics) => void,
  ): Promise<number> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      this.throwIfAborted(signal);
      const synthStart = Date.now();
      let totalBytes = 0;
      let firstChunkAt: number | null = null;
      let dispatchAborted = false;
      let chunkCount = 0;
      let bridgeDispatchMs = 0;
      try {
        for await (const chunk of tts.synthesizeStream(
          text,
          { outputFormat: "ulaw_8000" },
          { signal },
        )) {
          if (dispatchGuard && !dispatchGuard()) {
            dispatchAborted = true;
            break;
          }
          if (firstChunkAt === null) {
            firstChunkAt = Date.now();
          }
          totalBytes += chunk.length;
          chunkCount += 1;
          const sendStartedAt = Date.now();
          if (bridgeConnection) {
            bridgeConnection.sendAudio({
              payload: chunk,
              timestamp: Date.now(),
            });
          }
          bridgeDispatchMs += Date.now() - sendStartedAt;
          mediaSession.markAgentFrame(chunk.length);
        }

        const synthesisMs = Date.now() - synthStart;
        const dispatchMetrics: TtsDispatchMetrics = {
          synthesisMs,
          firstByteMs: firstChunkAt !== null ? firstChunkAt - synthStart : undefined,
          bytes: totalBytes,
          chunkCount,
          bridgeDispatchMs,
          dispatchAborted,
          attempt,
        };
        onDispatchMetrics?.(dispatchMetrics);
        if (dispatchAborted || totalBytes === 0) {
          return synthesisMs;
        }

        usageCb(text.length, totalBytes / 8000);
        logger.info("tts stream dispatched", {
          textLen: text.length,
          bytes: totalBytes,
          chunks: chunkCount,
          synthesisMs,
          firstByteMs: firstChunkAt !== null ? firstChunkAt - synthStart : undefined,
          bridgeDispatchMs,
          dispatchAborted,
          attempt,
        });
        return synthesisMs;
      } catch (err) {
        if (signal?.aborted) {
          throw err;
        }
        const failureDurationMs = Date.now() - synthStart;
        onDispatchMetrics?.({
          synthesisMs: failureDurationMs,
          firstByteMs: firstChunkAt !== null ? firstChunkAt - synthStart : undefined,
          bytes: totalBytes,
          chunkCount,
          bridgeDispatchMs,
          dispatchAborted,
          attempt,
        });
        if (attempt === 2) {
          logger.warn("tts stream synthesis failed, falling back to text only", {
            error: (err as Error).message,
            bytesBeforeFailure: totalBytes,
            chunkCount,
            failureDurationMs,
            firstByteMs: firstChunkAt !== null ? firstChunkAt - synthStart : undefined,
          });
        }
      }
    }
    return 0;
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      const err = new Error("caller_hangup");
      err.name = "CallerHangup";
      throw err;
    }
  }
}
