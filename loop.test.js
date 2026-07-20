// @ts-check
import { describe, it, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ===========================================================================
// Mock configuration — these variables control what the mocked modules return.
// Reset them in beforeEach / per-test.
// ===========================================================================

/** @type {string} The answer returned by readline.question() (used by getUserInput) */
let mockUserInput = "test question";

/** @type {string} Content returned by loadSystemPrompt */
let mockSystemPrompt = "You are a test assistant.";

/**
 * Content returned when reading AGENTS.md, or null to simulate ENOENT.
 * Set to a string to simulate the file existing.
 */
let mockAgentsMd = null;

/**
 * Queue of OpenAI API responses. Each test sets this to the sequence of
 * responses the loop should see. The last response must have no tool_calls
 * (or the loop will exhaust MAX_ITER).
 */
/** @type {Array<{ choices: Array<{ message: { role: string, content: string|null, tool_calls?: Array<*> } }>, usage: object }>} */
let mockApiResponses = [];

/** Index into mockApiResponses, reset per test */
let mockApiIndex = 0;

/** What executeToolCall returns for each tool call */
let mockToolResult = "mock tool result";

/** Accumulated calls to saveTrace for assertions */
let saveTraceCalls = [];

/** Accumulated calls to printRunMetrics for assertions */
let printRunMetricsCalls = [];

// ===========================================================================
// Mock modules
// ===========================================================================

// --- node:readline/promises ---
mock.module("node:readline/promises", {
  exports: {
    default: {
      createInterface() {
        return {
          question: async () => mockUserInput,
          close: () => {},
        };
      },
    },
  },
});

// --- node:fs/promises ---
mock.module("node:fs/promises", {
  exports: {
    readFile: async (filePath, encoding) => {
      if (typeof filePath === "string" && filePath.includes("AGENTS.md")) {
        if (mockAgentsMd === null) {
          const err = new Error("ENOENT: no such file or directory");
          err.code = "ENOENT";
          throw err;
        }
        return mockAgentsMd;
      }
      return mockSystemPrompt;
    },
  },
});

// --- openai ---
// Each call to chat.completions.create returns the next response from mockApiResponses.
mock.module("openai", {
  exports: {
    default: class OpenAI {
      constructor() {
        this.chat = {
          completions: {
            create: async (_params) => {
              const resp = mockApiResponses[mockApiIndex];
              mockApiIndex++;
              return resp;
            },
          },
        };
      }
    },
  },
});

// --- dotenv/config (side-effect only) ---
mock.module("dotenv/config", {
  exports: {},
});

// --- ./utils/index.js ---
mock.module("./utils/index.js", {
  exports: {
    loadSystemPrompt: async () => mockSystemPrompt,
    getUserInput: async () => mockUserInput,
    preview: (s, n) => {
      const str = String(s ?? "");
      return str.length <= (n ?? 200)
        ? str
        : str.slice(0, n ?? 200) + `... [${str.length} chars total]`;
    },
    printRunMetrics: (stats) => {
      printRunMetricsCalls.push(stats);
    },
    saveTrace: async (messages, iterationStats, outcome, meta) => {
      saveTraceCalls.push({ messages, iterationStats, outcome, meta });
    },
    parseToolArgs: (rawArgs) => {
      try {
        return JSON.parse(rawArgs);
      } catch {
        return null;
      }
    },
    formatToolResult: (text) => {
      return String(text ?? "");
    },
    executeToolCall: async (toolCall) => {
      return mockToolResult;
    },
    callWithRetry: async (createParams, client) => {
      return await client.chat.completions.create(createParams);
    },
    // Disk-state receipt: stubbed so tests never shell out to git.
    gitChanges: () => [],
    // Strip DeepSeek reasoning_content from assistant messages.
    cleanAssistantMessage: (msg) => {
      if (msg.role !== "assistant") return msg;
      const { reasoning_content, ...cleaned } = msg;
      return cleaned;
    },
  },
});

// --- ./tools/index.js ---
mock.module("./tools/index.js", {
  exports: {
    tools: [{ type: "function", function: { name: "test_tool" } }],
    toolImpls: { test_tool: async () => mockToolResult },
  },
});

// ===========================================================================
// Import the module under test *after* the mocks are in place.
// ===========================================================================
const { loop } = await import("./loop.js");

// ===========================================================================
// Helpers
// ===========================================================================

/**
 * Build an OpenAI API response mimicking the real SDK shape.
 * @param {object} opts
 * @param {string|null} opts.content
 * @param {Array<{name:string, args:string}>} [opts.toolCalls]
 * @param {string} [opts.finishReason]
 */
function makeApiResponse({
  content = null,
  toolCalls = [],
  finishReason = toolCalls.length > 0 ? "tool_calls" : "stop",
} = {}) {
  const message = { role: "assistant", content };
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls.map((tc, idx) => ({
      id: `call_${idx}`,
      type: "function",
      function: { name: tc.name, arguments: tc.args },
    }));
  }
  return {
    choices: [
      {
        message,
        finish_reason: finishReason,
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    },
  };
}

/** Reset all mutable mock state before each test. */
function resetMocks() {
  mockUserInput = "test question";
  mockSystemPrompt = "You are a test assistant.";
  mockAgentsMd = null;
  mockApiResponses = [];
  mockApiIndex = 0;
  mockToolResult = "mock tool result";
  saveTraceCalls = [];
  printRunMetricsCalls = [];
}

// ===========================================================================
// Tests
// ===========================================================================

describe("loop", () => {
  beforeEach(() => {
    resetMocks();
  });

  // -----------------------------------------------------------------------
  // Happy path – model responds with text, no tool calls.
  // -----------------------------------------------------------------------
  it("completes successfully when model returns content with no tool calls", async () => {
    mockApiResponses = [
      makeApiResponse({ content: "Here is your answer.", toolCalls: [] }),
    ];

    await loop();

    assert.equal(saveTraceCalls.length, 1, "saveTrace should be called once");
    assert.equal(
      saveTraceCalls[0].outcome,
      "success",
      "outcome should be success",
    );

    // Verify messages contain system, user, and assistant responses
    const msgs = saveTraceCalls[0].messages;
    assert.equal(
      msgs.length,
      3,
      "should have system, user, and assistant messages",
    );
    assert.equal(msgs[0].role, "system", "first message is system");
    assert.equal(msgs[1].role, "user", "second message is user");
    assert.equal(msgs[2].role, "assistant", "third message is assistant");
    assert.equal(
      msgs[2].content,
      "Here is your answer.",
      "assistant content matches",
    );

    // Verify iteration stats
    const stats = saveTraceCalls[0].iterationStats;
    assert.equal(stats.length, 1, "one iteration");
    assert.equal(stats[0].finishReason, "stop");
  });

  // -----------------------------------------------------------------------
  // Tool call flow – model uses a tool, then replies with text.
  // -----------------------------------------------------------------------
  it("executes a tool call and continues, then finishes on next iteration", async () => {
    mockApiResponses = [
      makeApiResponse({
        content: null,
        toolCalls: [{ name: "test_tool", args: '{"key":"value"}' }],
      }),
      makeApiResponse({ content: "Done after tool call.", toolCalls: [] }),
    ];

    await loop();

    assert.equal(
      saveTraceCalls.length,
      1,
      "saveTrace should be called once on finish",
    );
    assert.equal(
      saveTraceCalls[0].outcome,
      "success",
      "outcome should be success",
    );

    // Should have 5 messages: system, user, assistant (tool call), tool result, assistant (final)
    const msgs = saveTraceCalls[0].messages;
    assert.equal(msgs.length, 5, "system + user + 2 assistant + 1 tool result");
    assert.equal(msgs[0].role, "system");
    assert.equal(msgs[1].role, "user");
    assert.equal(msgs[2].role, "assistant");
    assert.equal(msgs[3].role, "tool");
    assert.equal(msgs[4].role, "assistant");
    assert.equal(
      msgs[4].content,
      "Done after tool call.",
      "final assistant message",
    );

    // Verify iteration stats: 2 iterations
    const stats = saveTraceCalls[0].iterationStats;
    assert.equal(stats.length, 2, "two iterations");
    assert.equal(stats[0].finishReason, "tool_calls");
    assert.equal(stats[1].finishReason, "stop");
  });

  // -----------------------------------------------------------------------
  // Max iterations exhausted — model keeps requesting tools.
  // -----------------------------------------------------------------------
  it("handles max iterations exhausted gracefully", async () => {
    // Fill the queue with MAX_ITER tool-call responses plus one more for the
    // final summary (tool_choice: "none" still returns a response).
    for (let i = 0; i < 21; i++) {
      mockApiResponses.push(
        makeApiResponse({
          content: null,
          toolCalls: [{ name: "test_tool", args: '{"key":"value"}' }],
        }),
      );
    }

    await loop();

    assert.equal(
      saveTraceCalls.length,
      1,
      "saveTrace should be called once",
    );
    assert.equal(
      saveTraceCalls[0].outcome,
      "max_iter_exhausted",
      "outcome should be max_iter_exhausted",
    );

    // The user push + final assistant = 2 extra messages beyond the loop's own
    // (system + user + 20 iterations of assistant+tool + final user + assistant).
    const msgs = saveTraceCalls[0].messages;
    assert.ok(
      msgs.length >= 42,
      `expected at least 42 messages, got ${msgs.length}`,
    );

    const stats = saveTraceCalls[0].iterationStats;
    assert.equal(stats.length, 21, "21 iterations (20 loop + 1 summary)");
    for (let i = 0; i < 20; i++) {
      assert.equal(stats[i].finishReason, "tool_calls");
    }
    assert.equal(stats[20].finishReason, "stop");
  });

  // -----------------------------------------------------------------------
  // AGENTS.md is appended to the system prompt when present.
  // -----------------------------------------------------------------------
  it("appends AGENTS.md to system prompt when it exists", async () => {
    mockAgentsMd = "## Project notes\nSome notes.";
    mockApiResponses = [
      makeApiResponse({ content: "Got it.", toolCalls: [] }),
    ];

    await loop();

    const msgs = saveTraceCalls[0].messages;
    assert.ok(
      msgs[0].content.includes("## Project notes"),
      "system prompt should include AGENTS.md content",
    );
  });

  // -----------------------------------------------------------------------
  // reasoning_content is stripped from assistant messages.
  // -----------------------------------------------------------------------
  it("strips reasoning_content from assistant messages before storing", async () => {
    // Build a response that includes reasoning_content.
    const message = {
      role: "assistant",
      content: "Final answer.",
      reasoning_content: "thinking...",
    };
    mockApiResponses = [
      {
        choices: [{ message, finish_reason: "stop" }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      },
    ];

    await loop();

    const msgs = saveTraceCalls[0].messages;
    // system, user, assistant
    assert.equal(msgs.length, 3);
    const assistantMsg = msgs[2];
    assert.equal(assistantMsg.content, "Final answer.");
    // reasoning_content should be stripped
    assert.equal(
      assistantMsg.reasoning_content,
      undefined,
      "reasoning_content should be stripped from stored message",
    );
  });

  // -----------------------------------------------------------------------
  // reasoning_content is stripped from the max-iter summary message too.
  // -----------------------------------------------------------------------
  it("strips reasoning_content in the max-iter-exhausted summary", async () => {
    // Fill the queue with 20 tool-call responses. The last one (the summary)
    // will include reasoning_content.
    for (let i = 0; i < 20; i++) {
      mockApiResponses.push(
        makeApiResponse({
          content: null,
          toolCalls: [{ name: "test_tool", args: '{"key":"value"}' }],
        }),
      );
    }
    // Summary response with reasoning_content
    const message = {
      role: "assistant",
      content: "I did x, y, z. Next step: abc.",
      reasoning_content: "model internal reasoning...",
    };
    mockApiResponses.push({
      choices: [{ message, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    await loop();

    const msgs = saveTraceCalls[0].messages;
    const lastMsg = msgs[msgs.length - 1];
    assert.equal(lastMsg.role, "assistant");
    assert.equal(
      lastMsg.reasoning_content,
      undefined,
      "reasoning_content should be stripped from summary message",
    );
  });

  // -----------------------------------------------------------------------
  // printRunMetrics is called.
  // -----------------------------------------------------------------------
  it("calls printRunMetrics on successful completion", async () => {
    mockApiResponses = [
      makeApiResponse({ content: "Done.", toolCalls: [] }),
    ];

    await loop();

    assert.equal(printRunMetricsCalls.length, 1, "printRunMetrics called once");
  });
});
