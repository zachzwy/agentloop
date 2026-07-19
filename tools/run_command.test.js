// @ts-check
import { describe, it, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Mock configuration — these variables control what the mocked modules return.
// Reset them in beforeEach / per-test.
// ---------------------------------------------------------------------------

/** @type {string} The answer returned by readline.question() */
let questionAnswer = "n";

/**
 * The result from exec. If it's an Error instance, exec will call back with
 * that error. Otherwise it's used as the success result { stdout, stderr }.
 */
let execResult = { stdout: "", stderr: "" };

// ---------------------------------------------------------------------------
// Custom question mock that reads from questionAnswer
// ---------------------------------------------------------------------------
const questionMock = async () => questionAnswer;

// ---------------------------------------------------------------------------
// Replace the interactive readline so tests never wait for real user input.
// ---------------------------------------------------------------------------
mock.module("node:readline/promises", {
  defaultExport: {
    createInterface() {
      return {
        question: questionMock,
        close: () => {},
      };
    },
  },
});

// ---------------------------------------------------------------------------
// Replace child_process.exec with a callback-based mock so util.promisify
// (which is called inside run_command.js) works correctly.
// ---------------------------------------------------------------------------
mock.module("node:child_process", {
  namedExports: {
    exec(command, options, callback) {
      // exec supports (command, callback) and (command, options, callback)
      if (typeof options === "function") {
        callback = options;
        // eslint-disable-next-line no-unused-vars
        options = {};
      }

      if (typeof callback !== "function") {
        callback = () => {};
      }

      // Simulate async callback on next tick
      process.nextTick(() => {
        if (execResult instanceof Error) {
          callback(execResult);
        } else {
          callback(null, {
            stdout: execResult.stdout ?? "",
            stderr: execResult.stderr ?? "",
          });
        }
      });
    },
  },
});

// ---------------------------------------------------------------------------
// Import the module under test *after* the mocks are in place.
// ---------------------------------------------------------------------------
const { schema, impl } = await import("./run_command.js");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("run_command schema", () => {
  it("has the correct name", () => {
    assert.equal(schema.function.name, "run_command");
  });

  it("requires a command parameter", () => {
    assert.ok(schema.function.parameters.required.includes("command"));
  });
});

describe("run_command impl", () => {
  beforeEach(() => {
    // Default: deny the command so we don't accidentally run anything.
    questionAnswer = "n";
    execResult = { stdout: "", stderr: "" };
  });

  // ---- Permission gate ---------------------------------------------------

  it('returns a denial message when the user answers "n"', async () => {
    questionAnswer = "n";
    const result = await impl({ command: "echo hello" });
    assert.match(
      result,
      /Command execution denied by user/,
      "Should indicate the command was denied",
    );
    assert.match(result, /echo hello/, "Should mention the denied command");
  });

  it('returns a denial message when the user answers "no"', async () => {
    questionAnswer = "no";
    const result = await impl({ command: "rm -rf /" });
    assert.match(
      result,
      /Command execution denied by user/,
      "Should indicate the command was denied",
    );
  });

  it("returns a denial message when the user answers an empty string", async () => {
    questionAnswer = "";
    const result = await impl({ command: "danger" });
    assert.match(
      result,
      /Command execution denied by user/,
      "Empty answer should be treated as denial",
    );
  });

  it('returns a denial message for any non-"y"/"yes" answer', async () => {
    questionAnswer = "YOLO";
    const result = await impl({ command: "whatever" });
    assert.match(
      result,
      /Command execution denied by user/,
      "Arbitrary non-yes answer denies the command",
    );
  });

  // ---- Successful execution ----------------------------------------------

  it("executes the command and returns stdout when user approves", async () => {
    questionAnswer = "y";
    execResult = { stdout: "hello world\n", stderr: "" };

    const result = await impl({ command: "echo hello world" });
    assert.equal(result, "hello world\n");
  });

  it('also accepts "yes" as approval', async () => {
    questionAnswer = "yes";
    execResult = { stdout: "ok\n", stderr: "" };

    const result = await impl({ command: "echo ok" });
    assert.equal(result, "ok\n");
  });

  it('handles capital-letter "Y" as approval', async () => {
    questionAnswer = "Y";
    execResult = { stdout: "done\n", stderr: "" };

    const result = await impl({ command: "echo done" });
    assert.equal(result, "done\n");
  });

  it("includes stderr in the output when present", async () => {
    questionAnswer = "y";
    execResult = { stdout: "stdout line\n", stderr: "stderr line\n" };

    const result = await impl({ command: "some-command" });
    assert.ok(result.includes("stdout line"), "stdout should appear");
    assert.ok(
      result.includes("[stderr]"),
      "stderr section header should appear",
    );
    assert.ok(result.includes("stderr line"), "stderr content should appear");
  });

  it("returns a success message when command produces no output", async () => {
    questionAnswer = "y";
    execResult = { stdout: "", stderr: "" };

    const result = await impl({ command: "silent-command" });
    assert.match(
      result,
      /completed successfully \(no output\)/,
      "Should indicate zero output",
    );
    assert.match(result, /silent-command/, "Should mention the command name");
  });

  // ---- Output truncation -------------------------------------------------

  it("truncates output that exceeds MAX_CHARS (20 000)", async () => {
    questionAnswer = "y";
    const longLine = "a".repeat(25_000);
    execResult = { stdout: longLine, stderr: "" };

    const result = await impl({ command: "long-output" });
    assert.ok(result.length <= 21_000, "Result should be truncated");
    assert.match(result, /\[truncated/, "Should include truncation marker");
  });

  // ---- Error handling ----------------------------------------------------

  it("returns a timeout error when the command is killed with SIGTERM", async () => {
    questionAnswer = "y";

    // Simulate a timeout error, matching what child_process.exec emits
    const timeoutError = /** @type {any} */ (new Error("Command timed out"));
    timeoutError.killed = true;
    timeoutError.signal = "SIGTERM";
    timeoutError.stderr = "";
    timeoutError.stdout = "";
    execResult = timeoutError;

    const result = await impl({ command: "sleep 100" });
    assert.match(result, /timed out after 60 seconds/);
  });

  it("returns an error message when the command fails", async () => {
    questionAnswer = "y";

    const execError = /** @type {any} */ (new Error("command not found"));
    execError.stderr = "bash: bad-command: command not found\n";
    execError.stdout = "";
    execResult = execError;

    const result = await impl({ command: "bad-command" });
    assert.match(
      result,
      /Error running command/,
      "Should indicate a runtime error",
    );
    assert.match(
      result,
      /command not found/,
      "Should include the error message",
    );
    assert.match(
      result,
      /stderr: bash: bad-command/,
      "Should include stderr content",
    );
  });

  it("includes stdout in error output when present", async () => {
    questionAnswer = "y";

    const execError = /** @type {any} */ (new Error("exit code 1"));
    execError.stderr = "some error\n";
    execError.stdout = "partial output\n";
    execResult = execError;

    const result = await impl({ command: "failing-command" });
    assert.ok(result.includes("partial output"), "stdout should be in output");
    assert.ok(result.includes("some error"), "stderr should be in output");
  });

  it("returns command name in the timeout error message", async () => {
    questionAnswer = "y";

    const timeoutError = /** @type {any} */ (new Error("Command timed out"));
    timeoutError.killed = true;
    timeoutError.signal = "SIGTERM";
    timeoutError.stderr = "";
    timeoutError.stdout = "";
    execResult = timeoutError;

    const result = await impl({ command: "slow-command" });
    assert.match(result, /slow-command/, "Should name the command");
  });
});
