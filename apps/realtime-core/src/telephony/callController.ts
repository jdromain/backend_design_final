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
  const base = Math.max(160, Math.min(900, env.LEGACY_FINAL_DEBOUNCE_MS));
  const trimmed = text.trim();

  if (/[.!?]$/.test(trimmed)) {
    return Math.max(160, Math.min(320, Math.floor(base * 0.8)));
  }
  if (typeof confidence === "number" && confidence >= 0.9) {
    return Math.max(160, Math.min(300, Math.floor(base * 0.85)));
  }
  if (trimmed.length < 24) {
    return Math.max(220, Math.min(420, Math.floor(base * 1.2)));
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
    let endReason: CallEndReason = "agent_end";
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
      }
    >();

    const clearAssemblerState = (turnKey: string): void => {
      const state = turnAssembler.get(turnKey);
      if (!state) return;
      if (state.flushTimer) clearTimeout(state.flushTimer);
      turnAssembler.delete(turnKey);
    };

    const getTurnMetrics = (turnKey: string) => {
      const existing = turnTtsMetrics.get(turnKey);
      if (existing) return existing;
      const created = { chunksDispatched: 0, queueWaitSamples: [], firstTtsAt: null };
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
      if (now - lastBargeClearAt < 220) return;
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

          const synthesisMs = await this.synthesizeAndSend(
            tts,
            next.text,
            mediaSession,
            bridgeConnection,
            (chars, seconds) => session.addTtsUsage(chars, seconds),
            signal,
            () => next.generation === ttsQueueGeneration && !callEnded,
          );
          if (synthesisMs <= 0) continue;

          const sentenceIndex = metrics.chunksDispatched;
          metrics.chunksDispatched += 1;
          traceLog.ttsSentence(session.id, next.turnKey, sentenceIndex, next.text.length, synthesisMs);
        }
      } finally {
        ttsQueueBusy = false;
      }
    };

    // 3. START CONVERSATIONAL LOOP — STT ↔ LLM ↔ TTS
    let transcriptBuffer = "";
    let isProcessing = false;
    let pendingUtterance: string | null = null;
    let pendingUtteranceIngressAt: number | null = null;
    let pendingUtteranceSttFinalAt: number | null = null;

    // Silence detection state
    let lastActivityAt = Date.now();
    const SILENCE_PROMPT_MS = 8_000;
    const MAX_SILENCE_PROMPTS = 2;
    let silencePromptCount = 0;
    let pendingFinalUtterance = "";
    let pendingFinalTimer: ReturnType<typeof setTimeout> | null = null;

    const processTurn = async (
      userText: string,
      sttStreamRef: { close: () => void },
      timing?: { ingressStartedAt: number | null; sttFinalizedAt: number },
    ) => {
      isProcessing = true;
      lastActivityAt = Date.now();
      silencePromptCount = 0;
      const turnKey = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      traceLog.sttFinal(session.id, userText);
      logger.info("processing user utterance", { callId: session.id, text: userText });
      logger.info("turn processing started", {
        callId: session.id,
        activeAgent: session.getCurrentAgentName(),
        utterancePreview: userText.slice(0, 220),
        turnKey,
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
          const enriched: TurnDiagnostics = {
            ...turnDiagnostics,
            first_text_delta_to_first_tts_ms:
              typeof turnDiagnostics.run_request_to_first_text_ms === "number" &&
              typeof turnDiagnostics.stt_final_to_run_request_ms === "number" &&
              timing?.sttFinalizedAt &&
              ttsMetrics.firstTtsAt !== null
                ? Math.max(
                    0,
                    ttsMetrics.firstTtsAt -
                      (timing.sttFinalizedAt +
                        turnDiagnostics.stt_final_to_run_request_ms +
                        turnDiagnostics.run_request_to_first_text_ms),
                  )
                : turnDiagnostics.first_text_delta_to_first_tts_ms,
            chunks_synthesized: ttsMetrics.chunksDispatched,
            tts_chunks_per_turn: ttsMetrics.chunksDispatched,
            queue_wait_p95_ms: queueWaitP95,
          };
          persistCallEvent({
            callId: session.id,
            orgId: session.context.orgId,
            eventType: "turn_diagnostic",
            payload: enriched,
          }).catch((err) => logger.warn("turn diagnostics persistence failed", {
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
          const nextIngressAt = pendingUtteranceIngressAt;
          const nextSttFinalAt = pendingUtteranceSttFinalAt;
          pendingUtterance = null;
          pendingUtteranceIngressAt = null;
          pendingUtteranceSttFinalAt = null;
          await processTurn(next, sttStreamRef, {
            ingressStartedAt: nextIngressAt,
            sttFinalizedAt: nextSttFinalAt ?? Date.now(),
          });
        }
      }
    };

    const clearPendingFinalTimer = () => {
      if (!pendingFinalTimer) return;
      clearTimeout(pendingFinalTimer);
      pendingFinalTimer = null;
    };

    const flushPendingFinalUtterance = async (sttStreamRef: { close: () => void }) => {
      const userText = pendingFinalUtterance.trim();
      pendingFinalUtterance = "";
      if (!userText || callEnded) return;
      const timing = {
        ingressStartedAt: pendingUtteranceIngressAt,
        sttFinalizedAt: Date.now(),
      };

      if (isProcessing) {
        pendingUtterance = pendingUtterance ? `${pendingUtterance} ${userText}` : userText;
        pendingUtteranceIngressAt = timing.ingressStartedAt;
        pendingUtteranceSttFinalAt = timing.sttFinalizedAt;
        logger.debug("turn in progress, buffering utterance", { callId: session.id, text: userText });
        return;
      }

      pendingUtteranceIngressAt = null;
      pendingUtteranceSttFinalAt = null;
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

          if (segment.text.trim().length > 0) {
            // Any speech activity (partial or final) should reset silence timeout.
            lastActivityAt = Date.now();
            if (pendingUtteranceIngressAt === null) {
              pendingUtteranceIngressAt = Date.now();
            }
            interruptLegacyTts("caller_speaking");
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
          clearPendingFinalTimer();
          const debounceMs = computeAdaptiveDebounceMs(userText, segment.confidence);
          pendingFinalTimer = setTimeout(() => {
            void flushPendingFinalUtterance(sttStream);
          }, debounceMs);
        }
      );

      // Silence detection: prompt if no caller activity for SILENCE_PROMPT_MS
      const silenceCheck = setInterval(async () => {
        if (callEnded || isProcessing) return;
        if (Date.now() - lastActivityAt < SILENCE_PROMPT_MS) return;
        if (transcriptBuffer.trim().length > 0 || pendingFinalUtterance.trim().length > 0) return;

        if (silencePromptCount >= MAX_SILENCE_PROMPTS) {
          logger.info("max silence prompts reached, ending call", { callId: session.id });
          callEnded = true;
          sttStream.close();
          return;
        }

        silencePromptCount++;
        lastActivityAt = Date.now();
        const prompt = silencePromptCount === 1
          ? "Are you still there?"
          : "I'll let you go — have a great day, goodbye!";
        logger.info("silence prompt", { callId: session.id, attempt: silencePromptCount, prompt });
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
      }, 2_000);

      // Pipe audio from bridge → STT
      if (bridgeConnection) {
        bridgeConnection.onAudio((frame) => {
          sttStream.write(frame);
          mediaSession.markCallerFrame(frame.payload.length);
        });
      }

      // Keep loop alive until call ends, signal aborted, or timeout
      await new Promise<void>((resolve) => {
        const maxCallDuration = (session.context.agentConfig.maxCallDurationSec ?? 1800) * 1000;
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
        }, 200);
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
        maxCallDurationMs: (session.context.agentConfig.maxCallDurationSec ?? 1800) * 1000,
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
      endReason: overrides?.endReason ?? "agent_end",
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
      endReason: overrides?.endReason ?? "agent_end",
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
  ): Promise<number> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      this.throwIfAborted(signal);
      try {
        const synthStart = Date.now();
        const audio = await tts.synthesize(text, { outputFormat: "ulaw_8000" });
        const synthesisMs = Date.now() - synthStart;
        if (dispatchGuard && !dispatchGuard()) {
          return synthesisMs;
        }

        // Send audio back through bridge → Twilio → caller
        if (bridgeConnection) {
          bridgeConnection.sendAudio({
            payload: audio.audio,
            timestamp: Date.now(),
          });
        }
        mediaSession.markAgentFrame(audio.audio.length);
        usageCb(text.length, audio.audio.length / 32000);
        return synthesisMs;
      } catch (err) {
        if (attempt === 2) {
          logger.warn("tts synthesis failed, falling back to text only", { error: (err as Error).message });
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
