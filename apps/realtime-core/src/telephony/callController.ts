import { createLogger } from "@rezovo/logging";
import { ConfigCache } from "../config-cache/cache";
import { fetchConfigSnapshot } from "../config-cache/fetcher";
import { CallEndReason, CallEndedPayload, PhoneNumberConfig } from "@rezovo/core-types";
import { EventPublisher } from "../events/eventPublisher";
import { CallSession } from "../orchestrator/callSession";
import { createTtsProvider } from "../media/ttsElevenLabs";
import { BillingQuotaClient } from "../billingClient";
import { MediaSession, RtpBridgeClient, RtpBridgeConnection } from "../media/rtpBridgeClient";
import { SttClient, TranscriptSegment } from "../media/sttClient";
import { persistCallStart, persistCallEnd, persistCallEvent, TranscriptLine } from "../callPersistence";
import { env } from "../env";
import { traceLog } from "../traceLog";

const logger = createLogger({ service: "realtime-core", module: "callController" });

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
        ? createTtsProvider({ apiKey: this.deps.elevenApiKey, voiceId: this.deps.elevenVoiceId })
        : null;

    // Initialize STT client using env object
    const stt = new SttClient({
      provider: env.STT_PROVIDER,
      apiKey: env.STT_API_KEY,
      model: env.STT_MODEL,
    });

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

    // 1. Send greeting
    this.throwIfAborted(signal);
    const greet = session.greet();
    if (tts && greet.type === "speak") {
      const ttsStart = Date.now();
      await this.synthesizeAndSend(tts, greet.text, mediaSession, bridgeConnection,
        (chars, seconds) => session.addTtsUsage(chars, seconds), signal);
      traceLog.autoMessage(session.id, "greeting", greet.text, Date.now() - ttsStart);
    }

    // 2. Process initial utterance if provided (e.g. from IVR text input)
    if (initialUtterance && initialUtterance.trim().length > 0 && initialUtterance !== "I need to book an appointment") {
      this.throwIfAborted(signal);
      const response = await session.receiveUserStreaming(
        initialUtterance,
        async (sentence: string) => {
          if (tts) {
            await this.synthesizeAndSend(tts, sentence, mediaSession, bridgeConnection,
              (chars, seconds) => session.addTtsUsage(chars, seconds), signal);
          }
        }
      );
      if (response.type === "handoff" || response.type === "end") {
        await session.cleanup();
        if (bridgeConnection) bridgeConnection.close();
        return;
      }
    }

    // 3. START CONVERSATIONAL LOOP — STT ↔ LLM ↔ TTS
    let transcriptBuffer = "";
    let isProcessing = false;
    let callEnded = false;
    let pendingUtterance: string | null = null;

    // Silence detection state
    let lastActivityAt = Date.now();
    const SILENCE_PROMPT_MS = 8_000;
    const MAX_SILENCE_PROMPTS = 2;
    let silencePromptCount = 0;

    const processTurn = async (userText: string, sttStreamRef: { close: () => void }) => {
      isProcessing = true;
      lastActivityAt = Date.now();
      silencePromptCount = 0;
      traceLog.sttFinal(session.id, userText);
      logger.info("processing user utterance", { callId: session.id, text: userText });
      let sentenceIndex = 0;
      try {
        const response = await session.receiveUserStreaming(
          userText,
          async (sentence: string) => {
            if (tts && !callEnded) {
              const synthesisMs = await this.synthesizeAndSend(
                tts, sentence, mediaSession, bridgeConnection,
                (chars, seconds) => session.addTtsUsage(chars, seconds), signal
              );
              traceLog.ttsSentence(session.id, "", sentenceIndex++, sentence.length, synthesisMs);
            }
          }
        );

        const turnDiagnostics = session.getLastTurnDiagnostics();
        if (turnDiagnostics) {
          persistCallEvent({
            callId: session.id,
            orgId: session.context.orgId,
            eventType: "turn_diagnostic",
            payload: turnDiagnostics,
          }).catch((err) => logger.warn("turn diagnostics persistence failed", {
            callId: session.id,
            error: err instanceof Error ? err.message : String(err),
          }));
        }

        if (response.type === "handoff" || response.type === "end") {
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
          pendingUtterance = null;
          await processTurn(next, sttStreamRef);
        }
      }
    };

    try {
      // Create a dummy connection for STT if no bridge (required by startStream signature)
      const sttConnection = bridgeConnection ?? { callId: session.id } as RtpBridgeConnection;

      const sttStream = await stt.startStream(
        sttConnection,
        async (segment: TranscriptSegment) => {
          // Accumulate partial transcripts (for future barge-in support)
          if (!segment.isFinal) {
            transcriptBuffer = segment.text;
            logger.debug("partial transcript", { callId: session.id, text: segment.text });
            return;
          }

          lastActivityAt = Date.now();

          if (callEnded) return;

          const userText = segment.text.trim();
          if (userText.length === 0) return;

          if (isProcessing) {
            // Buffer the most recent utterance — will be drained after current turn finishes
            pendingUtterance = userText;
            logger.debug("turn in progress, buffering utterance", { callId: session.id, text: userText });
            return;
          }

          await processTurn(userText, sttStream);
        }
      );

      // Silence detection: prompt if no caller activity for SILENCE_PROMPT_MS
      const silenceCheck = setInterval(async () => {
        if (callEnded || isProcessing) return;
        if (Date.now() - lastActivityAt < SILENCE_PROMPT_MS) return;

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
          sttStream.close();
          resolve();
        }, maxCallDuration);

        if (signal) {
          signal.addEventListener("abort", () => {
            logger.info("call aborted by signal", { callId: session.id });
            clearTimeout(timeout);
            callEnded = true;
            clearInterval(silenceCheck);
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
      if (bridgeConnection) bridgeConnection.close();
      traceLog.callEnd(session.id, { turns: session.getTranscript().length });
      await session.cleanup();
      logger.info("dialogue loop ended", { callId: session.id, turns: session.getTranscript().length });
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
    signal?: AbortSignal
  ): Promise<number> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      this.throwIfAborted(signal);
      try {
        const synthStart = Date.now();
        const audio = await tts.synthesize(text, { outputFormat: "ulaw_8000" });
        const synthesisMs = Date.now() - synthStart;
        mediaSession.markAgentFrame(audio.audio.length);
        usageCb(text.length, audio.audio.length / 32000);

        // Send audio back through bridge → Twilio → caller
        if (bridgeConnection) {
          bridgeConnection.sendAudio({
            payload: audio.audio,
            timestamp: Date.now(),
          });
        }
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
