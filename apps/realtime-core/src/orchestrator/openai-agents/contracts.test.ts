import test from "node:test";
import assert from "node:assert/strict";
import { TurnInterpretationSchema } from "./contracts";

test("TurnInterpretationSchema accepts valid payload", () => {
  const parsed = TurnInterpretationSchema.parse({
    intent: "create_booking",
    confidence: 0.92,
    specialist: "booking",
    userGoal: "book table",
    userConfirmation: "unclear",
    endCall: false,
    escalateToHuman: false,
    extractedSlots: { date_text: "tomorrow", party_size: 2 },
    requestedTool: null,
    missingSlotsHint: ["time_text"],
    responseTone: "clarify",
  });

  assert.equal(parsed.intent, "create_booking");
  assert.equal(parsed.extractedSlots.party_size, 2);
});

test("TurnInterpretationSchema rejects malformed confidence", () => {
  assert.throws(() =>
    TurnInterpretationSchema.parse({
      intent: "create_booking",
      confidence: 1.4,
      specialist: "booking",
      userGoal: "book",
      userConfirmation: "unclear",
      endCall: false,
      escalateToHuman: false,
      extractedSlots: {},
      requestedTool: null,
      missingSlotsHint: [],
      responseTone: "normal",
    }),
  );
});
