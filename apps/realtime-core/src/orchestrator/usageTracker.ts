import { UsageBreakdown } from "@rezovo/core-types";

export class UsageTracker {
  private usage: UsageBreakdown = {
    callDurationSec: 0,
    llmInputTokens: 0,
    llmOutputTokens: 0,
    ttsSeconds: 0,
    ttsCharacters: 0
  };
  private start: number | null = null;

  startTimer() {
    this.start = Date.now();
  }

  stopTimer() {
    if (this.start) {
      const durationMs = Date.now() - this.start;
      this.usage.callDurationSec = Math.ceil(durationMs / 1000);
    }
  }

  addTts(chars: number, seconds: number) {
    this.usage.ttsCharacters = (this.usage.ttsCharacters ?? 0) + chars;
    this.usage.ttsSeconds = (this.usage.ttsSeconds ?? 0) + seconds;
  }

  addLlmTokens(input: number, output: number) {
    this.usage.llmInputTokens = (this.usage.llmInputTokens ?? 0) + input;
    this.usage.llmOutputTokens = (this.usage.llmOutputTokens ?? 0) + output;
  }

  snapshot(): UsageBreakdown {
    return { ...this.usage };
  }
}









