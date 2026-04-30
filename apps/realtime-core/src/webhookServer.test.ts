import test from "node:test";
import assert from "node:assert/strict";
import { reserveCallId, releaseCallId } from "./webhookServer";

test("dedupe rejects duplicate call ids while reservation is active", () => {
  const callId = `dup-${Date.now()}-a`;
  assert.equal(reserveCallId(callId), true);
  assert.equal(reserveCallId(callId), false);
});

test("release allows retry after failed async handoff", () => {
  const callId = `dup-${Date.now()}-b`;
  assert.equal(reserveCallId(callId), true);
  releaseCallId(callId);
  assert.equal(reserveCallId(callId), true);
});
