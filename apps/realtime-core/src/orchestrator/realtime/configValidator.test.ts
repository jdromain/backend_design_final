import test from "node:test";
import assert from "node:assert/strict";
import { buildRealtimeSessionConfig, validateRealtimeSessionConfig } from "./configValidator";

test("validateRealtimeSessionConfig accepts canonical realtime config", () => {
  const config = buildRealtimeSessionConfig();
  const result = validateRealtimeSessionConfig(config);

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("validateRealtimeSessionConfig rejects non-text output modality", () => {
  const result = validateRealtimeSessionConfig({
    outputModalities: ["audio"],
    audio: {
      input: {
        format: { type: "audio/pcmu" },
        turnDetection: {
          type: "semantic_vad",
          interruptResponse: true,
          createResponse: false,
        },
      },
    },
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors.some((error) => error.includes("must include 'text'")), true);
});

test("validateRealtimeSessionConfig rejects invalid input format", () => {
  const result = validateRealtimeSessionConfig({
    outputModalities: ["text"],
    audio: {
      input: {
        format: { type: "audio/pcm", rate: 24000 },
        turnDetection: {
          type: "semantic_vad",
          interruptResponse: true,
          createResponse: false,
        },
      },
    },
  });

  assert.equal(result.valid, false);
  assert.equal(
    result.errors.some((error) => error.includes("audio.input.format.type must be 'audio/pcmu'")),
    true,
  );
});
