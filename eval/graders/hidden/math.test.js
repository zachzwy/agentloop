// Hidden grader test for p8. Copied into the fixture copy by the runner AFTER
// the agent finishes, then run with `node --test`. The agent never sees this.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sum } from "./src/math.js";

test("sum adds two numbers", () => {
  assert.equal(sum(2, 3), 5);
  assert.equal(sum(-1, 1), 0);
  assert.equal(sum(0, 0), 0);
});
