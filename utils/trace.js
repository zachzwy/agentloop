import { writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";

/** Best-effort git SHA so a trace records which harness version produced it. */
function gitSha() {
  try {
    return execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
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

  const file = `traces/${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  await writeFile(file, redacted, "utf8");
  console.log(`\ntrace saved: ${file}`);

  return file;
}
