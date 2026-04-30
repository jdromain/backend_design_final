/** Shared TTS / narration helpers for voice paths (legacy, realtime, agents). */

const SHORT_LEAD_INS = new Set([
  "got it.",
  "got it!",
  "thanks.",
  "thank you.",
  "thank you!",
  "perfect.",
  "great.",
  "sure.",
  "okay.",
  "ok.",
  "absolutely.",
  "of course.",
]);

/**
 * Replaces model boilerplate that leaks "transfer to specialist" style phrasing
 * (voice-safe, short).
 */
export function sanitizeTransferNarration(text: string): string {
  let out = text;
  out = out.replace(
    /\b(i('|\u2019)ll|let me|i can|we can)\s+(get|connect|transfer|route|put)\s+you(\s+(over|through|with|to))?\s+(to\s+)?(the\s+)?(right\s+)?(specialist|team|agent|department|person)(\s+now)?[.!]?/gi,
    "I can help with that.",
  );
  out = out.replace(
    /\b(i('|\u2019)m|we('|\u2019)re)\s+(transferring|connecting|routing)\s+you(\s+(now|over|through|to\s+the\s+(right\s+)?(specialist|team|agent|department|person)))?[.!]?/gi,
    "I can help with that.",
  );
  out = out.replace(/\bone moment,\s*please[.!]?/gi, "");
  const cleaned = out.replace(/\s{2,}/g, " ").trim();
  return cleaned.length > 0 ? cleaned : "I can help with that.";
}

export function isShortLeadIn(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return normalized.length > 0 && normalized.length <= 14 && SHORT_LEAD_INS.has(normalized);
}
