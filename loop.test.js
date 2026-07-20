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

    assert.equal(saveTraceCalls.length, 1);
    assert.equal(saveTraceCalls[0].outcome, "success");
    assert.equal(
      saveTraceCalls[0].iterationStats.length,
      2,
      "should have 2 iterations",
    );

    // Verify the tool result was appended to messages
    const toolMessages = saveTraceCalls[0].messages.filter(
      (m) => m.role === "tool",
    );
    assert.equal(toolMessages.length, 1, "one tool result message");
    assert.equal(toolMessages[0].content, "mock tool result");

    // Verify the assistant message with tool_calls was recorded
    const assistantWithToolCall = saveTraceCalls[0].messages.find(
      (m) => m.role === "assistant" && m.tool_calls,
    );
    assert.ok(
      assistantWithToolCall,
      "assistant message with tool_calls exists",
    );
  });

  // -----------------------------------------------------------------------
  // Multiple tool calls in one iteration.
  // -----------------------------------------------------------------------
  it("executes multiple tool calls in a single iteration", async () => {
    mockApiResponses = [
      makeApiResponse({
        content: null,
        toolCalls: [
          { name: "test_tool", args: '{"a":1}' },
          { name: "test_tool", args: '{"b":2}' },
        ],
      }),
      makeApiResponse({ content: "All done.", toolCalls: [] }),
    ];

    await loop();

    assert.equal(saveTraceCalls.length, 1);
    assert.equal(saveTraceCalls[0].outcome, "success");

    const toolMessages = saveTraceCalls[0].messages.filter(
      (m) => m.role === "tool",
    );
    assert.equal(toolMessages.length, 2, "two tool result messages");
  });

  // -----------------------------------------------------------------------
  // Tool call with an error result – loop should not crash.
  // -----------------------------------------------------------------------
  it("handles tool execution errors gracefully and continues", async () => {
    mockToolResult = "Error: something went wrong";
    mockApiResponses = [
      makeApiResponse({
        content: null,
        toolCalls: [{ name: "test_tool", args: "{}" }],
      }),
      makeApiResponse({ content: "Recovered from error.", toolCalls: [] }),
    ];

    await loop();

    assert.equal(saveTraceCalls.length, 1);
    assert.equal(saveTraceCalls[0].outcome, "success");

    const toolMessages = saveTraceCalls[0].messages.filter(
      (m) => m.role === "tool",
    );
    assert.equal(toolMessages.length, 1);
    assert.match(
      toolMessages[0].content,
      /Error/,
      "tool result should contain the error",
    );
  });

  // -----------------------------------------------------------------------
  // AGENTS.md appended to system prompt when present.
  // -----------------------------------------------------------------------
  it("appends AGENTS.md content to the system prompt when the file exists", async () => {
    mockAgentsMd = "Some project notes content.";
    mockApiResponses = [makeApiResponse({ content: "OK", toolCalls: [] })];

    await loop();

    const systemMsg = saveTraceCalls[0].messages.find(
      (m) => m.role === "system",
    );
    assert.ok(
      systemMsg.content.includes("Some project notes content."),
      "system prompt should include AGENTS.md content",
    );
    assert.ok(
      systemMsg.content.includes("## Project notes"),
      "system prompt should have the project notes header",
    );
  });

  // -----------------------------------------------------------------------
  // AGENTS.md not present – no modification to system prompt.
  // -----------------------------------------------------------------------
  it("does not modify system prompt when AGENTS.md is missing", async () => {
    mockAgentsMd = null; // simulate ENOENT
    mockApiResponses = [makeApiResponse({ content: "OK", toolCalls: [] })];

    await loop();

    const systemMsg = saveTraceCalls[0].messages.find(
      (m) => m.role === "system",
    );
    assert.equal(systemMsg.content, mockSystemPrompt);
    assert.ok(
      !systemMsg.content.includes("Project notes"),
      "should not contain project notes header",
    );
  });

  // -----------------------------------------------------------------------
  // Max iterations exhausted – graceful summary with tool_choice: "none".
  // -----------------------------------------------------------------------
  it("handles max iterations exhausted by producing a summary", async () => {
    // The model keeps requesting tools for MAX_ITER (20) iterations.
    // The 21st call (with tool_choice: "none") returns a summary.
    const toolCall = { name: "test_tool", args: "{}" };
    for (let i = 0; i < 20; i++) {
      mockApiResponses.push(
        makeApiResponse({ content: null, toolCalls: [toolCall] }),
      );
    }
    // The final summary call (tool_choice: "none")
    mockApiResponses.push(
      makeApiResponse({ content: "Summary of work done." }),
    );

    await loop();

    assert.equal(saveTraceCalls.length, 1);
    assert.equal(
      saveTraceCalls[0].outcome,
      "max_iter_exhausted",
      "outcome should be max_iter_exhausted",
    );
    assert.equal(
      saveTraceCalls[0].iterationStats.length,
      21,
      "20 regular iterations + 1 summary iteration",
    );

    // The last iteration should have finish_reason "stop" (summary call)
    const lastStat = saveTraceCalls[0].iterationStats.at(-1);
    assert.equal(lastStat.finishReason, "stop");

    // Count all assistant messages (20 tool-calling + 1 summary)
    const assistantMessages = saveTraceCalls[0].messages.filter(
      (m) => m.role === "assistant",
    );
    assert.equal(
      assistantMessages.length,
      21,
      "20 tool-calling + 1 summary assistant messages",
    );

    // Verify the summary content appears
    const lastAssistant = assistantMessages.at(-1);
    assert.equal(
      lastAssistant.content,
      "Summary of work done.",
      "summary content should be the last assistant message",
    );
  });

  // -----------------------------------------------------------------------
  // Model returns content and tool calls in the same response.
  // -----------------------------------------------------------------------
  it("handles model returning both content and tool calls", async () => {
    mockApiResponses = [
      makeApiResponse({
        content: "I will use a tool.",
        toolCalls: [{ name: "test_tool", args: '{"x":1}' }],
      }),
      makeApiResponse({ content: "Done.", toolCalls: [] }),
    ];

    await loop();

    assert.equal(saveTraceCalls.length, 1);
    assert.equal(saveTraceCalls[0].outcome, "success");
    assert.equal(
      saveTraceCalls[0].iterationStats.length,
      2,
      "should have 2 iterations",
    );

    // The first assistant message should have both content and tool_calls
    const firstAssistant = saveTraceCalls[0].messages.find(
      (m) => m.role === "assistant" && m.tool_calls,
    );
    assert.ok(firstAssistant, "assistant message with tool_calls exists");
    assert.equal(firstAssistant.content, "I will use a tool.");
    assert.equal(firstAssistant.tool_calls.length, 1);
  });

  // -----------------------------------------------------------------------
  // printRunMetrics is called on successful completion.
  // -----------------------------------------------------------------------
  it("calls printRunMetrics on success", async () => {
    mockApiResponses = [
      makeApiResponse({ content: "Quick answer.", toolCalls: [] }),
    ];

    await loop();

    assert.equal(
      printRunMetricsCalls.length,
      1,
      "printRunMetrics should be called once on success",
    );
  });

  // -----------------------------------------------------------------------
  // printRunMetrics is called on max_iter_exhausted.
  // -----------------------------------------------------------------------
  it("calls printRunMetrics on max iterations exhausted", async () => {
    const toolCall = { name: "test_tool", args: "{}" };
    for (let i = 0; i < 20; i++) {
      mockApiResponses.push(
        makeApiResponse({ content: null, toolCalls: [toolCall] }),
      );
    }
    mockApiResponses.push(makeApiResponse({ content: "Summary." }));

    await loop();

    assert.equal(
      printRunMetricsCalls.length,
      1,
      "printRunMetrics should be called once on max_iter_exhausted",
    );
  });

  // -----------------------------------------------------------------------
  // saveTrace receives correct meta.
  // -----------------------------------------------------------------------
  it("passes model and maxIter metadata to saveTrace", async () => {
    mockApiResponses = [makeApiResponse({ content: "Answer.", toolCalls: [] })];

    await loop();

    const meta = saveTraceCalls[0].meta;
    assert.equal(meta.model, "deepseek-v4-flash");
    assert.equal(meta.maxIter, 20);
  });
});
