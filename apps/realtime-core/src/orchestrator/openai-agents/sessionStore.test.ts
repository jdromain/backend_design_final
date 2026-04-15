import test from "node:test";
import assert from "node:assert/strict";
import { sessionStore } from "./sessionStore";

test("sessionStore round-trips realtime conversation state", async () => {
  const callId = `rt-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  await sessionStore.saveRealtimeConversationState(callId, {
    callId,
    realtimeHistory: [
      {
        itemId: "item_1",
        type: "message",
        role: "user",
        status: "completed",
        content: [{ type: "input_text", text: "hello" }],
      },
    ],
    currentAgentName: "Receptionist",
    context: {
      slotMemory: {},
      pendingAction: null,
      approvedActionHash: null,
      approvalGateState: "none",
      currentDateTime: new Date().toISOString(),
      kbPassages: [],
    },
    transcript: [],
    turnCount: 0,
    latestIntent: "other",
    latestIntentConfidence: 0.5,
    latestSlots: {},
  });

  const restoredRealtime = await sessionStore.getRealtimeConversationState(callId);
  assert.ok(restoredRealtime);
  assert.equal(restoredRealtime.mode, "realtime_agents");
  assert.equal(restoredRealtime.realtimeHistory.length, 1);

  const restoredLegacy = await sessionStore.getConversationState(callId);
  assert.equal(restoredLegacy, null);

  await sessionStore.clearConversationState(callId);
});
