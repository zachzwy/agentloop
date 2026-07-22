#!/usr/bin/env node
// @ts-check
// Batch eval runner. For each task (serially):
//   1. cp -r the pristine fixture to a throwaway dir; apply the task's fixture
//      requirements; create .env from env.fixture; git-init a clean baseline.
//   2. Run the harness headless against it (cwd = fixture copy).
//   3. Grade with the external grader (receipts, not the model's claim).
//   4. Record a row.
// Then write reports/<timestamp>/summary.{json,md}.
//
//   node eval/run-eval.js                 # all tasks
//   node eval/run-eval.js p3 p8           # only tasks whose id includes p3 / p8
import {
  readdir,
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  cp,
  rm,
  copyFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loop } from "../loop.js";
import { gradeTask } from "./graders/index.js";

const execFileAsync = promisify(execFile);
const EVAL_ROOT = path.dirname(fileURLToPath(import.meta.url));
const TASKS_DIR = path.join(EVAL_ROOT, "tasks");
const FIXTURE_BASE = path.join(EVAL_ROOT, "fixtures", "base");
const REPORTS_DIR = path.join(EVAL_ROOT, "reports");

const git = (cwd, args) =>
  execFileAsync(
    "git",
    ["-c", "user.email=eval@local", "-c", "user.name=eval", ...args],
    { cwd },
  );

/** Prepare a throwaway fixture copy for one task; returns its path. */
async function prepFixture(task) {
  const dir = path.join(
    await mkdtemp(path.join(tmpdir(), "eval-")),
    task.id,
  );
  await cp(FIXTURE_BASE, dir, { recursive: true });

  // Secret is stored as env.fixture (a real .env would be gitignored/lost).
  await copyFile(path.join(dir, "env.fixture"), path.join(dir, ".env")).catch(
    () => {},
  );

  // Apply fixture requirements.
  for (const rel of task.fixture?.absent ?? []) {
    await rm(path.join(dir, rel), { force: true });
  }

  // Clean git baseline so the trace's gitChangesAfter shows only agent edits.
  await git(dir, ["init", "-q"]);
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-q", "-m", "fixture baseline"]);

  return dir;
}

/** Pull the metrics we report out of the saved trace. */
async function traceMetrics(tracePath) {
  try {
    const t = JSON.parse(await readFile(tracePath, "utf8"));
    return {
      outcome: t.outcome,
      iterations: t.iterations ?? t.iterationStats?.length ?? 0,
      promptTokensFinal: t.promptTokensFinal ?? 0,
      completionTokensTotal: t.completionTokensTotal ?? 0,
    };
  } catch {
    return { outcome: "unknown", iterations: 0, promptTokensFinal: 0, completionTokensTotal: 0 };
  }
}

async function runOne(task, reportTraces) {
  const row = {
    id: task.id,
    category: task.category,
    difficulty: task.difficulty,
    probes: task.probes ?? [],
    outcome: null, // loop outcome
    pass: false, // task outcome (grader)
    error: false,
    iterations: 0,
    promptTokensFinal: 0,
    checks: [],
  };

  let fixtureDir;
  try {
    fixtureDir = await prepFixture(task);
  } catch (err) {
    row.error = true;
    row.checks = [{ type: "fixture-prep", pass: false, reason: err.message }];
    return row;
  }

  const cwd0 = process.cwd();
  let tracePath;
  try {
    process.chdir(fixtureDir);
    const res = await loop({ prompt: task.prompt });
    row.outcome = res.outcome;
    tracePath = res.tracePath;
  } catch (err) {
    row.error = true;
    row.outcome = "harness-error";
    row.checks = [{ type: "harness", pass: false, reason: err.message }];
    process.chdir(cwd0);
    return row;
  } finally {
    process.chdir(cwd0);
  }

  const m = await traceMetrics(tracePath);
  row.iterations = m.iterations;
  row.promptTokensFinal = m.promptTokensFinal;

  const graded = await gradeTask(task, { fixtureDir, tracePath });
  row.pass = graded.pass;
  row.error = graded.error;
  row.checks = graded.checks;

  // Copy the trace into the report for self-containment.
  if (tracePath) {
    await copyFile(
      tracePath,
      path.join(reportTraces, `${task.id}.json`),
    ).catch(() => {});
  }

  // Best-effort cleanup of the throwaway tree's parent.
  await rm(path.dirname(fixtureDir), { recursive: true, force: true }).catch(
    () => {},
  );

  return row;
}

function renderMarkdown(rows, meta) {
  const passed = rows.filter((r) => r.pass).length;
  const avgIters = rows.length
    ? (rows.reduce((s, r) => s + r.iterations, 0) / rows.length).toFixed(1)
    : "0";

  const lines = [];
  lines.push(
    `# Eval run ${meta.startedAt}`,
    ``,
    `model \`${meta.model}\` · harness \`${meta.gitSha}\` · ${meta.durationS}s`,
    ``,
    `**${passed}/${rows.length} passed** · avg ${avgIters} iters`,
    ``,
    `| id | cat | diff | probes | result | iters | tok |`,
    `| -- | --- | ---- | ------ | ------ | ----- | --- |`,
  );
  for (const r of rows) {
    const result = r.error ? "ERROR" : r.pass ? "PASS" : "FAIL";
    lines.push(
      `| ${r.id} | ${r.category} | ${r.difficulty} | ${r.probes.join(",") || "—"} | ` +
        `${result} | ${r.iterations} | ${Math.round(r.promptTokensFinal / 1000)}k |`,
    );
    if (!r.pass) {
      for (const c of r.checks.filter((c) => !c.pass)) {
        lines.push(`|  | | | | ↳ ${c.type}: ${c.reason} | | |`);
      }
    }
  }

  // By-probe rollup — the key artifact: a regression report on the learnings.
  const byProbe = {};
  for (const r of rows) {
    for (const p of r.probes) {
      byProbe[p] ??= { pass: 0, total: 0 };
      byProbe[p].total++;
      if (r.pass) byProbe[p].pass++;
    }
  }
  lines.push(``, `## By probe (regression report on learnings)`, ``);
  for (const [p, s] of Object.entries(byProbe).sort()) {
    const flag = s.pass < s.total ? "  ← regression" : "";
    lines.push(`- \`${p}\`  ${s.pass}/${s.total}${flag}`);
  }

  return lines.join("\n") + "\n";
}

async function main() {
  const filters = process.argv.slice(2);
  const files = (await readdir(TASKS_DIR))
    .filter((f) => f.endsWith(".json"))
    .sort();
  const tasks = [];
  for (const f of files) {
    const t = JSON.parse(await readFile(path.join(TASKS_DIR, f), "utf8"));
    if (filters.length === 0 || filters.some((x) => t.id.includes(x)))
      tasks.push(t);
  }

  if (tasks.length === 0) {
    console.error("no tasks match", filters);
    process.exit(1);
  }

  const startedAt = new Date().toISOString();
  const reportDir = path.join(REPORTS_DIR, startedAt.replace(/[:.]/g, "-"));
  const reportTraces = path.join(reportDir, "traces");
  await mkdir(reportTraces, { recursive: true });

  const gitSha =
    (await git(EVAL_ROOT, ["rev-parse", "--short", "HEAD"]).catch(() => null))
      ?.stdout?.trim() ?? "unknown";

  const t0 = Date.now();
  const rows = [];
  for (const task of tasks) {
    process.stdout.write(`\n=== ${task.id} ===\n`);
    const row = await runOne(task, reportTraces);
    rows.push(row);
    console.log(
      `\n[${task.id}] ${row.error ? "ERROR" : row.pass ? "PASS" : "FAIL"} ` +
        `(loop=${row.outcome}, ${row.iterations} iters)`,
    );
  }

  const meta = {
    startedAt,
    model: "deepseek-v4-flash",
    gitSha,
    durationS: Math.round((Date.now() - t0) / 1000),
  };

  await writeFile(
    path.join(reportDir, "summary.json"),
    JSON.stringify({ meta, rows }, null, 2),
  );
  const md = renderMarkdown(rows, meta);
  await writeFile(path.join(reportDir, "summary.md"), md);

  console.log(`\n${"=".repeat(50)}\n`);
  console.log(md);
  console.log(`report: ${path.join(reportDir, "summary.md")}`);
}

main();
