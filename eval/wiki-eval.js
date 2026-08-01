#!/usr/bin/env node
// @ts-check
// Wiki-navigation testbed.
//
//   node eval/wiki-eval.js              # clean vs noisy (Delta 2 — ingest quality)
//   node eval/wiki-eval.js --baseline   # also run no-wiki baseline (Delta 1)
//   node eval/wiki-eval.js w1 w3        # only matching tasks
//
// Delta 1 (wiki lift): augmented vs no-wiki baseline — is the wiki worth anything?
// Delta 2 (ingest quality): the SAME tasks against a CLEAN wiki vs a NOISY one
// (dup/stale/off-topic pages simulating messy auto-ingest). The gap is the cost of
// bad ingest — the auto-ingest quality result. A per-task navigation breakdown
// classifies noisy failures (read-stale / crowded-out / …).
//
// Safe without the sandbox: read-only wiki tools; baseline has no tools.
import { readdir, readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loop } from "../loop.js";
import { wikiTools } from "../tools/index.js";
import { gradeTask } from "./graders/index.js";

const EVAL_ROOT = path.dirname(fileURLToPath(import.meta.url));
const TASKS_DIR = path.join(EVAL_ROOT, "wiki-tasks");
const WIKIS = {
  clean: path.join(EVAL_ROOT, "fixtures", "wiki-clean"),
  noisy: path.join(EVAL_ROOT, "fixtures", "wiki-noisy"),
};
// Instrumentation for the navigation failure taxonomy (noisy wiki).
const STALE = new Set(["orion-runbook-draft", "oncall-2024", "retention-legacy", "promotion-old"]);
const CORRECT = {
  "w1-orion-canary": "deploy-orion",
  "w2-oncall-escalation": "oncall-policy",
  "w3-pii-retention": "data-retention",
  "w4-staging-soak": "env-promotion",
};
const say = (s) => console.log("§ " + s); // marker so the report greps out of loop noise

function navFromTrace(trace) {
  const searches = [], reads = [];
  for (const m of trace.messages ?? []) {
    for (const tc of m.tool_calls ?? []) {
      let a = {};
      try { a = JSON.parse(tc.function.arguments); } catch {}
      if (tc.function.name === "wiki_search") searches.push(a.query);
      if (tc.function.name === "wiki_read") reads.push(a.pageId);
    }
  }
  return { searches, reads };
}

/** Classify a noisy-wiki failure from the agent's navigation path. */
function classify(task, nav) {
  const correct = CORRECT[task.id];
  const readStale = nav.reads.some((r) => STALE.has(r));
  const readCorrect = correct ? nav.reads.includes(correct) : false;
  if (readStale && !readCorrect) return "read-stale-only (wrong value)";
  if (readStale && readCorrect) return "read-both → answered wrong";
  if (correct && !readCorrect) return "crowded-out (never read the right page)";
  return "had-correct-page-but-failed";
}

async function runOne(task, wikiDir, toolset) {
  process.env.AGENTLOOP_WIKI_DIR = wikiDir;
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
  const nav = navFromTrace(JSON.parse(await readFile(tracePath, "utf8")));
  await rm(dir, { recursive: true, force: true }).catch(() => {});
  return { pass: graded.pass, nav };
}

async function main() {
  const args = process.argv.slice(2);
  const withBaseline = args.includes("--baseline");
  const filters = args.filter((a) => !a.startsWith("--"));
  const files = (await readdir(TASKS_DIR)).filter((f) => f.endsWith(".json")).sort();

  const rows = [];
  for (const f of files) {
    const task = JSON.parse(await readFile(path.join(TASKS_DIR, f), "utf8"));
    if (filters.length && !filters.some((x) => task.id.includes(x))) continue;
    process.stdout.write(`\n=== ${task.id} ===\n`);

    const clean = await runOne(task, WIKIS.clean, wikiTools);
    const noisy = await runOne(task, WIKIS.noisy, wikiTools);
    const baseline = withBaseline ? await runOne(task, WIKIS.clean, []) : null;

    const row = { id: task.id, isFact: task.id in CORRECT, clean: clean.pass, noisy: noisy.pass, baseline: baseline?.pass };
    if (!noisy.pass && row.isFact) row.why = classify(task, noisy.nav);
    rows.push(row);

    say(`${task.id}: clean=${clean.pass ? "PASS" : "FAIL"}  noisy=${noisy.pass ? "PASS" : "FAIL"}` +
      (withBaseline ? `  baseline=${baseline.pass ? "PASS" : "FAIL"}` : "") +
      (row.why ? `   [noisy failure: ${row.why}]` : ""));
    if (!noisy.pass && row.isFact) say(`    noisy nav → read: ${noisy.nav.reads.map((r) => (STALE.has(r) ? r + "*STALE" : r)).join(", ") || "(none)"}`);
  }

  const facts = rows.filter((r) => r.isFact);
  const n = facts.length;
  const c = facts.filter((r) => r.clean).length;
  const z = facts.filter((r) => r.noisy).length;
  say("");
  say("=".repeat(46));
  if (withBaseline) say(`Delta 1 (wiki lift): baseline ${facts.filter((r) => r.baseline).length}/${n} → clean ${c}/${n}`);
  say(`Delta 2 (ingest quality): clean ${c}/${n} → noisy ${z}/${n}   [degradation: ${c - z}/${n}]`);
  const w5 = rows.find((r) => r.id === "w5-not-in-wiki");
  if (w5) say(`graceful "not in wiki" (w5): clean=${w5.clean ? "PASS" : "FAIL"}  noisy=${w5.noisy ? "PASS" : "FAIL"}`);
}

main();
