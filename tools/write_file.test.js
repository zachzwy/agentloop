import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { impl } from "./write_file.js";

// Uses real fs in a throwaway dir; write_file operates relative to process.cwd().
describe("write_file — clobber guard", () => {
  let dir, cwd0;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "wf-"));
    cwd0 = process.cwd();
    process.chdir(dir);
  });
  afterEach(async () => {
    process.chdir(cwd0);
    await rm(dir, { recursive: true, force: true });
  });

  const bigFile = () =>
    "HEAD_START\n" +
    "x".repeat(9000) +
    "\nMIDDLE\n" +
    "y".repeat(9000) +
    "\nTAIL_SENTINEL_END\n";

  it("allows writing a brand-new file", async () => {
    const r = await impl({ filePath: "new.txt", content: "hello" });
    assert.match(r, /Successfully wrote/);
  });

  it("allows overwriting a small existing file", async () => {
    await writeFile("small.txt", "short original");
    const r = await impl({ filePath: "small.txt", content: "short new" });
    assert.match(r, /Successfully wrote/);
    assert.equal(await readFile("small.txt", "utf8"), "short new");
  });

  it("REFUSES a partial-read overwrite that drops the tail of a large file", async () => {
    await writeFile("big.js", bigFile());
    // Simulate the clobber: agent writes back only the truncated head.
    const r = await impl({
      filePath: "big.js",
      content: "HEAD_START\n" + "x".repeat(500) + " EDITED",
    });
    assert.match(r, /refusing to overwrite/);
    // The original file must be untouched.
    assert.match(await readFile("big.js", "utf8"), /TAIL_SENTINEL_END/);
  });

  it("ALLOWS a large-file overwrite that preserves the tail (a real edit)", async () => {
    await writeFile("big.js", bigFile());
    const full = bigFile().replace("HEAD_START", "HEAD_EDITED"); // keeps the tail
    const r = await impl({ filePath: "big.js", content: full });
    assert.match(r, /Successfully wrote/);
    assert.match(await readFile("big.js", "utf8"), /HEAD_EDITED/);
    assert.match(await readFile("big.js", "utf8"), /TAIL_SENTINEL_END/);
  });
});
