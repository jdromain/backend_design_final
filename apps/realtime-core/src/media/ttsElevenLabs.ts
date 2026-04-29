import { createLogger } from "@rezovo/logging";
import { ElevenLabsClient, TtsRequest, TtsResponse } from "@rezovo/voice-elevenlabs";

const logger = createLogger({ service: "realtime-core", module: "tts-elevenlabs" });

export type TtsOverrides = Partial<Omit<TtsRequest, "text" | "voiceId">>;

export function createTtsProvider(params: { apiKey: string; voiceId: string; modelId?: string }) {
  const client = new ElevenLabsClient(params.apiKey);
  const voiceId = params.voiceId;
  const modelId = params.modelId;

  const buildRequest = (text: string, overrides?: TtsOverrides): TtsRequest => ({
    text,
    voiceId,
    modelId: overrides?.modelId ?? modelId,
    voiceSettings: overrides?.voiceSettings,
    outputFormat: overrides?.outputFormat,
  });

  return {
    async synthesize(text: string, overrides?: TtsOverrides): Promise<TtsResponse> {
      const startedAt = Date.now();
      const result = await client.synthesize(buildRequest(text, overrides));
      logger.info("tts synthesized", {
        textLen: text.length,
        bytes: result.audio.length,
        durationMs: Date.now() - startedAt,
      });
      return result;
    },

    async *synthesizeStream(
      text: string,
      overrides?: TtsOverrides,
      opts?: { signal?: AbortSignal },
    ): AsyncGenerator<Buffer, void, void> {
      let totalBytes = 0;
      let chunkCount = 0;
      const startedAt = Date.now();
      let firstChunkAt: number | null = null;
      try {
        for await (const chunk of client.synthesizeStream(buildRequest(text, overrides), opts)) {
          totalBytes += chunk.length;
          chunkCount += 1;
          if (firstChunkAt === null) {
            firstChunkAt = Date.now();
            logger.info("tts stream first audio", {
              textLen: text.length,
              firstByteMs: firstChunkAt - startedAt,
              firstChunkBytes: chunk.length,
            });
          }
          yield chunk;
        }
        logger.info("tts stream completed", {
          textLen: text.length,
          bytes: totalBytes,
          chunks: chunkCount,
          durationMs: Date.now() - startedAt,
          firstByteMs: firstChunkAt !== null ? firstChunkAt - startedAt : undefined,
        });
      } catch (err) {
        logger.warn("tts stream error", {
          textLen: text.length,
          bytes: totalBytes,
          chunks: chunkCount,
          durationMs: Date.now() - startedAt,
          firstByteMs: firstChunkAt !== null ? firstChunkAt - startedAt : undefined,
          error: (err as Error).message,
        });
        throw err;
      }
    },
  };
}
