import { exec } from "node:child_process";
import { promisify } from "node:util";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const execAsync = promisify(exec);

export const schema = {
  type: "function",
  function: {
    name: "run_command",
    description:
      "Run a shell command in the working directory. Every execution requires explicit user approval before running.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "The shell command to run. Can be any valid shell command (e.g., 'ls -la', 'node script.js', 'git status').",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
    strict: true,
  },
};

export const impl = async ({ command }) => {
  // -----------------------------------------------------------------------
  // Permission gate — ask the user interactively before running anything.
  // -----------------------------------------------------------------------
  const rl = readline.createInterface({ input, output });

  const answer = await rl.question(
    `\n⚠️  The LLM wants to run the following command:\n\n` +
      `   ${command}\n\n` +
      `   Allow? (y/N) `,
  );
  rl.close();

  const normalized = answer.trim().toLowerCase();
  if (normalized !== "y" && normalized !== "yes") {
    return `Command execution denied by user: '${command}' was NOT run.`;
  }

  // -----------------------------------------------------------------------
  // Execute.
  // -----------------------------------------------------------------------
  try {
    const { stdout, stderr } = await execAsync(command, {
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
      return `Command '${command}' completed successfully (no output).`;
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
      return `Error: command '${command}' timed out after 60 seconds.`;
    }
    const stderr = err.stderr || "";
    const stdout = err.stdout || "";
    let msg = `Error running command '${command}': ${err.message}`;
    if (stderr) msg += `\nstderr: ${stderr}`;
    if (stdout) msg += `\nstdout: ${stdout}`;
    return msg;
  }
};
