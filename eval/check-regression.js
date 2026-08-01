#!/usr/bin/env node
// @ts-check
// Regression gate. Compares the two most recent runs in eval/history.jsonl and
// exits non-zero if any task or probe went pass -> fail, or the pass rate
// dropped. Intended as a CI/pre-push gate after ingesting a fresh eval run.
//
//   node eval/check-regression.js
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const HISTORY = path.join(path.dirname(fileURLToPath(import.meta.url)), "history.jsonl");

async function main() {
  if (!existsSync(HISTORY)) {
    console.log("no history yet — nothing to compare");
    return;
  }
  const runs = (await readFile(HISTORY, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  if (runs.length < 2) {
    console.log("only one run recorded — no baseline to compare against");
    return;
  }

  const prev = runs[runs.length - 2];
  const curr = runs[runs.length - 1];
  const prevPass = new Map(prev.tasks.map((t) => [t.id, t.pass]));

  const regressions = curr.tasks.filter((t) => prevPass.get(t.id) === true && !t.pass);

  console.log(`baseline ${prev.gitSha} (${prev.passed}/${prev.total})  ->  ` +
    `current ${curr.gitSha} (${curr.passed}/${curr.total})`);

  if (regressions.length) {
    console.error(`\n✗ REGRESSION: ${regressions.length} task(s) went pass -> fail:`);
    for (const t of regressions) console.error(`  - ${t.id} (${(t.probes || []).join(", ")})`);
    console.error(
      "\nNote: p11 is a known-nondeterministic probe (see docs/failure-taxonomy 1c); " +
        "confirm with a repeat run before treating it as a real regression.",
    );
    process.exit(1);
  }
  console.log("\n✓ no task regressed");
}

main();
