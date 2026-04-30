import test from "node:test";
import assert from "node:assert/strict";
import { createInboundConcurrencyGate } from "./inboundConcurrencyGate";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("rejects over-limit inbound calls and invokes deterministic fallback hook", async () => {
  const first = deferred();
  const handled: string[] = [];
  const rejected: string[] = [];

  const gate = createInboundConcurrencyGate(
    {
      handleInboundCall: async (args) => {
        handled.push(args.callId ?? "");
        await first.promise;
      },
    },
    1,
    {
      onReject: async (args) => {
        rejected.push(args.callId ?? "");
      },
    },
  );

  const firstRun = gate.handleInboundCall({
    callId: "call-1",
    did: "+18005550100",
    orgId: "org-1",
    callerNumber: "+15550000001",
  });

  await Promise.resolve();

  await gate.handleInboundCall({
    callId: "call-2",
    did: "+18005550100",
    orgId: "org-1",
    callerNumber: "+15550000002",
  });

  assert.deepEqual(handled, ["call-1"]);
  assert.deepEqual(rejected, ["call-2"]);

  first.resolve();
  await firstRun;
});

test("accepts a new call after active call finishes", async () => {
  const handled: string[] = [];
  const gate = createInboundConcurrencyGate(
    {
      handleInboundCall: async (args) => {
        handled.push(args.callId ?? "");
      },
    },
    1,
  );

  await gate.handleInboundCall({
    callId: "call-a",
    did: "+18005550100",
    orgId: "org-1",
  });

  await gate.handleInboundCall({
    callId: "call-b",
    did: "+18005550100",
    orgId: "org-1",
  });

  assert.deepEqual(handled, ["call-a", "call-b"]);
});
