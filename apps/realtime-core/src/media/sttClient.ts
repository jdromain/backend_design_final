import { createLogger } from "@rezovo/logging";
import { AudioFrame, RtpBridgeConnection } from "./rtpBridgeClient";
import WebSocket from "ws";

const logger = createLogger({ service: "realtime-core", module: "sttClient" });

export interface SttConfig {
  provider: "deepgram" | "whisper" | "mock";
  apiKey?: string;
  model?: string;
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

  constructor(config: SttConfig) {
    this.provider = config.provider;
    this.apiKey = config.apiKey;
    this.model = config.model || "general";
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
      return new DeepgramSttStream(this.apiKey, this.model, onTranscript);
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
  private apiKey: string;
  private model: string;
  private onTranscript: (segment: TranscriptSegment) => void;
  private ws: WebSocket | null = null;
  private isConnected = false;
  private partialBuffer = '';
  private framesSent = 0;
  private bytesSent = 0;

  constructor(apiKey: string, model: string, onTranscript: (segment: TranscriptSegment) => void) {
    this.apiKey = apiKey;
    this.model = model;
    this.onTranscript = onTranscript;
    this.connect();
  }

  private connect(): void {
    try {
      // Deepgram WebSocket streaming API with optimized params for low latency
      // CRITICAL: Twilio Media Streams send mulaw @ 8kHz
      const url = `wss://api.deepgram.com/v1/listen?` + new URLSearchParams({
        model: this.model,
        encoding: 'mulaw',             // ✅ FIXED: Match Twilio's μ-law encoding
        sample_rate: '8000',           // ✅ Correct: 8kHz
        channels: '1',
        punctuate: 'true',
        interim_results: 'true',       // KEY: Enable partial results
        endpointing: '700',            // Less aggressive split of natural pauses
        utterance_end_ms: '1500',      // Finalize after longer silence window
        vad_events: 'true'             // Voice activity detection events
      }).toString();

      this.ws = new WebSocket(url, {
        headers: {
          Authorization: `Token ${this.apiKey}`
        }
      });

      this.ws.on('open', () => {
        this.isConnected = true;
        logger.info('Deepgram WebSocket connected', { model: this.model });
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const result = JSON.parse(data.toString());
          
          // Handle transcript results
          if (result.channel?.alternatives?.[0]?.transcript) {
            const transcript = result.channel.alternatives[0].transcript;
            const isFinal = result.is_final === true;
            const confidence = result.channel.alternatives[0].confidence;

            // Skip empty transcripts
            if (transcript.trim().length === 0) return;

            // Emit transcript segment
            this.onTranscript({
              text: transcript,
              isFinal,
              confidence,
              timestamp: Date.now()
            });

            if (isFinal) {
              logger.debug('Final transcript', { text: transcript, confidence });
              this.partialBuffer = '';
            } else {
              // Partial result - useful for early LLM triggering
              this.partialBuffer = transcript;
              logger.debug('Partial transcript', { text: transcript, confidence });
            }
          }

          // Handle VAD events (voice activity detection)
          if (result.speech_final === true) {
            logger.debug('Speech ended (VAD)', { duration: result.duration });
          }

        } catch (err) {
          logger.error('Failed to parse Deepgram message', { error: (err as Error).message });
        }
      });

      this.ws.on('error', (err) => {
        logger.error('Deepgram WebSocket error', { error: err.message });
        this.isConnected = false;
      });

      this.ws.on('close', () => {
        logger.info('Deepgram WebSocket closed');
        this.isConnected = false;
      });

    } catch (err) {
      logger.error('Failed to connect to Deepgram', { error: (err as Error).message });
      this.isConnected = false;
    }
  }

  write(frame: AudioFrame): void {
    if (this.ws && this.isConnected && this.ws.readyState === 1) { // 1 = OPEN
      try {
        // Send raw mulaw audio to Deepgram
        this.ws.send(frame.payload);
        this.framesSent++;
        this.bytesSent += frame.payload.length;
        
        // Throttled logging: only log every 50th frame (~1 second @ 20ms frames)
        if (this.framesSent % 50 === 0) {
          logger.debug('stt_audio_progress', { 
            frames: this.framesSent, 
            bytes: this.bytesSent 
          });
        }
      } catch (err) {
        logger.error('Failed to send audio to Deepgram', { error: (err as Error).message });
      }
    }
  }

  close(): void {
    if (this.ws) {
      try {
        // Send close message to finalize any pending transcripts
        if (this.ws.readyState === 1) { // 1 = OPEN
          this.ws.send(JSON.stringify({ type: 'CloseStream' }));
        }
        this.ws.close();
      } catch (err) {
        logger.error('Error closing Deepgram stream', { error: (err as Error).message });
      }
      this.ws = null;
      this.isConnected = false;
    }
  }
}
