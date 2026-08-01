#!/usr/bin/env node
// @ts-check
// Append a completed eval run to eval/history.jsonl — the durable trend record,
// because the sandbox report dirs (_sandbox-out) are gitignored/ephemeral.
//
//   node eval/ingest-history.js [path/to/summary.json]
//
// With no arg, ingests the newest summary.json under the default sandbox output.
// Idempotent: a run with an already-recorded `date` is skipped.
import { readFile, appendFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const EVAL_ROOT = path.dirname(fileURLToPath(import.meta.url));
const HISTORY = path.join(EVAL_ROOT, "history.jsonl");
const DEFAULT_REPORTS = path.join(EVAL_ROOT, "reports", "_sandbox-out", "reports");

async function newestSummary() {
  if (!existsSync(DEFAULT_REPORTS)) return null;
  const dirs = (await readdir(DEFAULT_REPORTS)).sort();
  for (const d of dirs.reverse()) {
    const p = path.join(DEFAULT_REPORTS, d, "summary.json");
    if (existsSync(p)) return p;
  }
  return null;
}

async function existingDates() {
  if (!existsSync(HISTORY)) return new Set();
  const lines = (await readFile(HISTORY, "utf8")).trim().split("\n").filter(Boolean);
  return new Set(lines.map((l) => JSON.parse(l).date));
}

async function main() {
  const summaryPath = process.argv[2] ?? (await newestSummary());
  if (!summaryPath) {
    console.error("no summary.json found; run an eval first");
    process.exit(1);
  }
  const s = JSON.parse(await readFile(summaryPath, "utf8"));
  const rows = s.rows ?? [];
  const record = {
    date: s.meta?.startedAt ?? new Date().toISOString(),
    gitSha: s.meta?.gitSha ?? "unknown",
    passed: rows.filter((r) => r.pass).length,
    total: rows.length,
    tasks: rows.map((r) => ({
      id: r.id,
      pass: !!r.pass,
      outcome: r.outcome ?? null,
      probes: r.probes ?? [],
    })),
  };

  if ((await existingDates()).has(record.date)) {
    console.log(`already recorded (${record.date}); skipping`);
    return;
  }
  await appendFile(HISTORY, JSON.stringify(record) + "\n");
  console.log(
    `recorded ${record.gitSha}: ${record.passed}/${record.total} passed (${record.date})`,
  );
}

main();
