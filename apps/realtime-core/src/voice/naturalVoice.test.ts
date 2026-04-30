/**
 * Asserts quality of caller-facing prompt strings and silence ladder copy.
 * Does not scan arbitrary source for banned substrings.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  BASE_VOICE_CONTRACT,
  buildResponseInstructions,
} from "../orchestrator/openai-agents/agents";
import type { CallContext } from "../orchestrator/openai-agents/agents";
import {
  pickFirstSilencePrompt,
  pickSecondSilencePrompt,
  SILENCE_FINAL_FAREWELL,
  SILENCE_FIRST_OPTIONS,
  SILENCE_SECOND_OPTIONS,
} from "./silencePrompts";
import { VOICE_SAFER_REPHRASE } from "./callerPhrases";

const bannedInCallerDirectives: RegExp[] = [
  /\bclassified intent\b/i,
  /\bworkflow issue\b/i,
  /the tool returned/i,
  /\broute this\b/i,
  /\bbooking specialist\b/i,
  /\bas an ai\b/i,
  /are you still there\?/i,
];

const minimalContext = (over: Partial<CallContext> = {}): CallContext => ({
  orgId: "org",
  businessId: "biz",
  callId: "call-1",
  currentDateTime: new Date().toISOString(),
  agentBasePrompt: "Test org.",
  kbPassages: [],
  slotMemory: {},
  pendingAction: null,
  approvedActionHash: null,
  approvalGateState: "none",
  ...over,
});

test("BASE_VOICE_CONTRACT avoids internal/banned phrasing for callers", () => {
  for (const re of bannedInCallerDirectives) {
    assert.equal(re.test(BASE_VOICE_CONTRACT), false, `unexpected match ${re} in BASE_VOICE_CONTRACT`);
  }
  assert.match(BASE_VOICE_CONTRACT, /one question at a time/i);
  assert.match(BASE_VOICE_CONTRACT, /one or two short/i);
  assert.match(BASE_VOICE_CONTRACT, /interrupted/i);
  assert.match(BASE_VOICE_CONTRACT, /do not invent|do not guess/i);
});

test("buildResponseInstructions never injects 'Specialist' for model role line", () => {
  const names = [
    "Receptionist",
    "Booking Specialist",
    "Cancellation Specialist",
    "Customer Care Specialist",
    "Information Specialist",
  ] as const;
  for (const n of names) {
    const s = buildResponseInstructions(minimalContext(), n);
    assert.equal(/\bSpecialist\b/i.test(s), false, `expected no Specialist in: ${s}`);
  }
  assert.match(buildResponseInstructions(minimalContext(), "Receptionist"), /receptionist/i);
});

test("silence first/second pools do not use default robotic 'Are you still there?'", () => {
  for (const line of SILENCE_FIRST_OPTIONS) {
    assert.notEqual(line.toLowerCase(), "are you still there?");
  }
  for (const id of [
    "a",
    "b",
    "call-123",
    "00000000-0000-0000-0000-000000000000",
  ]) {
    const a = pickFirstSilencePrompt(id);
    const b = pickSecondSilencePrompt(id);
    assert.equal(/are you still there\?/i.test(a), false);
    assert.equal(/are you still there\?/i.test(b), false);
    assert.notEqual(a, b);
  }
});

test("final silence line is a natural farewell (not the old default)", () => {
  assert.match(SILENCE_FINAL_FAREWELL, /let you go|call back/i);
  assert.equal(/are you still there\?/i.test(SILENCE_FINAL_FAREWELL), false);
});

test("VOICE_SAFER_REPHRASE is short and not robotic apology template", () => {
  assert.equal(VOICE_SAFER_REPHRASE.includes("I apologize"), false);
  assert.ok(VOICE_SAFER_REPHRASE.length < 80);
});
