import { createLogger } from "@rezovo/logging";
import { ElevenLabsClient, TtsRequest, TtsResponse } from "@rezovo/voice-elevenlabs";

const logger = createLogger({ service: "realtime-core", module: "tts-elevenlabs" });

export function createTtsProvider(params: { apiKey: string; voiceId: string; modelId?: string }) {
  const client = new ElevenLabsClient(params.apiKey);
  const voiceId = params.voiceId;
  const modelId = params.modelId;

  return {
    async synthesize(text: string, overrides?: Partial<Omit<TtsRequest, "text" | "voiceId">>): Promise<TtsResponse> {
      const req: TtsRequest = {
        text,
        voiceId,
        modelId: overrides?.modelId ?? modelId,
        voiceSettings: overrides?.voiceSettings,
        outputFormat: overrides?.outputFormat
      };

      const result = await client.synthesize(req);
      logger.info("tts synthesized", { bytes: result.audio.length });
      return result;
    }
  };
}

