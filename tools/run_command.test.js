// @ts-check
import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Mock configuration
// ---------------------------------------------------------------------------

/**
 * Controls the return value of checkPolicy().
 * Set to { allowed: true, reason: "..." } or { allowed: false, reason: "..." }
 */
let policyResult = { allowed: true, reason: "test policy: allowed" };

/**
 * The result from execFile. If it's an Error instance, execFile calls back with
 * that error. Otherwise it's the success result { stdout, stderr }.
 */
let execResult = { stdout: "", stderr: "" };

/** Records the last execFile invocation so tests can assert argv, unparsed. */
let lastCall = { file: null, args: null };

// ---------------------------------------------------------------------------
// Replace the policy module so tests control allow/deny decisions.
// ---------------------------------------------------------------------------
mock.module("./policy.js", {
  namedExports: {
    async checkPolicy(command, args) {
      return policyResult;
    },
    resetPolicyCache() {},
  },
});

// ---------------------------------------------------------------------------
// Replace child_process.execFile with a callback-based mock so util.promisify
// (used inside run_command.js) works correctly. Signature:
//   execFile(file, args, options, callback)
// ---------------------------------------------------------------------------
mock.module("node:child_process", {
  namedExports: {
    execFile(file, args, options, callback) {
      // Support (file, args, cb) and (file, args, options, cb).
      if (typeof args === "function") {
        callback = args;
        args = [];
      } else if (typeof options === "function") {
        callback = options;
      }
      if (typeof callback !== "function") callback = () => {};

      lastCall = { file, args };

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

  it("requires command and args parameters", () => {
    assert.ok(schema.function.parameters.required.includes("command"));
    assert.ok(schema.function.parameters.required.includes("args"));
  });

  it("declares args as an array of strings", () => {
    const argsSchema = schema.function.parameters.properties.args;
    assert.equal(argsSchema.type, "array");
    assert.equal(argsSchema.items.type, "string");
  });

  it("describes that policy allowlist is used", () => {
    const desc = schema.function.description;
    assert.match(desc, /policy allowlist/);
    assert.match(desc, /denied automatically/);
  });
});

describe("run_command impl", () => {
  beforeEach(() => {
    policyResult = { allowed: true, reason: "test policy: allowed" };
    execResult = { stdout: "", stderr: "" };
    lastCall = { file: null, args: null };
  });

  // ---- Policy gate -------------------------------------------------------

  it("denies execution when the policy rejects the command", async () => {
    policyResult = {
      allowed: false,
      reason: "test: command not in allowlist",
    };
    const result = await impl({ command: "rm", args: ["-rf", "/"] });
    assert.match(result, /Policy denied/);
    assert.match(result, /rm -rf \//, "should show the display command");
    assert.match(result, /test: command not in allowlist/);
  });

  it("returns a denial message when policy says deny", async () => {
    policyResult = { allowed: false, reason: "dangerous command" };
    const result = await impl({ command: "curl", args: ["evil.com"] });
    assert.match(result, /Policy denied/);
    assert.match(result, /curl evil\.com/);
  });

  it("executes the command when the policy allows it", async () => {
    policyResult = { allowed: true, reason: "test: allowed" };
    execResult = { stdout: "hello\n", stderr: "" };

    const result = await impl({ command: "echo", args: ["hello"] });
    assert.equal(result, "hello\n");
    assert.equal(lastCall.file, "echo");
    assert.deepEqual(lastCall.args, ["hello"]);
  });

  it("returns policy denial for unlisted commands (deny-by-default)", async () => {
    policyResult = {
      allowed: false,
      reason:
        "Command 'whatever' is not in the policy allowlist. Denied by default.",
    };
    const result = await impl({ command: "whatever", args: [] });
    assert.match(result, /Policy denied/);
    assert.match(result, /not in the policy allowlist/);
  });

  // ---- The point of Path A: no shell ------------------------------------

  it("passes shell metacharacters as inert literal args (no shell)", async () => {
    policyResult = { allowed: true, reason: "test: allowed" };
    execResult = { stdout: "", stderr: "" };

    // If a shell were involved, the "; rm -rf ~" would be a second command.
    await impl({ command: "ls", args: ["-la; rm -rf ~"] });

    assert.equal(lastCall.file, "ls", "program is exactly what was passed");
    assert.deepEqual(
      lastCall.args,
      ["-la; rm -rf ~"],
      "the whole string is ONE literal argument, not parsed into commands",
    );
  });

  // ---- Successful execution ----------------------------------------------

  it("returns stdout when the policy allows", async () => {
    policyResult = { allowed: true, reason: "test: allowed" };
    execResult = { stdout: "hello world\n", stderr: "" };

    const result = await impl({ command: "echo", args: ["hello world"] });
    assert.equal(result, "hello world\n");
    assert.equal(lastCall.file, "echo");
    assert.deepEqual(lastCall.args, ["hello world"]);
  });

  it("handles args=null gracefully", async () => {
    policyResult = { allowed: true, reason: "test: allowed" };
    execResult = { stdout: "ok\n", stderr: "" };

    const result = await impl({ command: "echo", args: null });
    assert.equal(result, "ok\n");
  });

  it("includes stderr when present", async () => {
    policyResult = { allowed: true, reason: "test: allowed" };
    execResult = { stdout: "stdout line\n", stderr: "stderr line\n" };

    const result = await impl({ command: "some-cmd", args: [] });
    assert.ok(result.includes("stdout line"));
    assert.ok(result.includes("[stderr]"));
    assert.ok(result.includes("stderr line"));
  });

  it("reports a success message when there is no output", async () => {
    policyResult = { allowed: true, reason: "test: allowed" };
    execResult = { stdout: "", stderr: "" };

    const result = await impl({ command: "silent", args: [] });
    assert.match(result, /completed successfully \(no output\)/);
    assert.match(result, /silent/);
  });

  // ---- Output truncation -------------------------------------------------

  it("truncates output that exceeds MAX_CHARS (20 000)", async () => {
    policyResult = { allowed: true, reason: "test: allowed" };
    execResult = { stdout: "a".repeat(25_000), stderr: "" };

    const result = await impl({ command: "long-output", args: [] });
    assert.ok(result.length <= 21_000, "result should be truncated");
    assert.match(result, /\[truncated/);
  });

  // ---- Error handling ----------------------------------------------------

  it("returns a timeout error on SIGTERM kill", async () => {
    policyResult = { allowed: true, reason: "test: allowed" };
    const err = /** @type {any} */ (new Error("timed out"));
    err.killed = true;
    err.signal = "SIGTERM";
    err.stderr = "";
    err.stdout = "";
    execResult = err;

    const result = await impl({ command: "sleep", args: ["100"] });
    assert.match(result, /timed out after 60 seconds/);
    assert.match(result, /sleep 100/, "names the command");
  });

  it("returns a clear error when the program is not found (ENOENT)", async () => {
    policyResult = { allowed: true, reason: "test: allowed" };
    const err = /** @type {any} */ (new Error("spawn nope ENOENT"));
    err.code = "ENOENT";
    execResult = err;

    const result = await impl({ command: "nonexistent-cmd", args: ["x"] });
    assert.match(result, /not found/);
    assert.match(result, /nonexistent-cmd/, "names the program");
  });

  it("includes stderr and stdout in error messages", async () => {
    policyResult = { allowed: true, reason: "test: allowed" };
    const err = /** @type {any} */ (new Error("command failed"));
    err.stderr = "something went wrong\n";
    err.stdout = "partial output\n";
    execResult = err;

    const result = await impl({ command: "failing-cmd", args: ["arg1"] });
    assert.match(result, /Error running command/);
    assert.match(result, /something went wrong/);
    assert.match(result, /partial output/);
  });

  it("returns error when command is not found (no code)", async () => {
    policyResult = { allowed: true, reason: "test: allowed" };
    const err = /** @type {any} */ (new Error("spawn ENOENT"));
    err.code = "ENOENT";
    execResult = err;

    const result = await impl({ command: "missing-program", args: [] });
    assert.match(result, /not found/);
  });
});
