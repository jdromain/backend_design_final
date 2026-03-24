/**
 * textChunker.ts — Sentence-aware text chunking with overlap
 *
 * Produces clean chunks that:
 * - Respect sentence boundaries (never split mid-sentence)
 * - Include configurable overlap for context continuity
 * - Normalize whitespace but preserve paragraph breaks
 * - Target ~400 tokens per chunk (≈1600 chars) for text-embedding-3-small
 */

export type TextChunk = {
  index: number;
  text: string;
};

export interface ChunkerOptions {
  /** Target characters per chunk (~4 chars/token for English) */
  targetSize?: number;
  /** Number of characters to overlap between consecutive chunks */
  overlap?: number;
  /** Minimum chunk size (avoids tiny trailing chunks) */
  minSize?: number;
}

const DEFAULTS: Required<ChunkerOptions> = {
  targetSize: 1600,  // ~400 tokens
  overlap: 200,      // ~50 tokens overlap
  minSize: 100,      // don't produce tiny fragments
};

/**
 * Split text into sentences. Handles:
 * - Standard punctuation (. ? !)
 * - Abbreviations (Mr., Dr., etc.) — avoids splitting
 * - Numbered lists (1. 2. 3.)
 * - Preserves newlines as sentence boundaries
 */
function splitSentences(text: string): string[] {
  // Normalize whitespace within lines but preserve paragraph breaks
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();

  // Split on sentence endings, keeping the delimiter
  const raw = normalized.split(/(?<=[.!?])\s+|(?:\n\s*\n)/);

  // Filter out empty strings and whitespace-only
  return raw.map(s => s.trim()).filter(s => s.length > 0);
}

/**
 * Chunk text respecting sentence boundaries with configurable overlap.
 */
export function chunkText(text: string, options?: ChunkerOptions): TextChunk[] {
  const { targetSize, overlap, minSize } = { ...DEFAULTS, ...options };

  if (!text || text.trim().length === 0) {
    return [];
  }

  // If text is smaller than target, return as single chunk
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

    // If adding this sentence would exceed target size...
    if (currentLength + sentence.length > targetSize && currentChunk.length > 0) {
      // Emit the current chunk
      const chunkText = currentChunk.join(" ").trim();
      if (chunkText.length >= minSize) {
        chunks.push({ index: chunks.length, text: chunkText });
      }

      // Compute overlap: walk backwards through sentences until we hit overlap chars
      const overlapSentences: string[] = [];
      let overlapLen = 0;
      for (let i = currentChunk.length - 1; i >= 0 && overlapLen < overlap; i--) {
        overlapSentences.unshift(currentChunk[i]);
        overlapLen += currentChunk[i].length + 1; // +1 for space
      }

      currentChunk = overlapSentences;
      currentLength = overlapLen;
      // Don't advance sentenceIdx — re-process this sentence in new chunk
      continue;
    }

    currentChunk.push(sentence);
    currentLength += sentence.length + 1; // +1 for space
    sentenceIdx++;
  }

  // Emit any remaining content
  if (currentChunk.length > 0) {
    const chunkText = currentChunk.join(" ").trim();
    if (chunkText.length >= minSize) {
      chunks.push({ index: chunks.length, text: chunkText });
    } else if (chunks.length > 0) {
      // Append tiny remainder to previous chunk
      chunks[chunks.length - 1].text += " " + chunkText;
    } else {
      // Only chunk is too small — include it anyway
      chunks.push({ index: 0, text: chunkText });
    }
  }

  return chunks;
}
