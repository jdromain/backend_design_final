export type SentenceExtraction = {
  sentences: string[];
  remainder: string;
};

/**
 * Split streaming text into sentence-sized chunks suitable for low-latency TTS.
 */
export function extractSentenceChunks(buffer: string): SentenceExtraction {
  const sentences: string[] = [];
  let last = 0;

  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i];
    if (ch !== "." && ch !== "!" && ch !== "?") continue;

    const next = buffer[i + 1];
    if (next !== undefined && !/\s/.test(next)) continue;

    const sentence = buffer.slice(last, i + 1).trim();
    if (sentence.length > 0) {
      sentences.push(sentence);
    }

    last = i + 1;
  }

  return {
    sentences,
    remainder: buffer.slice(last),
  };
}
