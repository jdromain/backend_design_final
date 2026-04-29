import { createLogger } from "@rezovo/logging";
import { AudioFrame, RtpBridgeConnection } from "./rtpBridgeClient";
import WebSocket from "ws";
import { env } from "../env";

const logger = createLogger({ service: "realtime-core", module: "sttClient" });

export interface SttConfig {
  provider: "deepgram" | "whisper" | "mock";
  apiKey?: string;
  model?: string;
  endpointingMs?: number;
  utteranceEndMs?: number;
}

export interface TranscriptSegment {
  text: string;
  isFinal: boolean;
  confidence?: number;
  timestamp: number;
}

export class SttClient {
  private provider: string;
  private apiKey?: string;
  private model: string;
  private endpointingMs?: number;
  private utteranceEndMs?: number;

  constructor(config: SttConfig) {
    this.provider = config.provider;
    this.apiKey = config.apiKey;
    this.model = config.model || "general";
    this.endpointingMs = config.endpointingMs;
    this.utteranceEndMs = config.utteranceEndMs;
  }

  async startStream(
    connection: RtpBridgeConnection,
    onTranscript: (segment: TranscriptSegment) => void
  ): Promise<SttStream> {
    if (this.provider === "mock") {
      logger.info("starting mock STT stream", { callId: connection.callId });
      return new MockSttStream(onTranscript);
    }

    if (this.provider === "deepgram") {
      if (!this.apiKey) {
        throw new Error("Deepgram API key required");
      }
      logger.info("starting Deepgram STT stream", { callId: connection.callId, model: this.model });
      return new DeepgramSttStream(connection.callId, this.apiKey, this.model, onTranscript, {
        endpointingMs: this.endpointingMs,
        utteranceEndMs: this.utteranceEndMs,
      });
    }

    throw new Error(`Unsupported STT provider: ${this.provider}`);
  }
}

export interface SttStream {
  write(frame: AudioFrame): void;
  close(): void;
}

class MockSttStream implements SttStream {
  private onTranscript: (segment: TranscriptSegment) => void;
  private buffer: string = "";

  constructor(onTranscript: (segment: TranscriptSegment) => void) {
    this.onTranscript = onTranscript;
  }

  write(frame: AudioFrame): void {
    // Mock: emit fake transcripts every ~3 seconds of audio
    this.buffer += frame.payload.toString("hex").slice(0, 10);
    if (this.buffer.length > 100) {
      this.onTranscript({
        text: "This is a mock transcription of caller audio.",
        isFinal: true,
        confidence: 0.95,
        timestamp: Date.now()
      });
      this.buffer = "";
    }
  }

  close(): void {
    logger.info("mock STT stream closed");
  }
}

class DeepgramSttStream implements SttStream {
  private callId: string;
  private apiKey: string;
  private model: string;
  private onTranscript: (segment: TranscriptSegment) => void;
  private ws: WebSocket | null = null;
  private isConnected = false;
  private partialBuffer = "";
  private framesSent = 0;
  private bytesSent = 0;
  private endpointingMs: number;
  private utteranceEndMs: number;
  private readonly createdAt = Date.now();
  private connectedAt: number | null = null;
  private firstAudioFrameAt: number | null = null;
  private firstTranscriptAt: number | null = null;
  private firstFinalAt: number | null = null;
  private partialCount = 0;
  private finalCount = 0;
  private framesDroppedBeforeReady = 0;
  private closeRequestedAt: number | null = null;
  private summaryLogged = false;

  constructor(
    callId: string,
    apiKey: string,
    model: string,
    onTranscript: (segment: TranscriptSegment) => void,
    opts?: { endpointingMs?: number; utteranceEndMs?: number },
  ) {
    this.callId = callId;
    this.apiKey = apiKey;
    this.model = model;
    this.onTranscript = onTranscript;
    const requestedEndpointingMs = Math.floor(opts?.endpointingMs ?? env.LEGACY_STT_ENDPOINTING_MS);
    const requestedUtteranceEndMs = Math.floor(opts?.utteranceEndMs ?? env.LEGACY_STT_UTTERANCE_END_MS);
    this.endpointingMs = Math.max(120, Math.min(1500, requestedEndpointingMs));
    // Deepgram rejects sub-1000 utterance_end_ms for this WS setup.
    this.utteranceEndMs = Math.max(1000, Math.min(3000, requestedUtteranceEndMs));
    if (this.utteranceEndMs !== requestedUtteranceEndMs) {
      logger.warn("adjusted invalid utterance_end_ms for Deepgram", {
        requestedUtteranceEndMs,
        appliedUtteranceEndMs: this.utteranceEndMs,
      });
    }
    this.connect();
  }

  private logSummary(reason: string): void {
    if (this.summaryLogged) return;
    this.summaryLogged = true;

    const now = Date.now();
    logger.info("Deepgram stream summary", {
      callId: this.callId,
      reason,
      model: this.model,
      uptimeMs: now - this.createdAt,
      connectMs: this.connectedAt !== null ? this.connectedAt - this.createdAt : undefined,
      firstAudioMs:
        this.firstAudioFrameAt !== null ? this.firstAudioFrameAt - this.createdAt : undefined,
      firstTranscriptFromAudioMs:
        this.firstAudioFrameAt !== null && this.firstTranscriptAt !== null
          ? this.firstTranscriptAt - this.firstAudioFrameAt
          : undefined,
      firstFinalFromAudioMs:
        this.firstAudioFrameAt !== null && this.firstFinalAt !== null
          ? this.firstFinalAt - this.firstAudioFrameAt
          : undefined,
      partialCount: this.partialCount,
      finalCount: this.finalCount,
      framesSent: this.framesSent,
      bytesSent: this.bytesSent,
      framesDroppedBeforeReady: this.framesDroppedBeforeReady,
      closeRequestedMs:
        this.closeRequestedAt !== null ? Math.max(0, this.closeRequestedAt - this.createdAt) : undefined,
    });
  }

  private connect(): void {
    try {
      // Deepgram WebSocket streaming API with optimized params for low latency
      // CRITICAL: Twilio Media Streams send mulaw @ 8kHz
      const url = `wss://api.deepgram.com/v1/listen?` + new URLSearchParams({
        model: this.model,
        encoding: "mulaw",             // Match Twilio's mu-law encoding
        sample_rate: "8000",
        channels: "1",
        punctuate: "true",
        interim_results: "true",       // Enable partial results
        endpointing: String(this.endpointingMs),
        utterance_end_ms: String(this.utteranceEndMs),
        vad_events: "true"
      }).toString();

      this.ws = new WebSocket(url, {
        headers: {
          Authorization: `Token ${this.apiKey}`,
        }
      });

      this.ws.on("open", () => {
        this.connectedAt = Date.now();
        this.isConnected = true;
        logger.info("Deepgram WebSocket connected", {
          callId: this.callId,
          model: this.model,
          endpointingMs: this.endpointingMs,
          utteranceEndMs: this.utteranceEndMs,
          connectMs: this.connectedAt - this.createdAt,
        });
      });

      this.ws.on("message", (data: WebSocket.Data) => {
        try {
          const result = JSON.parse(data.toString());
          
          // Handle transcript results
          if (result.channel?.alternatives?.[0]?.transcript) {
            const transcript = result.channel.alternatives[0].transcript;
            const isFinal = result.is_final === true;
            const confidence = result.channel.alternatives[0].confidence;

            // Skip empty transcripts
            if (transcript.trim().length === 0) return;
            const now = Date.now();
            if (this.firstTranscriptAt === null) {
              this.firstTranscriptAt = now;
              logger.info("stt first transcript received", {
                callId: this.callId,
                model: this.model,
                isFinal,
                chars: transcript.length,
                fromConnectMs:
                  this.connectedAt !== null ? now - this.connectedAt : undefined,
                fromFirstAudioMs:
                  this.firstAudioFrameAt !== null ? now - this.firstAudioFrameAt : undefined,
              });
            }
            if (isFinal && this.firstFinalAt === null) {
              this.firstFinalAt = now;
              logger.info("stt first final transcript received", {
                callId: this.callId,
                model: this.model,
                chars: transcript.length,
                confidence,
                fromConnectMs:
                  this.connectedAt !== null ? now - this.connectedAt : undefined,
                fromFirstAudioMs:
                  this.firstAudioFrameAt !== null ? now - this.firstAudioFrameAt : undefined,
              });
            }
            if (isFinal) this.finalCount += 1;
            else this.partialCount += 1;

            // Emit transcript segment
            this.onTranscript({
              text: transcript,
              isFinal,
              confidence,
              timestamp: now,
            });

            if (isFinal) {
              logger.debug("Final transcript", {
                callId: this.callId,
                chars: transcript.length,
                confidence,
                finalCount: this.finalCount,
              });
              this.partialBuffer = "";
            } else {
              // Partial result - useful for early LLM triggering
              this.partialBuffer = transcript;
              logger.debug("Partial transcript", {
                callId: this.callId,
                chars: transcript.length,
                confidence,
                partialCount: this.partialCount,
              });
            }
          }

          // Handle VAD events (voice activity detection)
          if (result.speech_final === true) {
            logger.debug("Speech ended (VAD)", {
              callId: this.callId,
              duration: result.duration,
            });
          }

        } catch (err) {
          logger.error("Failed to parse Deepgram message", {
            callId: this.callId,
            error: (err as Error).message,
          });
        }
      });

      this.ws.on("error", (err) => {
        logger.error("Deepgram WebSocket error", { callId: this.callId, error: err.message });
        this.isConnected = false;
      });

      this.ws.on("close", () => {
        logger.info("Deepgram WebSocket closed", {
          callId: this.callId,
          finalCount: this.finalCount,
          partialCount: this.partialCount,
        });
        this.logSummary(this.closeRequestedAt !== null ? "client_close" : "socket_close");
        this.isConnected = false;
      });

    } catch (err) {
      logger.error("Failed to connect to Deepgram", {
        callId: this.callId,
        error: (err as Error).message,
      });
      this.logSummary("connect_failure");
      this.isConnected = false;
    }
  }

  write(frame: AudioFrame): void {
    if (this.firstAudioFrameAt === null) {
      this.firstAudioFrameAt = Date.now();
    }
    if (this.ws && this.isConnected && this.ws.readyState === 1) { // 1 = OPEN
      try {
        // Send raw mulaw audio to Deepgram
        this.ws.send(frame.payload);
        this.framesSent++;
        this.bytesSent += frame.payload.length;
        
        // Throttled logging: only log every 50th frame (~1 second @ 20ms frames)
        if (this.framesSent % 50 === 0) {
          logger.debug("stt_audio_progress", {
            callId: this.callId,
            frames: this.framesSent, 
            bytes: this.bytesSent 
          });
        }
      } catch (err) {
        logger.error("Failed to send audio to Deepgram", {
          callId: this.callId,
          error: (err as Error).message,
        });
      }
      return;
    }

    this.framesDroppedBeforeReady += 1;
    if (this.framesDroppedBeforeReady === 1 || this.framesDroppedBeforeReady % 250 === 0) {
      logger.debug("stt audio dropped before stream ready", {
        callId: this.callId,
        droppedFrames: this.framesDroppedBeforeReady,
      });
    }
  }

  close(): void {
    this.closeRequestedAt = Date.now();
    if (this.ws) {
      try {
        // Send close message to finalize any pending transcripts
        if (this.ws.readyState === 1) { // 1 = OPEN
          this.ws.send(JSON.stringify({ type: "CloseStream" }));
        }
        this.ws.close();
      } catch (err) {
        logger.error("Error closing Deepgram stream", {
          callId: this.callId,
          error: (err as Error).message,
        });
      }
      this.ws = null;
      this.isConnected = false;
      return;
    }

    this.logSummary("close_without_socket");
  }
}
