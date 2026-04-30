import test from "node:test";
import assert from "node:assert/strict";
import { computeAdaptiveDebounceMs } from "./callController";

test("computeAdaptiveDebounceMs is capped by VOICE_LEGACY_FINAL_DEBOUNCE_MAX_MS (default 420)", () => {
  const long = "a".repeat(200);
  const ms = computeAdaptiveDebounceMs(long, 0.5);
  assert.ok(ms <= 420, `expected cap <= 420, got ${ms}`);
  assert.ok(ms >= 120);
});

test("computeAdaptiveDebounceMs stays responsive for short punctuated final", () => {
  const ms = computeAdaptiveDebounceMs("What time do you open?", 0.95);
  assert.ok(ms <= 420);
  assert.ok(ms >= 160);
});
