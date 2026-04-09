import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeModelSettingsForModel,
  stripUnsupportedParameterFromSettings,
} from "./modelGuardrails";
import { shouldRequireExplicitConfirmation } from "./turnOrchestratorV2";

test("sanitizeModelSettingsForModel removes reasoning for non-reasoning models", () => {
  const { sanitized, removed } = sanitizeModelSettingsForModel("gpt-4o-mini", {
    maxTokens: 120,
    reasoning: { effort: "low" },
  });

  assert.equal(sanitized.reasoning, undefined);
  assert.ok(removed.includes("reasoning"));
});

test("sanitizeModelSettingsForModel removes temperature/topP for reasoning models", () => {
  const { sanitized, removed } = sanitizeModelSettingsForModel("gpt-5", {
    maxTokens: 120,
    temperature: 0.2,
    topP: 0.9,
    reasoning: { effort: "low" },
  });

  assert.equal(sanitized.temperature, undefined);
  assert.equal(sanitized.topP, undefined);
  assert.ok(removed.includes("temperature"));
  assert.ok(removed.includes("topP"));
});

test("stripUnsupportedParameterFromSettings strips nested reasoning path", () => {
  const stripped = stripUnsupportedParameterFromSettings(
    { maxTokens: 120, reasoning: { effort: "low" } },
    "reasoning.effort",
  );
  assert.equal(stripped.sanitized.reasoning, undefined);
  assert.deepEqual(stripped.removed, ["reasoning"]);
});

test("state-changing tools require explicit confirmation", () => {
  assert.equal(shouldRequireExplicitConfirmation("calendly_create_booking"), true);
  assert.equal(shouldRequireExplicitConfirmation("create_reservation"), true);
  assert.equal(shouldRequireExplicitConfirmation("search_availability"), false);
});
