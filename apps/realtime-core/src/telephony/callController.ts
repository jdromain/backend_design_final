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
  tenantId: string;
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
    const { callId, did, tenantId, lob, initialUtterance } = args;
    let phoneConfig = this.deps.cache.getRoute(did, tenantId, lob);

    // Lazy hydration: if cache misses, fetch from platform-api for this tenant
    if (!phoneConfig) {
      logger.info("cache miss, fetching config from platform-api", { did, tenantId, lob });
      try {
        const snapshot = await fetchConfigSnapshot(tenantId, lob ?? "default");
        this.deps.cache.replaceFromSnapshot(snapshot);
        phoneConfig = this.deps.cache.getRoute(did, tenantId, lob);
        if (phoneConfig) {
          logger.info("cache hydrated for tenant on demand", { did, tenantId });
        }
      } catch (err) {
        logger.warn("lazy config fetch failed", { error: (err as Error).message, tenantId });
      }
    }

    if (!phoneConfig) {
      logger.warn("no phone config after lazy fetch, routing to voicemail", { did, tenantId, lob });
      this.routeToFallback("missing_config");
      return;
    }
    if (phoneConfig.routeType !== "ai") {
      logger.info("non-ai route, returning early", { did, tenantId, routeType: phoneConfig.routeType });
      this.routeToFallback("non_ai_route", phoneConfig);
      return;
    }

    const agentConfig = this.deps.cache.getAgent(phoneConfig.agentConfigId ?? "");
    if (!agentConfig) {
      logger.warn("missing agent config", { agentConfigId: phoneConfig.agentConfigId });
      this.routeToFallback("missing_agent_config", phoneConfig);
      return;
    }

    try {
      const quota = await this.deps.billing.canStartCall(tenantId);
      if (!quota.allowed) {
        logger.warn("quota denied, routing to voicemail", { tenantId, reason: quota.reason });
        this.routeToFallback("quota_denied", phoneConfig);
        return;
      }
    } catch (err) {
      logger.error("billing quota failed", { error: (err as Error).message });
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
      mediaSession = await this.deps.media.startSession({ callId: session.id, did, tenantId });

      await this.publishCallStarted({ session, did, tenantId, phoneConfig, callerNumber: args.callerNumber });
      callStarted = true;
      traceLog.callStart(session.id, { did, tenantId });

      await this.handleDialogue(session, initialUtterance ?? "I need to book an appointment", mediaSession, ctx?.signal);
    } catch (err) {
      const error = err as Error;
      if (error.name === "CallerHangup") {
        endReason = "caller_hangup";
        outcome = "abandoned";
        logger.info("call aborted by caller", { did, tenantId });
      } else {
        endReason = "error";
        outcome = "failed";
        logger.error("call handling failed", { did, tenantId, error: error.message });
      }
      if (!callStarted) {
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
      await this.synthesizeAndSend(tts, greet.text, mediaSession, bridgeConnection,
        (chars, seconds) => session.addTtsUsage(chars, seconds), signal);
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

          // Final transcript -- stream through agent pipeline with sentence-level TTS
          if (segment.isFinal && !isProcessing && !callEnded) {
            isProcessing = true;
            const userText = segment.text.trim();

            if (userText.length === 0) {
              isProcessing = false;
              return;
            }

            traceLog.sttFinal(session.id, userText);
            logger.info("processing user utterance", { callId: session.id, text: userText });

            try {
              const response = await session.receiveUserStreaming(
                userText,
                async (sentence: string) => {
                  if (tts && !callEnded) {
                    await this.synthesizeAndSend(
                      tts, sentence, mediaSession, bridgeConnection,
                      (chars, seconds) => session.addTtsUsage(chars, seconds), signal
                    );
                  }
                }
              );

              if (response.type === "handoff" || response.type === "end") {
                callEnded = true;
                sttStream.close();
              }
            } catch (error) {
              logger.error("error processing turn", {
                callId: session.id,
                error: error instanceof Error ? error.message : String(error),
              });
            } finally {
              isProcessing = false;
              transcriptBuffer = "";
            }
          }
        }
      );

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
          sttStream.close();
          resolve();
        }, maxCallDuration);

        if (signal) {
          signal.addEventListener("abort", () => {
            logger.info("call aborted by signal", { callId: session.id });
            clearTimeout(timeout);
            callEnded = true;
            sttStream.close();
            resolve();
          });
        }

        // Poll for callEnded flag (set by handleResponse on end/handoff)
        const check = setInterval(() => {
          if (callEnded) {
            clearTimeout(timeout);
            clearInterval(check);
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

  /**
   * Handle an OrchestratorResponse: speak, handoff, or end.
   * Returns true if the call should end.
   */
  private async handleResponse(
    response: { type: string; text?: string; reason?: string },
    tts: ReturnType<typeof createTtsProvider> | null,
    mediaSession: MediaSession,
    bridgeConnection: RtpBridgeConnection | null,
    session: CallSession,
    signal?: AbortSignal
  ): Promise<boolean> {
    if (response.type === "speak" && tts && response.text) {
      await this.synthesizeAndSend(tts, response.text, mediaSession, bridgeConnection,
        (chars, seconds) => session.addTtsUsage(chars, seconds), signal);
      return false;
    }

    if (response.type === "handoff") {
      logger.info("transfer requested", { callId: session.id });
      if (tts) {
        await this.synthesizeAndSend(
          tts, response.text || "Let me connect you with someone right away.",
          mediaSession, bridgeConnection,
          (chars, seconds) => session.addTtsUsage(chars, seconds), signal
        );
      }
      return true;
    }

    if (response.type === "end") {
      logger.info("call ending", { callId: session.id });
      if (tts && response.text) {
        await this.synthesizeAndSend(tts, response.text, mediaSession, bridgeConnection,
          (chars, seconds) => session.addTtsUsage(chars, seconds), signal);
      }
      return true;
    }

    return false;
  }

  private async publishCallStarted(params: {
    session: CallSession;
    did: string;
    tenantId: string;
    phoneConfig: PhoneNumberConfig;
    callerNumber?: string;
  }) {
    const { session, did, tenantId, phoneConfig, callerNumber } = params;
    await this.deps.events.callStarted({
      tenantId,
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
      tenantId,
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
      tenantId: session.context.tenantId,
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
      tenantId: session.context.tenantId,
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

  /**
   * Synthesize TTS and send audio through bridge back to caller.
   */
  private async synthesizeAndSend(
    tts: ReturnType<typeof createTtsProvider>,
    text: string,
    mediaSession: MediaSession,
    bridgeConnection: RtpBridgeConnection | null,
    usageCb: (chars: number, seconds: number) => void,
    signal?: AbortSignal
  ): Promise<void> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      this.throwIfAborted(signal);
      try {
        const audio = await tts.synthesize(text, { outputFormat: "ulaw_8000" });
        mediaSession.markAgentFrame(audio.audio.length);
        usageCb(text.length, audio.audio.length / 32000);

        // Send audio back through bridge → Twilio → caller
        if (bridgeConnection) {
          bridgeConnection.sendAudio({
            payload: audio.audio,
            timestamp: Date.now(),
          });
        }
        return;
      } catch (err) {
        if (attempt === 2) {
          logger.warn("tts synthesis failed, falling back to text only", { error: (err as Error).message });
        }
      }
    }
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      const err = new Error("caller_hangup");
      err.name = "CallerHangup";
      throw err;
    }
  }
}


