import test from "node:test";
import assert from "node:assert/strict";
import { mapRealtimeStopToCallEnd, toValidTerminalTuple } from "./callController";

test("mapRealtimeStopToCallEnd maps end to completed/handled/agent_end", () => {
  assert.deepEqual(mapRealtimeStopToCallEnd("end"), {
    status: "completed",
    outcome: "handled",
    endReason: "agent_end",
  });
});

test("mapRealtimeStopToCallEnd maps timeout to abandoned/abandoned/timeout", () => {
  assert.deepEqual(mapRealtimeStopToCallEnd("timeout"), {
    status: "abandoned",
    outcome: "abandoned",
    endReason: "timeout",
  });
});

test("mapRealtimeStopToCallEnd maps error to failed/failed/error", () => {
  assert.deepEqual(mapRealtimeStopToCallEnd("error"), {
    status: "failed",
    outcome: "failed",
    endReason: "error",
  });
});

test("mapRealtimeStopToCallEnd maps bridge close to abandoned/caller_hangup", () => {
  assert.deepEqual(mapRealtimeStopToCallEnd("bridge_closed"), {
    status: "abandoned",
    outcome: "abandoned",
    endReason: "caller_hangup",
  });
});

test("toValidTerminalTuple preserves valid tuples", () => {
  assert.deepEqual(
    toValidTerminalTuple({ status: "transferred", outcome: "transferred", endReason: "transfer" }),
    {
      status: "transferred",
      outcome: "transferred",
      endReason: "transfer",
    }
  );
});

test("toValidTerminalTuple normalizes invalid tuple to explicit unknown marker", () => {
  assert.deepEqual(
    toValidTerminalTuple({ status: "completed", outcome: "failed", endReason: "agent_end" }),
    {
      status: "failed",
      outcome: "failed",
      endReason: "unknown",
    }
  );
});
