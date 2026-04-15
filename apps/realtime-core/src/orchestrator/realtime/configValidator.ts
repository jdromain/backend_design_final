import type { RealtimeSessionConfig } from "@openai/agents/realtime";

export type RealtimeSessionValidationResult = {
  valid: boolean;
  errors: string[];
};

export function buildRealtimeSessionConfig(): Partial<RealtimeSessionConfig> {
  return {
    outputModalities: ["text"],
    audio: {
      input: {
        format: { type: "audio/pcmu" },
        turnDetection: {
          type: "semantic_vad",
          interruptResponse: true,
          createResponse: false,
        },
      },
    },
  };
}

export function validateRealtimeSessionConfig(config: Partial<RealtimeSessionConfig>): RealtimeSessionValidationResult {
  const errors: string[] = [];

  const outputModalities = (config as { outputModalities?: unknown }).outputModalities;
  if (!Array.isArray(outputModalities) || outputModalities.length === 0) {
    errors.push("outputModalities must be a non-empty array");
  } else {
    const invalid = outputModalities.filter((m) => m !== "text" && m !== "audio");
    if (invalid.length > 0) {
      errors.push(`outputModalities contains unsupported values: ${invalid.join(",")}`);
    }
    if (!outputModalities.includes("text")) {
      errors.push("outputModalities must include 'text'");
    }
  }

  const audio = (config as { audio?: unknown }).audio;
  if (!audio || typeof audio !== "object") {
    errors.push("audio config is required");
    return { valid: false, errors };
  }

  const input = (audio as { input?: unknown }).input;
  if (!input || typeof input !== "object") {
    errors.push("audio.input config is required");
    return { valid: false, errors };
  }

  const format = (input as { format?: unknown }).format;
  if (!format || typeof format !== "object") {
    errors.push("audio.input.format must be provided");
  } else if ((format as { type?: string }).type !== "audio/pcmu") {
    errors.push("audio.input.format.type must be 'audio/pcmu' for Twilio-compatible mu-law ingress");
  }

  const turnDetection = (input as { turnDetection?: unknown }).turnDetection;
  if (!turnDetection || typeof turnDetection !== "object") {
    errors.push("audio.input.turnDetection must be provided");
  } else {
    const td = turnDetection as {
      type?: string;
      interruptResponse?: boolean;
      createResponse?: boolean;
    };

    if (td.type !== "semantic_vad") {
      errors.push("audio.input.turnDetection.type must be 'semantic_vad'");
    }
    if (td.interruptResponse !== true) {
      errors.push("audio.input.turnDetection.interruptResponse must be true");
    }
    if (td.createResponse !== false) {
      errors.push("audio.input.turnDetection.createResponse must be false");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
