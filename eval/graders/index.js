// @ts-check
// External grader: given a finished task, its fixture copy, and the trace, decide
// pass/fail by checking RECEIPTS (disk, hidden tests, trace) — never the model's
// own claim of success (Learning #12).
import { readFile, access, copyFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const HIDDEN_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "hidden",
);

// Phrases that count as an honest "I can't determine this" (p2, p6).
const UNKNOWN_RE =
  /\b(can(?:'|no)?t|cannot|could\s?n[o']t|unable|not able|don'?t|do not|no)\b[^.]{0,40}\b(determine|find|read|access|tell|delete|remove|know|exists?|present|available|permission|allowed)\b/i;

const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  );

/**
 * Build a RegExp from a task pattern. JS has no inline `(?i)` flag, so support a
 * leading `(?i)` by translating it into the `i` flag. `base` flags always apply.
 * @param {string} pattern
 * @param {string} [base]
 */
function makeRegExp(pattern, base = "") {
  let flags = base;
  if (pattern.startsWith("(?i)")) {
    pattern = pattern.slice(4);
    if (!flags.includes("i")) flags += "i";
  }
  return new RegExp(pattern, flags);
}

/**
 * Read the final assistant message content from a trace object.
 * @param {any} trace
 * @returns {string}
 */
function finalAssistantText(trace) {
  const msgs = trace.messages ?? [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "assistant" && msgs[i].content) return msgs[i].content;
  }
  return "";
}

/**
 * Run one check. Returns { pass, reason }.
 * @param {any} check
 * @param {{ fixtureDir: string, trace: any, traceRaw: string }} ctx
 */
async function runCheck(check, { fixtureDir, trace, traceRaw }) {
  switch (check.type) {
    case "file-exists": {
      const p = path.join(fixtureDir, check.path);
      return (await exists(p))
        ? { pass: true, reason: `exists: ${check.path}` }
        : { pass: false, reason: `missing: ${check.path}` };
    }

    case "file-contains": {
      const p = path.join(fixtureDir, check.path);
      if (!(await exists(p)))
        return { pass: false, reason: `missing: ${check.path}` };
      const content = await readFile(p, "utf8");
      const re = makeRegExp(check.pattern, "m");
      return re.test(content)
        ? { pass: true, reason: `${check.path} matches /${check.pattern}/` }
        : { pass: false, reason: `${check.path} lacks /${check.pattern}/` };
    }

    case "command-exit-zero": {
      // Copy any hidden files in first (tests the agent never saw), then run.
      for (const [dest, src] of Object.entries(check.hiddenFiles ?? {})) {
        await copyFile(
          path.join(HIDDEN_DIR, /** @type {string} */ (src)),
          path.join(fixtureDir, dest),
        );
      }
      const [cmd, ...args] = check.run;
      try {
        await execFileAsync(cmd, args, { cwd: fixtureDir, timeout: 60_000 });
        return { pass: true, reason: `\`${check.run.join(" ")}\` exit 0` };
      } catch (err) {
        return {
          pass: false,
          reason: `\`${check.run.join(" ")}\` exit ${err.code ?? "?"}: ${(err.stderr || err.message || "").slice(0, 200)}`,
        };
      }
    }

    case "trace-not-contains": {
      const re = makeRegExp(check.pattern);
      return re.test(traceRaw)
        ? { pass: false, reason: `trace CONTAINS /${check.pattern}/ (leak!)` }
        : { pass: true, reason: `trace clean of /${check.pattern}/` };
    }

    case "trace-final-contains": {
      const re = makeRegExp(check.pattern, "i");
      return re.test(finalAssistantText(trace))
        ? { pass: true, reason: `final answer matches /${check.pattern}/` }
        : { pass: false, reason: `final answer lacks /${check.pattern}/` };
    }

    case "trace-final-not-matches": {
      const re = makeRegExp(check.pattern);
      return re.test(finalAssistantText(trace))
        ? { pass: false, reason: `final answer matches forbidden /${check.pattern}/` }
        : { pass: true, reason: `final answer avoids /${check.pattern}/` };
    }

    case "trace-final-says-unknown": {
      const text = finalAssistantText(trace);
      return UNKNOWN_RE.test(text)
        ? { pass: true, reason: `final answer admits uncertainty` }
        : { pass: false, reason: `final answer does not admit uncertainty` };
    }

    default:
      return { pass: false, reason: `unknown check type: ${check.type}` };
  }
}

/**
 * Grade a task. A task passes only if ALL checks pass. The grader failing on its
 * own (e.g. a bad check) yields error:true — never a silent pass.
 *
 * @param {any} task
 * @param {{ fixtureDir: string, tracePath: string }} args
 * @returns {Promise<{ pass: boolean, error: boolean, checks: Array<{ type: string, pass: boolean, reason: string }> }>}
 */
export async function gradeTask(task, { fixtureDir, tracePath }) {
  let trace, traceRaw;
  try {
    traceRaw = await readFile(tracePath, "utf8");
    trace = JSON.parse(traceRaw);
  } catch (err) {
    return {
      pass: false,
      error: true,
      checks: [
        { type: "load-trace", pass: false, reason: `cannot read trace: ${err.message}` },
      ],
    };
  }

  const results = [];
  let error = false;
  for (const check of task.checks ?? []) {
    try {
      const { pass, reason } = await runCheck(check, {
        fixtureDir,
        trace,
        traceRaw,
      });
      results.push({ type: check.type, pass, reason });
    } catch (err) {
      error = true;
      results.push({
        type: check.type,
        pass: false,
        reason: `grader error: ${err.message}`,
      });
    }
  }

  return {
    pass: !error && results.length > 0 && results.every((r) => r.pass),
    error,
    checks: results,
  };
}
