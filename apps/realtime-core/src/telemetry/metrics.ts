import http from "http";
import { Counter, Registry, Histogram, collectDefaultMetrics } from "prom-client";

const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const callAccepted = new Counter({
  name: "call_accept_total",
  help: "Number of calls accepted for processing",
  registers: [registry]
});

export const callRejected = new Counter({
  name: "call_reject_total",
  help: "Number of calls rejected (quota/concurrency/errors)",
  registers: [registry]
});

export const callFailed = new Counter({
  name: "call_failure_total",
  help: "Number of calls that failed after acceptance",
  registers: [registry]
});

// Latency tracking histograms (in seconds)
export const turnLatency = new Histogram({
  name: "turn_latency_seconds",
  help: "End-to-end latency from user stops speaking to AI starts speaking",
  labelNames: ["stage"],
  buckets: [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 10.0],
  registers: [registry]
});

export const vadLatency = new Histogram({
  name: "vad_latency_seconds",
  help: "Voice Activity Detection latency (silence detection)",
  buckets: [0.1, 0.2, 0.3, 0.4, 0.5, 0.75, 1.0],
  registers: [registry]
});

export const sttLatency = new Histogram({
  name: "stt_latency_seconds",
  help: "Speech-to-Text latency",
  labelNames: ["type"], // "partial" or "final"
  buckets: [0.1, 0.2, 0.3, 0.5, 0.75, 1.0, 1.5, 2.0],
  registers: [registry]
});

export const llmLatency = new Histogram({
  name: "llm_latency_seconds",
  help: "LLM inference latency",
  labelNames: ["type"], // "first_token" or "complete"
  buckets: [0.2, 0.4, 0.6, 0.8, 1.0, 1.5, 2.0, 3.0, 5.0],
  registers: [registry]
});

export const ttsLatency = new Histogram({
  name: "tts_latency_seconds",
  help: "Text-to-Speech latency",
  labelNames: ["type"], // "first_audio" or "complete"
  buckets: [0.1, 0.2, 0.3, 0.5, 0.75, 1.0, 1.5, 2.0],
  registers: [registry]
});

export const toolLatency = new Histogram({
  name: "tool_latency_seconds",
  help: "External tool call latency",
  labelNames: ["tool_name", "status"],
  buckets: [0.1, 0.2, 0.5, 1.0, 1.5, 2.0, 3.0, 5.0],
  registers: [registry]
});

export const streamingActive = new Counter({
  name: "streaming_turns_total",
  help: "Number of turns using streaming pipeline",
  labelNames: ["mode"], // "full_streaming" or "legacy"
  registers: [registry]
});

export function startMetricsServer(port = Number(process.env.METRICS_PORT ?? 9100)): void {
  const server = http.createServer(async (req, res) => {
    if (req.url === "/metrics") {
      const metrics = await registry.metrics();
      res.writeHead(200, { "Content-Type": registry.contentType });
      res.end(metrics);
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`realtime-core metrics server listening on ${port}`);
  });
}

/**
 * Helper class for tracking latency of a conversation turn
 */
export class TurnLatencyTracker {
  private timestamps: Map<string, number> = new Map();

  mark(event: string): void {
    this.timestamps.set(event, Date.now());
  }

  getLatency(from: string, to: string): number | null {
    const start = this.timestamps.get(from);
    const end = this.timestamps.get(to);
    
    if (start === undefined || end === undefined) {
      return null;
    }

    return (end - start) / 1000; // Convert to seconds
  }

  recordAll(): void {
    // VAD latency
    const vadLat = this.getLatency("user_stopped", "vad_complete");
    if (vadLat !== null) {
      vadLatency.observe(vadLat);
    }

    // STT latencies
    const sttPartialLat = this.getLatency("vad_complete", "stt_first_partial");
    if (sttPartialLat !== null) {
      sttLatency.observe({ type: "partial" }, sttPartialLat);
    }

    const sttFinalLat = this.getLatency("vad_complete", "stt_final");
    if (sttFinalLat !== null) {
      sttLatency.observe({ type: "final" }, sttFinalLat);
    }

    // LLM latencies
    const llmFirstTokenLat = this.getLatency("stt_final", "llm_first_token");
    if (llmFirstTokenLat !== null) {
      llmLatency.observe({ type: "first_token" }, llmFirstTokenLat);
    }

    const llmCompleteLat = this.getLatency("stt_final", "llm_complete");
    if (llmCompleteLat !== null) {
      llmLatency.observe({ type: "complete" }, llmCompleteLat);
    }

    // TTS latencies
    const ttsFirstAudioLat = this.getLatency("llm_first_token", "tts_first_audio");
    if (ttsFirstAudioLat !== null) {
      ttsLatency.observe({ type: "first_audio" }, ttsFirstAudioLat);
    }

    const ttsCompleteLat = this.getLatency("llm_complete", "tts_complete");
    if (ttsCompleteLat !== null) {
      ttsLatency.observe({ type: "complete" }, ttsCompleteLat);
    }

    // Total perceived latency (what the user experiences)
    const perceivedLat = this.getLatency("user_stopped", "tts_first_audio");
    if (perceivedLat !== null) {
      turnLatency.observe({ stage: "perceived" }, perceivedLat);
    }

    // Total turn time
    const totalLat = this.getLatency("user_stopped", "tts_complete");
    if (totalLat !== null) {
      turnLatency.observe({ stage: "total" }, totalLat);
    }
  }

  getBreakdown(): Record<string, number | null> {
    return {
      vad: this.getLatency("user_stopped", "vad_complete"),
      stt_partial: this.getLatency("vad_complete", "stt_first_partial"),
      stt_final: this.getLatency("vad_complete", "stt_final"),
      llm_first_token: this.getLatency("stt_final", "llm_first_token"),
      llm_complete: this.getLatency("stt_final", "llm_complete"),
      tts_first_audio: this.getLatency("llm_first_token", "tts_first_audio"),
      tts_complete: this.getLatency("llm_complete", "tts_complete"),
      perceived: this.getLatency("user_stopped", "tts_first_audio"),
      total: this.getLatency("user_stopped", "tts_complete")
    };
  }
}

