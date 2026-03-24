import { createLogger } from "@rezovo/logging";

const logger = createLogger({ service: "realtime-core", module: "vad" });

// Define AudioFrame interface locally
interface AudioFrame {
  payload: Buffer;
  timestamp?: number;
}

export interface VadResult {
  isSpeaking: boolean;
  endOfSpeech: boolean;
  energy?: number;
}

/**
 * Adaptive Voice Activity Detection
 * Detects when user is speaking and when they've finished
 * Uses adaptive thresholds based on speech duration
 */
export class AdaptiveVad {
  private energyThreshold: number;
  private silenceDuration = 0;
  private speakingDuration = 0;
  private isSpeaking = false;
  private shortUtteranceThreshold: number;
  private longUtteranceThreshold: number;
  private backgroundNoise = -50; // dB, will be adapted
  private noiseBuffer: number[] = [];
  private readonly noiseBufferSize = 20;

  constructor(options?: {
    energyThreshold?: number;
    shortUtteranceThreshold?: number;
    longUtteranceThreshold?: number;
  }) {
    this.energyThreshold = options?.energyThreshold ?? -40; // dB
    this.shortUtteranceThreshold = options?.shortUtteranceThreshold ?? 500; // ms
    this.longUtteranceThreshold = options?.longUtteranceThreshold ?? 250; // ms
  }

  /**
   * Process an audio frame and detect voice activity
   * @param audioFrame PCM audio frame (typically 20ms)
   * @returns VAD result indicating if user is speaking or has finished
   */
  detectEndOfSpeech(audioFrame: AudioFrame): VadResult {
    const energy = this.calculateEnergy(audioFrame.payload);
    
    // Update background noise estimate during silence
    if (energy < this.energyThreshold) {
      this.noiseBuffer.push(energy);
      if (this.noiseBuffer.length > this.noiseBufferSize) {
        this.noiseBuffer.shift();
      }
      this.backgroundNoise = this.average(this.noiseBuffer);
    }

    // Adaptive threshold: background noise + margin
    const adaptiveThreshold = this.backgroundNoise + 10; // 10dB above noise floor

    if (energy > Math.max(this.energyThreshold, adaptiveThreshold)) {
      // User is speaking
      this.silenceDuration = 0;
      this.speakingDuration += 20; // Assuming 20ms frames
      this.isSpeaking = true;

      return {
        isSpeaking: true,
        endOfSpeech: false,
        energy
      };
    } else {
      // Silence detected
      this.silenceDuration += 20;

      // Adaptive threshold based on speech length
      let dynamicThreshold: number;
      
      if (this.speakingDuration < 1000) {
        // Short utterance: wait longer (might be pausing)
        dynamicThreshold = this.shortUtteranceThreshold;
      } else {
        // Long utterance: wait less (likely finished)
        dynamicThreshold = this.longUtteranceThreshold;
      }

      if (this.silenceDuration > dynamicThreshold && this.isSpeaking) {
        // End of speech detected
        logger.debug("End of speech detected", {
          speakingDuration: this.speakingDuration,
          silenceDuration: this.silenceDuration,
          threshold: dynamicThreshold
        });

        this.reset();
        
        return {
          isSpeaking: false,
          endOfSpeech: true,
          energy
        };
      }

      return {
        isSpeaking: false,
        endOfSpeech: false,
        energy
      };
    }
  }

  /**
   * Calculate RMS energy of audio frame in dB
   */
  private calculateEnergy(audioBuffer: Buffer): number {
    let sum = 0;
    const sampleCount = audioBuffer.length / 2; // 16-bit samples

    for (let i = 0; i < audioBuffer.length; i += 2) {
      const sample = audioBuffer.readInt16LE(i);
      sum += sample * sample;
    }

    const rms = Math.sqrt(sum / sampleCount);
    
    // Convert to dB (with protection against log(0))
    const db = rms > 0 ? 20 * Math.log10(rms / 32768) : -100;
    
    return db;
  }

  private average(values: number[]): number {
    if (values.length === 0) return -50;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  reset(): void {
    this.silenceDuration = 0;
    this.speakingDuration = 0;
    this.isSpeaking = false;
  }

  getState() {
    return {
      isSpeaking: this.isSpeaking,
      speakingDuration: this.speakingDuration,
      silenceDuration: this.silenceDuration,
      backgroundNoise: this.backgroundNoise
    };
  }
}

/**
 * Barge-in handler: Detects when user interrupts AI speech
 */
export class BargeInDetector {
  private vad: AdaptiveVad;
  private isAiSpeaking = false;
  private onBargeIn?: () => void;

  constructor(options?: { energyThreshold?: number }) {
    // More sensitive VAD for barge-in (user might speak quieter to interrupt)
    this.vad = new AdaptiveVad({
      energyThreshold: options?.energyThreshold ?? -45, // 5dB more sensitive
      shortUtteranceThreshold: 200, // React quickly to interruptions
      longUtteranceThreshold: 200
    });
  }

  /**
   * Set AI speaking state
   */
  setAiSpeaking(speaking: boolean): void {
    this.isAiSpeaking = speaking;
    if (!speaking) {
      this.vad.reset();
    }
  }

  /**
   * Register callback for when barge-in is detected
   */
  onBargeInDetected(callback: () => void): void {
    this.onBargeIn = callback;
  }

  /**
   * Process audio frame and detect barge-in
   */
  processFrame(audioFrame: AudioFrame): boolean {
    if (!this.isAiSpeaking) {
      return false;
    }

    const vadResult = this.vad.detectEndOfSpeech(audioFrame);

    if (vadResult.isSpeaking) {
      logger.info("Barge-in detected", {
        energy: vadResult.energy,
        aiWasSpeaking: this.isAiSpeaking
      });

      // User started speaking while AI is talking
      if (this.onBargeIn) {
        this.onBargeIn();
      }

      this.isAiSpeaking = false;
      return true;
    }

    return false;
  }

  reset(): void {
    this.vad.reset();
    this.isAiSpeaking = false;
  }
}







