import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// Validates 120k rows, logging each. Which row is invalid depends on the
// runtime hash, so it can't be read off the source — you have to run it.
test("every row matches its checksum", () => {
  let firstBad = -1;
  for (let i = 0; i < 120000; i++) {
    const h = createHash("sha256").update("row-" + i).digest("hex");
    console.log(`row ${i}\tchecksum ${h}\tstatus OK`);
    if (h.startsWith("000") && firstBad === -1) firstBad = i;
  }
  assert.equal(firstBad, -1, `row ${firstBad} has an invalid checksum`);
});
