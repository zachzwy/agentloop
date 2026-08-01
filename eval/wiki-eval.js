#!/usr/bin/env node
// @ts-check
// Wiki-navigation testbed. Measures the value of the wiki by running each task
// twice: AUGMENTED (the agent has wiki_search + wiki_read) vs BASELINE (no wiki
// tools at all). The tasks ask for synthetic, project-specific facts the model
// cannot know from training, so the baseline must fail — the delta is the wiki's
// lift, measured on task success with receipts (Delta 1; see docs).
//
//   node eval/wiki-eval.js                 # clean wiki, all tasks
//   node eval/wiki-eval.js w1 w3           # only matching tasks
//   WIKI_DIR=eval/fixtures/wiki-noisy node eval/wiki-eval.js   # a different wiki
//
// Safe to run WITHOUT the sandbox: augmented tools are read-only over the wiki
// dir; baseline has no tools. No run_command, no writes.
import { readdir, readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loop } from "../loop.js";
import { wikiTools } from "../tools/index.js";
import { gradeTask } from "./graders/index.js";

const EVAL_ROOT = path.dirname(fileURLToPath(import.meta.url));
const TASKS_DIR = path.join(EVAL_ROOT, "wiki-tasks");
const WIKI_DIR = path.resolve(process.env.WIKI_DIR ?? path.join(EVAL_ROOT, "fixtures", "wiki-clean"));

/** Run one task in one tool-mode against a clean temp cwd; return pass + trace. */
async function runMode(task, toolset) {
  const cwd0 = process.cwd();
  const dir = await mkdtemp(path.join(tmpdir(), "wiki-"));
  let tracePath;
  try {
    process.chdir(dir);
    ({ tracePath } = await loop({ prompt: task.prompt, tools: toolset }));
  } finally {
    process.chdir(cwd0);
  }
  const graded = await gradeTask(task, { fixtureDir: dir, tracePath });
  await rm(dir, { recursive: true, force: true }).catch(() => {});
  return graded.pass;
}

async function main() {
  process.env.AGENTLOOP_WIKI_DIR = WIKI_DIR;
  const filters = process.argv.slice(2);
  const files = (await readdir(TASKS_DIR)).filter((f) => f.endsWith(".json")).sort();

  const rows = [];
  for (const f of files) {
    const task = JSON.parse(await readFile(path.join(TASKS_DIR, f), "utf8"));
    if (filters.length && !filters.some((x) => task.id.includes(x))) continue;
    process.stdout.write(`\n=== ${task.id} ===\n`);
    const augmented = await runMode(task, wikiTools);
    const baseline = await runMode(task, []);
    rows.push({ id: task.id, augmented, baseline });
    console.log(
      `  augmented (wiki): ${augmented ? "PASS" : "FAIL"}    baseline (no wiki): ${baseline ? "PASS" : "FAIL"}`,
    );
  }

  const n = rows.length;
  const aug = rows.filter((r) => r.augmented).length;
  const base = rows.filter((r) => r.baseline).length;
  const pts = n ? Math.round(((aug - base) / n) * 100) : 0;
  console.log(`\n${"=".repeat(48)}`);
  console.log(`wiki: ${path.basename(WIKI_DIR)}   ·   ${n} tasks`);
  console.log(`  augmented (wiki tools): ${aug}/${n}`);
  console.log(`  baseline  (no wiki)   : ${base}/${n}`);
  console.log(`  DELTA — wiki lift     : ${aug - base}/${n}   (+${pts} pts)`);
  if (base === n) console.log("\n  ⚠ baseline passed everything — tasks are answerable WITHOUT the wiki; make the facts more synthetic.");
  if (aug === base) console.log("\n  ⚠ no lift — the wiki isn't helping; check search/read or the tasks.");
}

main();
