type VoiceSettings = {
  stability?: number;
  similarity_boost?: number;
  style?: number;
  use_speaker_boost?: boolean;
};

export type TtsRequest = {
  text: string;
  voiceId: string;
  modelId?: string;
  voiceSettings?: VoiceSettings;
  outputFormat?: "mp3_44100_128" | "pcm_16000" | "pcm_22050" | "pcm_24000" | "ulaw_8000";
};

export type TtsResponse = {
  audio: Buffer;
  contentType: string;
};

export class ElevenLabsClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = "https://api.elevenlabs.io/v1") {
    if (!apiKey) {
      throw new Error("ElevenLabs API key is required");
    }
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async synthesize(req: TtsRequest): Promise<TtsResponse> {
    const modelId = req.modelId ?? "eleven_flash_v2_5";
    const outputFormat = req.outputFormat ?? "mp3_44100_128";
    const url = `${this.baseUrl}/text-to-speech/${req.voiceId}?output_format=${outputFormat}`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": this.apiKey,
        "Content-Type": "application/json",
        Accept: outputFormat.startsWith("mp3") ? "audio/mpeg" : "application/octet-stream"
      },
      body: JSON.stringify({
        text: req.text,
        model_id: modelId,
        voice_settings: req.voiceSettings ?? {}
      })
    });

    if (!res.ok) {
      const msg = await safeError(res);
      throw new Error(`TTS failed: ${res.status} ${res.statusText} - ${msg}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return {
      audio: Buffer.from(arrayBuffer),
      contentType: res.headers.get("content-type") ?? "audio/mpeg"
    };
  }
}

async function safeError(res: Response): Promise<string> {
  try {
    const txt = await res.text();
    return txt.slice(0, 500);
  } catch {
    return "";
  }
}
