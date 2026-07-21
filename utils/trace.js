import { writeFile, mkdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Anchor traces to the HARNESS, not cwd. When the harness operates on another
// directory, cwd is the target project — and traces are harness artifacts that
// shouldn't be written into (or pollute the git status of) someone else's repo.
// Override with AGENTLOOP_TRACE_DIR, e.g. a mounted volume in a container.
const HARNESS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const TRACE_DIR = process.env.AGENTLOOP_TRACE_DIR
  ? path.resolve(process.env.AGENTLOOP_TRACE_DIR)
  : path.join(HARNESS_ROOT, "traces");

/**
 * Run a git command, returning raw stdout or null if git isn't usable.
 * Deliberately NOT trimmed: `status --porcelain` encodes meaning in the two
 * leading status columns, so a blanket trim() eats the first line's leading
 * space and corrupts its path.
 */
function git(args) {
  try {
    return execSync(`git ${args}`, {
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
  } catch {
    return null;
  }
}

/** Best-effort git SHA so a trace records which harness version produced it. */
const gitSha = () => git("rev-parse --short HEAD")?.trim() ?? null;

/**
 * Ground truth for what changed on disk, independent of what the model says it
 * did. A summary is a claim; this is the receipt. Parsed into structured
 * entries so it can be counted and diffed later.
 *
 * Status codes: M modified, A added, D deleted, R renamed, ?? untracked.
 */
export function gitChanges() {
  const out = git("status --porcelain");
  if (out === null) return null; // not a repo / git unavailable
  return out
    .split("\n")
    .filter(Boolean) // trailing newline; empty array == clean tree
    .map((line) => ({
      status: line.slice(0, 2).trim(),
      path: line.slice(3),
    }));
}

/**
 * Persist a run. Filenames are timestamps and never change — human meaning
 * goes in the `notes`/`tags` fields, added later via `node traces.js note`.
 */
export async function saveTrace(messages, iterationStats, outcome, meta = {}) {
  const trace = {
    // --- identity: enough to scan a run without reading `messages` ---
    task: messages.find((m) => m.role === "user")?.content ?? null,
    outcome, // how the LOOP ended: success | max_iter_exhausted | error
    taskSucceeded: null, // did the TASK succeed? set by hand during triage
    notes: null,
    tags: [],

    // --- provenance ---
    model: meta.model ?? null,
    maxIter: meta.maxIter ?? null,
    gitSha: gitSha(),
    gitChangesBefore: meta.gitChangesBefore ?? null, // dirty state at start
    gitChangesAfter: gitChanges(), // what the disk says now
    savedAt: new Date().toISOString(),

    // --- metrics ---
    iterations: iterationStats.length,
    promptTokensFinal: iterationStats.at(-1)?.promptTokens ?? 0,
    completionTokensTotal: iterationStats.reduce(
      (sum, s) => sum + (s.completionTokens ?? 0),
      0,
    ),
    apiMsTotal: iterationStats.reduce((sum, s) => sum + (s.apiMs ?? 0), 0),

    iterationStats,
    messages,
  };

  const redacted = JSON.stringify(trace, null, 2).replace(
    /sk-[A-Za-z0-9]{20,}/g,
    "sk-***REDACTED***",
  );

  // Create the dir on demand: cwd may be a target project with no traces/, and
  // the harness dir may be read-only-mounted with the volume elsewhere.
  await mkdir(TRACE_DIR, { recursive: true });
  const name = `${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const file = path.join(TRACE_DIR, name);
  await writeFile(file, redacted, "utf8");
  console.log(`\ntrace saved: ${file}`);

  return file;
}
