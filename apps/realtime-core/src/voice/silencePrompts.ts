/**
 * Human-sounding silence nudges for phone calls. Pickers are deterministic per
 * `callId` so the line stays consistent within a call, while pools A/B avoid
 * repeating the same “tier” phrasing with different timers.
 */

export const SILENCE_FIRST_OPTIONS = [
  "Take your time.",
  "No rush.",
  "I'm here when you're ready.",
] as const;

export const SILENCE_SECOND_OPTIONS = [
  "Still with me?",
  "I can wait another moment.",
  "Whenever you're ready.",
] as const;

export const SILENCE_FINAL_FAREWELL =
  "I'm going to let you go for now. You can call back anytime.";

function hashPick(callId: string, salt: number, options: readonly string[]): string {
  let h = salt >>> 0;
  for (let i = 0; i < callId.length; i++) {
    h = (h * 31 + callId.charCodeAt(i)) >>> 0;
  }
  return options[h % options.length] ?? options[0];
}

export function pickFirstSilencePrompt(callId: string): string {
  return hashPick(callId, 0x1a2b3c4d, SILENCE_FIRST_OPTIONS);
}

export function pickSecondSilencePrompt(callId: string): string {
  return hashPick(callId, 0x5e6f7081, SILENCE_SECOND_OPTIONS);
}
