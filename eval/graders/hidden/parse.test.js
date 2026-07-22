// Hidden grader test for p9. Copied in by the runner after the agent finishes.
// Verifies parseLine handles the documented comma-separated format.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLine } from "./src/parse.js";

test("parseLine splits and trims comma-separated fields", () => {
  assert.deepEqual(parseLine("a, b ,c"), ["a", "b", "c"]);
  assert.deepEqual(parseLine("one,two"), ["one", "two"]);
  assert.deepEqual(parseLine("solo"), ["solo"]);
});
