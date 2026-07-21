import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { checkPolicy } from "./policy.js";

const execFileAsync = promisify(execFile);

export const schema = {
  type: "function",
  function: {
    name: "run_command",
    description:
      "Run a program with arguments in the working directory. No shell is " +
      "used, so shell features do NOT work: no pipes (|), redirection (>), " +
      "chaining (; && ||), globbing (*), or substitution ($(...)). Pass the " +
      "program as `command` and each argument as a separate item in `args` " +
      "(e.g. command 'node', args ['--test', 'loop.test.js']). " +
      "Commands are evaluated against a policy allowlist — unlisted or " +
      "dangerous commands are denied automatically.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "The program to run, e.g. 'node', 'npm', 'git', 'ls'. Resolved " +
            "via PATH. Not a shell command line — no metacharacters.",
        },
        args: {
          type: "array",
          items: { type: "string" },
          description:
            "Arguments, one per array item. Metacharacters here are literal " +
            "text, not shell operators. Use [] for no arguments.",
        },
      },
      required: ["command", "args"],
      additionalProperties: false,
    },
    strict: true,
  },
};

export const impl = async ({ command, args }) => {
  const argv = Array.isArray(args) ? args : [];
  // Display form only — execution uses the array, so this can't reintroduce
  // shell semantics. Quote args with spaces so the prompt is unambiguous.
  const display = [command, ...argv]
    .map((a) => (/\s/.test(a) ? `'${a}'` : a))
    .join(" ");

  // -----------------------------------------------------------------------
  // Layer 2 — Policy decision (allow/deny).
  // -----------------------------------------------------------------------
  const { allowed, reason } = await checkPolicy(command, argv);

  if (!allowed) {
    return `Policy denied: command '${display}' was NOT run.\nReason: ${reason}`;
  }

  // -----------------------------------------------------------------------
  // Execute — execFile runs the program directly (no /bin/sh), so shell
  // metacharacters in args are inert literal strings.
  // -----------------------------------------------------------------------
  try {
    const { stdout, stderr } = await execFileAsync(command, argv, {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024, // 10 MB.
      timeout: 60_000, // 60 seconds.
    });

    let result = "";
    if (stdout) {
      result += stdout;
    }
    if (stderr) {
      if (result) result += "\n";
      result += `[stderr]\n${stderr}`;
    }

    if (!result) {
      return `Command '${display}' completed successfully (no output).`;
    }

    // Truncate if too long.
    const MAX_CHARS = 20_000;
    if (result.length > MAX_CHARS) {
      result =
        result.slice(0, MAX_CHARS) +
        `\n[truncated: output was ${result.length} chars total]`;
    }

    return result;
  } catch (err) {
    if (err.killed && err.signal === "SIGTERM") {
      return `Error: command '${display}' timed out after 60 seconds.`;
    }
    // execFile sets code to 'ENOENT' when the program isn't found on PATH.
    if (err.code === "ENOENT") {
      return `Error: program '${command}' not found. Check the name and that it is installed.`;
    }
    const stderr = err.stderr || "";
    const stdout = err.stdout || "";
    let msg = `Error running command '${display}': ${err.message}`;
    if (stderr) msg += `\nstderr: ${stderr}`;
    if (stdout) msg += `\nstdout: ${stdout}`;
    return msg;
  }
};
