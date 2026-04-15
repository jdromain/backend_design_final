import test from "node:test";
import assert from "node:assert/strict";
import { extractSentenceChunks } from "./sentenceChunker";

test("extractSentenceChunks returns complete sentences and remainder", () => {
  const result = extractSentenceChunks("Hello there. How are you doing today");

  assert.deepEqual(result.sentences, ["Hello there."]);
  assert.equal(result.remainder, " How are you doing today");
});

test("extractSentenceChunks handles multiple sentence delimiters", () => {
  const result = extractSentenceChunks("One! Two? Three.");

  assert.deepEqual(result.sentences, ["One!", "Two?", "Three."]);
  assert.equal(result.remainder, "");
});

test("extractSentenceChunks keeps undelimited text in remainder", () => {
  const result = extractSentenceChunks("No delimiter yet");

  assert.deepEqual(result.sentences, []);
  assert.equal(result.remainder, "No delimiter yet");
});
