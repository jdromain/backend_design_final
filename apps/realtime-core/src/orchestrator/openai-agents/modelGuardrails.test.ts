import test from "node:test";
import assert from "node:assert/strict";
import {
  RUN_INPUT_LIMITS,
  sanitizeModelSettingsForModel,
  stripUnsupportedParameterFromSettings,
  validateRunInputHistory,
} from "./modelGuardrails";
import {
  buildApprovalHash,
  isStateChangingTool,
  normalizeApprovalStateAfterTurn,
  prepareApprovalStateForUserTurn,
  type CallContext,
} from "./agents";

test("sanitizeModelSettingsForModel removes reasoning for non-reasoning models", () => {
  const { sanitized, removed } = sanitizeModelSettingsForModel("gpt-4.1-mini", {
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
  assert.equal(isStateChangingTool("calendly_create_booking"), true);
  assert.equal(isStateChangingTool("create_reservation"), true);
  assert.equal(isStateChangingTool("search_availability"), false);
});

test("validateRunInputHistory drops malformed payloads and caps text", () => {
  const malformed = [
    { role: "user", content: 42 },
    {
      role: "user",
      content: [{ type: "input_text", text: "hello world" }],
    },
    {
      role: "assistant",
      content: [{ type: "output_text", text: "a".repeat(RUN_INPUT_LIMITS.MAX_TOTAL_TEXT_CHARS + 50) }],
      status: "completed",
    },
  ] as any;

  const result = validateRunInputHistory(malformed);
  assert.equal(result.history.length > 0, true);
  assert.equal(result.issues.length > 0, true);
  assert.equal(result.truncated, true);
});

test("approval gate grants one-turn approval only on explicit yes", () => {
  const actionHash = buildApprovalHash("create_reservation", { date: "2026-04-12", time: "19:00" });
  const context: CallContext = {
    orgId: "org_1",
    businessId: "biz_1",
    callId: "call_1",
    currentDateTime: new Date().toISOString(),
    agentBasePrompt: "test",
    kbPassages: [],
    slotMemory: {},
    pendingAction: {
      toolName: "create_reservation",
      args: { date: "2026-04-12", time: "19:00" },
      actionHash,
      createdAtMs: Date.now(),
      expiresAtMs: Date.now() + 60_000,
    },
    approvedActionHash: null,
    approvalGateState: "awaiting_confirmation",
  };

  prepareApprovalStateForUserTurn(context, "yes, go ahead");
  assert.equal(context.approvalGateState, "approved_for_turn");
  assert.equal(context.approvedActionHash, actionHash);

  normalizeApprovalStateAfterTurn(context);
  assert.equal(context.approvedActionHash, null);
  assert.equal(context.approvalGateState, "awaiting_confirmation");
});

test("approval gate clears pending action on explicit no", () => {
  const context: CallContext = {
    orgId: "org_1",
    businessId: "biz_1",
    callId: "call_1",
    currentDateTime: new Date().toISOString(),
    agentBasePrompt: "test",
    kbPassages: [],
    slotMemory: {},
    pendingAction: {
      toolName: "cancel_reservation",
      args: { reservation_id: "abc123" },
      actionHash: buildApprovalHash("cancel_reservation", { reservation_id: "abc123" }),
      createdAtMs: Date.now(),
      expiresAtMs: Date.now() + 60_000,
    },
    approvedActionHash: null,
    approvalGateState: "awaiting_confirmation",
  };

  prepareApprovalStateForUserTurn(context, "no do not do that");
  assert.equal(context.pendingAction, null);
  assert.equal(context.approvalGateState, "rejected");
});
