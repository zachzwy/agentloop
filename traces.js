#!/usr/bin/env node
// Trace triage CLI. Raw traces are immutable except for the annotation fields
// (notes, tags, taskSucceeded) which you fill in while reading them.
//
//   node traces.js list
//   node traces.js list --tag runtime-probing
//   node traces.js list --untagged
//   node traces.js show 2026-07-19T13-46
//   node traces.js note 2026-07-19T13-46 --tag runtime-probing --ok \
//        --note "Tests passed 16/16; harness reported failure."

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const TRACE_DIR = "traces";

async function loadAll() {
  const files = (await readdir(TRACE_DIR))
    .filter((f) => f.endsWith(".json"))
    .sort();

  const traces = [];
  for (const file of files) {
    const full = path.join(TRACE_DIR, file);
    try {
      traces.push({
        file,
        full,
        data: JSON.parse(await readFile(full, "utf8")),
      });
    } catch {
      console.error(`  (skipped unparseable ${file})`);
    }
  }
  return traces;
}

/** Match a trace by filename prefix, e.g. "2026-07-19T13-46". */
function findOne(traces, prefix) {
  const hits = traces.filter((t) => t.file.startsWith(prefix));
  if (hits.length === 0) throw new Error(`no trace matching '${prefix}'`);
  if (hits.length > 1) {
    throw new Error(
      `'${prefix}' matches ${hits.length} traces:\n  ` +
        hits.map((h) => h.file).join("\n  "),
    );
  }
  return hits[0];
}

const truncate = (s, n) =>
  !s ? "" : s.length <= n ? s : s.slice(0, n - 1) + "…";

// Older traces (and the two hand-written ones) predate the top-level summary
// fields. Derive what we can so every trace is listable.
function summarize(data) {
  const stats = Array.isArray(data.iterationStats) ? data.iterationStats : [];
  return {
    task:
      data.task ??
      (data.messages ?? []).find((m) => m.role === "user")?.content ??
      null,
    outcome: data.outcome ?? null,
    taskSucceeded: data.taskSucceeded ?? null,
    tags: data.tags ?? [],
    notes: data.notes ?? null,
    // `iterations` is a number in the new format; older files used an array.
    iterations:
      typeof data.iterations === "number"
        ? data.iterations
        : stats.length ||
          (Array.isArray(data.iterations) ? data.iterations.length : null),
    promptTokensFinal:
      data.promptTokensFinal ?? stats.at(-1)?.promptTokens ?? null,
  };
}

function list(traces, { tag, untagged }) {
  let rows = traces.map((t) => ({ ...t, s: summarize(t.data) }));
  if (tag) rows = rows.filter((t) => t.s.tags.includes(tag));
  if (untagged) rows = rows.filter((t) => t.s.tags.length === 0);

  if (rows.length === 0) {
    console.log("no traces match.");
    return;
  }

  for (const { file, s } of rows) {
    // Loop outcome and task outcome can disagree — show both.
    const loop = s.outcome === "success" ? "ok " : "ABN";
    const task =
      s.taskSucceeded === true
        ? "task:ok"
        : s.taskSucceeded === false
          ? "task:FAIL"
          : "task:?";
    const id = file.replace(".json", "").slice(0, 16).padEnd(16);
    const iters = String(s.iterations ?? "?").padStart(2);
    const tokens = `${Math.round((s.promptTokensFinal ?? 0) / 1000)}k`.padStart(
      4,
    );
    const tags = s.tags.length ? ` [${s.tags.join(", ")}]` : "";

    console.log(
      `${id}  ${loop} ${task.padEnd(9)} ${iters}it ${tokens}  ` +
        `${truncate(s.task, 50).padEnd(50)}${tags}`,
    );
    if (s.notes) console.log(`                    ↳ ${truncate(s.notes, 90)}`);
  }
  console.log(`\n${rows.length} trace(s).`);
}

function show(trace) {
  const d = trace.data;
  const s = summarize(d);
  const dash = (v) => v ?? "—";

  console.log(`file:     ${trace.file}`);
  console.log(`task:     ${dash(s.task)}`);
  console.log(
    `outcome:  ${dash(s.outcome)}   taskSucceeded: ${dash(s.taskSucceeded)}`,
  );
  console.log(`tags:     ${s.tags.join(", ") || "(none)"}`);
  console.log(`notes:    ${dash(s.notes)}`);
  console.log(
    `model:    ${dash(d.model)}   gitSha: ${dash(d.gitSha)}   maxIter: ${dash(d.maxIter)}`,
  );
  console.log(
    `metrics:  ${dash(s.iterations)} iterations, ${dash(s.promptTokensFinal)} final prompt tokens, ` +
      `${dash(d.completionTokensTotal)} completion tokens, ${Math.round((d.apiMsTotal ?? 0) / 1000)}s API time`,
  );
  console.log("\n--- conversation ---");
  for (const m of d.messages ?? []) {
    if (m.role === "system") continue;
    if (m.role === "user") console.log(`USER: ${truncate(m.content, 200)}`);
    else if (m.role === "assistant") {
      if (m.content) console.log(`ASSISTANT: ${truncate(m.content, 160)}`);
      for (const tc of m.tool_calls ?? []) {
        console.log(
          `  → ${tc.function.name} ${truncate(tc.function.arguments, 140)}`,
        );
      }
    } else if (m.role === "tool") {
      console.log(
        `  ← ${truncate((m.content ?? "").replace(/\n/g, " | "), 160)}`,
      );
    }
  }
}

async function note(trace, { tags, noteText, ok, fail }) {
  const d = trace.data;
  d.tags = [...new Set([...(d.tags ?? []), ...tags])];
  if (noteText !== undefined) d.notes = noteText;
  if (ok) d.taskSucceeded = true;
  if (fail) d.taskSucceeded = false;

  await writeFile(trace.full, JSON.stringify(d, null, 2), "utf8");
  console.log(`annotated ${trace.file}`);
  console.log(`  tags:  ${d.tags.join(", ") || "(none)"}`);
  console.log(`  task:  ${d.taskSucceeded}`);
  if (d.notes) console.log(`  notes: ${d.notes}`);
}

// --- arg parsing (deliberately minimal) ---
function parseArgs(argv) {
  const out = { tags: [], positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tag") out.tags.push(argv[++i]);
    else if (a === "--note") out.noteText = argv[++i];
    else if (a === "--ok") out.ok = true;
    else if (a === "--fail") out.fail = true;
    else if (a === "--untagged") out.untagged = true;
    else out.positional.push(a);
  }
  return out;
}

const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
const traces = await loadAll();

try {
  switch (command) {
    case "list":
    case undefined:
      list(traces, { tag: args.tags[0], untagged: args.untagged });
      break;
    case "show":
      show(findOne(traces, args.positional[0]));
      break;
    case "note":
      await note(findOne(traces, args.positional[0]), args);
      break;
    default:
      console.error(`unknown command '${command}'. try: list | show | note`);
      process.exit(1);
  }
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exit(1);
}
