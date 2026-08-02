#!/usr/bin/env node
// @ts-check
// Wiki-navigation testbed — ingest-quality condition ladder, measured as a RATE.
//
//   node eval/wiki-eval.js                          # 1 run/task, clean+noisy+uncued
//   node eval/wiki-eval.js --runs 3                 # 3 runs/task (rate)
//   node eval/wiki-eval.js --wikis clean,uncued     # pick conditions
//   node eval/wiki-eval.js --baseline               # also no-wiki baseline (Delta 1)
//   node eval/wiki-eval.js w1 w2                     # only matching tasks
//
// Conditions:
//   clean  — correct pages only
//   noisy  — stale pages WITH authority markers ("(draft)", "(old)") + off-topic junk
//   uncued — stale contradictions with the SAME title, NO marker, wrong value,
//            ranked at the top: the agent cannot tell current from stale
// The clean→noisy→uncued curve isolates the cause: capable agents route around
// noise they can *attribute* (cued), and give confident WRONG answers when the
// authority/recency signal is stripped (uncued). That is the auto-ingest lever.
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
const FIX = (n) => path.join(EVAL_ROOT, "fixtures", n);
const WIKIS = { clean: FIX("wiki-clean"), noisy: FIX("wiki-noisy"), uncued: FIX("wiki-uncued"), outranked: FIX("wiki-outranked"), "ingest-naive": FIX("wiki-ingest-naive"), "ingest-reconcile": FIX("wiki-ingest-reconcile") };
const say = (s) => console.log("§ " + s);

async function runOnce(task, wikiDir, toolset) {
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
  await rm(dir, { recursive: true, force: true }).catch(() => {});
  return graded.pass;
}

async function main() {
  const args = process.argv.slice(2);
  const runs = Number((args.find((a) => a.startsWith("--runs=")) || "").split("=")[1]) ||
    (args.includes("--runs") ? Number(args[args.indexOf("--runs") + 1]) : 1);
  const wikiArg = (args.find((a) => a.startsWith("--wikis=")) || "").split("=")[1] ||
    (args.includes("--wikis") ? args[args.indexOf("--wikis") + 1] : "");
  const conditions = (wikiArg ? wikiArg.split(",") : ["clean", "noisy", "uncued"]).filter((c) => WIKIS[c]);
  const withBaseline = args.includes("--baseline");
  const filters = args.filter((a) => !a.startsWith("--") && !/^\d+$/.test(a) && a !== String(runs));

  const files = (await readdir(TASKS_DIR)).filter((f) => f.endsWith(".json")).sort();
  const totals = Object.fromEntries(conditions.map((c) => [c, { pass: 0, n: 0 }]));
  let baseP = 0, baseN = 0;

  say(`conditions: ${conditions.join(", ")}${withBaseline ? " (+baseline)" : ""} · ${runs} run(s)/task`);
  say("=".repeat(58));
  for (const f of files) {
    const task = JSON.parse(await readFile(path.join(TASKS_DIR, f), "utf8"));
    if (filters.length && !filters.some((x) => task.id.includes(x))) continue;
    process.stdout.write(`\n=== ${task.id} ===\n`);
    const cells = [];
    for (const cond of conditions) {
      let p = 0;
      for (let i = 0; i < runs; i++) if (await runOnce(task, WIKIS[cond], wikiTools)) p++;
      totals[cond].pass += p; totals[cond].n += runs;
      cells.push(`${cond} ${p}/${runs}`);
    }
    if (withBaseline) {
      let p = 0;
      for (let i = 0; i < runs; i++) if (await runOnce(task, WIKIS.clean, [])) p++;
      baseP += p; baseN += runs;
      cells.push(`baseline ${p}/${runs}`);
    }
    say(`${task.id.padEnd(22)} ${cells.join("   ")}`);
  }

  say("");
  say("=".repeat(58));
  const pct = (o) => (o.n ? Math.round((o.pass / o.n) * 100) : 0);
  if (withBaseline) say(`baseline (no wiki): ${baseP}/${baseN}  (${baseN ? Math.round((baseP / baseN) * 100) : 0}%)`);
  for (const c of conditions) say(`${c.padEnd(8)}: ${totals[c].pass}/${totals[c].n}  (${pct(totals[c])}%)`);
  if (totals.clean && totals.uncued)
    say(`\nauthority-cue effect (clean → uncued): ${pct(totals.clean)}% → ${pct(totals.uncued)}%  ` +
      `= ${pct(totals.clean) - pct(totals.uncued)} pts lost to authority-stripped stale content`);
}

main();
