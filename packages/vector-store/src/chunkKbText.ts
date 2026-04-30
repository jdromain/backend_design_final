/**
 * Sentence-aware KB chunking (kept in sync with apps/jobs/src/textChunker.ts).
 */
export type TextChunk = { index: number; text: string };

export interface ChunkerOptions {
  targetSize?: number;
  overlap?: number;
  minSize?: number;
}

const DEFAULTS: Required<ChunkerOptions> = {
  targetSize: 1600,
  overlap: 200,
  minSize: 100,
};

function splitSentences(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  const raw = normalized.split(/(?<=[.!?])\s+|(?:\n\s*\n)/);
  return raw.map((s) => s.trim()).filter((s) => s.length > 0);
}

export function chunkText(text: string, options?: ChunkerOptions): TextChunk[] {
  const { targetSize, overlap, minSize } = { ...DEFAULTS, ...options };

  if (!text || text.trim().length === 0) {
    return [];
  }

  if (text.length <= targetSize) {
    return [{ index: 0, text: text.trim() }];
  }

  const sentences = splitSentences(text);
  if (sentences.length === 0) {
    return [{ index: 0, text: text.trim() }];
  }

  const chunks: TextChunk[] = [];
  let currentChunk: string[] = [];
  let currentLength = 0;
  let sentenceIdx = 0;

  while (sentenceIdx < sentences.length) {
    const sentence = sentences[sentenceIdx];

    if (sentence.length > targetSize) {
      if (currentChunk.length > 0) {
        const chunkT = currentChunk.join(" ").trim();
        if (chunkT.length >= minSize) {
          chunks.push({ index: chunks.length, text: chunkT });
        } else if (chunkT.length > 0 && chunks.length > 0) {
          chunks[chunks.length - 1]!.text += " " + chunkT;
        } else {
          chunks.push({ index: chunks.length, text: chunkT });
        }
        currentChunk = [];
        currentLength = 0;
      }
      for (let off = 0; off < sentence.length; off += targetSize) {
        chunks.push({ index: chunks.length, text: sentence.slice(off, off + targetSize) });
      }
      sentenceIdx++;
      continue;
    }

    if (currentLength + sentence.length > targetSize && currentChunk.length > 0) {
      const chunkT = currentChunk.join(" ").trim();
      if (chunkT.length >= minSize) {
        chunks.push({ index: chunks.length, text: chunkT });
      }

      const overlapSentences: string[] = [];
      let overlapLen = 0;
      for (let i = currentChunk.length - 1; i >= 0 && overlapLen < overlap; i--) {
        overlapSentences.unshift(currentChunk[i]!);
        overlapLen += currentChunk[i]!.length + 1;
      }

      currentChunk = overlapSentences;
      currentLength = overlapLen;
      const newJoin = currentChunk.length ? currentChunk.join(" ").trim() : "";
      if (newJoin === chunkT) {
        currentChunk = [];
        currentLength = 0;
      }
      continue;
    }

    currentChunk.push(sentence);
    currentLength += sentence.length + 1;
    sentenceIdx++;
  }

  if (currentChunk.length > 0) {
    const chunkT = currentChunk.join(" ").trim();
    if (chunkT.length >= minSize) {
      chunks.push({ index: chunks.length, text: chunkT });
    } else if (chunks.length > 0) {
      chunks[chunks.length - 1]!.text += " " + chunkT;
    } else {
      chunks.push({ index: 0, text: chunkT });
    }
  }

  return chunks;
}
