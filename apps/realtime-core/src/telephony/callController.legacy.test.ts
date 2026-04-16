import test from "node:test";
import assert from "node:assert/strict";
import {
  computeAdaptiveDebounceMs,
  isShortLeadIn,
  percentile,
  sanitizeTransferNarration,
} from "./callController";

test("sanitizeTransferNarration rewrites transfer boilerplate", () => {
  const text = "Sure, I’ll get you over to the right specialist now. One moment, please.";
  const sanitized = sanitizeTransferNarration(text);
  assert.equal(sanitized, "Sure, I can help with that.");
});

test("isShortLeadIn identifies acknowledgements", () => {
  assert.equal(isShortLeadIn("Got it."), true);
  assert.equal(isShortLeadIn("Absolutely."), true);
  assert.equal(isShortLeadIn("Thanks for calling today."), false);
});

test("computeAdaptiveDebounceMs lowers debounce for confident punctuation", () => {
  const punctuated = computeAdaptiveDebounceMs("That sounds great.", 0.91);
  const shortNoPunctuation = computeAdaptiveDebounceMs("yeah", 0.7);
  assert.ok(punctuated <= shortNoPunctuation);
  assert.ok(punctuated >= 160);
});

test("percentile returns expected p95", () => {
  const value = percentile([10, 20, 30, 40, 50], 95);
  assert.equal(value, 50);
});
