// [done] Step 1: A simple Q&A agent, with no tool calling, single round.
// [done] Step 2: One tool (read_file), one round-trip. Learn the tool-calling protocol:
//          tools= schema, msg.tool_calls, the role:"tool" result message.
// [done] Step 3: The loop. Continue while the model calls tools; stop when it replies
//          with plain text. Add a max-iteration safety cap. The model decides
//          when it's done — no external exit criteria.
// [done] Step 4: More tools -> coding assistant: read_file, list_files, write_file, run_command.
//          Same loop, different tools and system prompt.
// [done] Step 5: Robustness for unattended runs: tool exceptions returned as tool
//          results (not crashes), API retries, runaway context growth.
// Step 6: The 20-task harness: ~20 concrete tasks, an unattended runner, and
//          a trace log (one JSON file per run with the full message history).
//          Scan tool results for /sk-[A-Za-z0-9]{20,}/-pattern before writing.
// Check point and define next phases (traces from phase 6 inform what's next).

import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import OpenAI from "openai";
import { tools } from "./tools/index.js";
import {
  loadSystemPrompt,
  getUserInput,
  preview,
  saveTrace,
  printRunMetrics,
  parseToolArgs,
  formatToolResult,
  executeToolCall,
  callWithRetry,
  gitChanges,
  cleanAssistantMessage,
} from "./utils/index.js";

const HARNESS_ROOT = path.dirname(fileURLToPath(import.meta.url));

// Load the key from the HARNESS's .env, not cwd's. Under dir-separation cwd is
// the target project, so `import "dotenv/config"` (which reads cwd/.env) would
// silently miss the key. dotenv does NOT override existing process.env, so a
// real `-e DEEPSEEK_API_KEY=...` (e.g. in a container) still wins — the .env is
// only the local-dev fallback.
dotenv.config({ path: path.join(HARNESS_ROOT, ".env"), quiet: true });

// True only when run directly (`node loop.js`), false when imported by tests.
const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) ===
    fileURLToPath(new URL(process.argv[1], "file:"));

// Fail fast on a missing key, but only for a real run — importing the module in
// tests (where OpenAI is mocked) must not exit the process.
if (isMain && !process.env.DEEPSEEK_API_KEY) {
  console.error(
    "Error: DEEPSEEK_API_KEY is not set. Provide it via the environment " +
      `(e.g. -e DEEPSEEK_API_KEY=...) or in ${path.join(HARNESS_ROOT, ".env")}.`,
  );
  process.exit(1);
}

const client = new OpenAI({
  baseURL: "https://api.deepseek.com",
  apiKey: process.env.DEEPSEEK_API_KEY,
  // The SDK retries internally (default 2). Disable it so callWithRetry is the
  // only retry layer — otherwise attempts multiply (5 x 3 = up to 15 requests).
  maxRetries: 0,
});

const model = "deepseek-v4-flash";
const MAX_ITER = 20;

// Context-limit guard.
// The LLM's context length is 1M tokens. We apply a 0.7 safety factor so the
// guard trips at 700K prompt tokens, leaving headroom for the response.
const CONTEXT_LIMIT = 1_000_000;
const PROMPT_LIMIT = Math.floor(CONTEXT_LIMIT * 0.7); // 700 000

// ---------------------------------------------------------------------------
// Main loop.
// ---------------------------------------------------------------------------

/**
 * Run one agent task to completion.
 *
 * @param {object} [opts]
 * @param {string} [opts.prompt] - The task. If omitted, prompt interactively
 *   (the `node loop.js` path). Passing it in is the headless/batch entry.
 * @returns {Promise<{ outcome: string, tracePath: string }>} for the eval runner.
 */
export async function loop({ prompt } = {}) {
  const userInput = prompt ?? (await getUserInput());
  let systemPrompt = await loadSystemPrompt();
  const agentsMd = await readFile("AGENTS.md", "utf8").catch(() => null);
  if (agentsMd) systemPrompt += `\n\n## Project notes\n${agentsMd}`;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userInput },
  ];

  const iterationStats = [];

  // Tracks the actual prompt_tokens from the most recent API response.
  // Used in the context-limit guard: since messages only grow, the next
  // iteration's prompt will be at least as large as the previous one.
  // Initialised to 0 so the guard naturally skips on the first iteration
  // (no prior response data yet).
  let lastPromptTokens = 0;

  // Snapshot the working tree before the run. Compared against the state at
  // save time, this is independent evidence of what the agent actually changed
  // on disk — the model's summary is a claim; this is the receipt.
  const gitChangesBefore = gitChanges();

  for (let i = 0; i < MAX_ITER; i++) {
    console.log(`\nIteration ${i + 1}\n`);

    // --- Context-limit guard ---
    // Uses the actual prompt_tokens returned by the model from the previous
    // call — more accurate than a byte-length heuristic. Since messages only
    // grow, this is a conservative lower bound for the upcoming call.
    // On the first iteration (i === 0) lastPromptTokens is 0, so the check
    // is naturally skipped (no prior API data yet).
    if (lastPromptTokens > PROMPT_LIMIT) {
      console.warn(
        `\n[context limit] Previous prompt was ${lastPromptTokens} tokens ` +
          `(limit ${PROMPT_LIMIT}). Asking model for a final summary.\n`,
      );

      // Give the model one last turn with tools disabled so it summarises what
      // it accomplished, instead of discarding the work mid-step.
      messages.push({
        role: "user",
        content:
          "You have exceeded the context limit and cannot call any more tools. " +
          "Summarize what you accomplished, what remains unfinished, and the exact next step.",
      });

      const t0 = Date.now();
      const response = await callWithRetry(
        {
          model,
          messages,
          tool_choice: "none",
        },
        client,
      );

      const { message } = response.choices[0];

      iterationStats.push({
        iteration: i,
        finishReason: response.choices[0].finish_reason,
        apiMs: Date.now() - t0,
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
        reasoning: message.reasoning_content ?? null,
      });

      messages.push(cleanAssistantMessage(message));

      console.log("\nFinal summary (context limit reached):\n");
      console.log(message.content);

      const tracePath = await saveTrace(
        messages,
        iterationStats,
        "context_limit_exceeded",
        { model, maxIter: MAX_ITER, gitChangesBefore },
      );
      printRunMetrics(iterationStats);
      return { outcome: "context_limit_exceeded", tracePath };
    }

    // 1. Call model (with retries).
    const t0 = Date.now();
    const response = await callWithRetry(
      {
        model,
        messages,
        tools,
      },
      client,
    );

    const { message } = response.choices[0];
    const { tool_calls: toolCalls = [], content } = message;

    const promptTokens = response.usage?.prompt_tokens ?? 0;
    lastPromptTokens = promptTokens;

    iterationStats.push({
      iteration: i,
      finishReason: response.choices[0].finish_reason,
      apiMs: Date.now() - t0,
      promptTokens,
      completionTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
      // Stripped from the sent message by cleanAssistantMessage; kept here so
      // the trace still records the model's stated intent (key for triage).
      reasoning: message.reasoning_content ?? null,
    });

    if (content) {
      console.log(`assistant: ${preview(content)}`);
    }

    // 2. Append model message to conversation (strip reasoning_content first).
    messages.push(cleanAssistantMessage(message));

    // 3. If no tool calls → we're done.
    if (toolCalls.length === 0) {
      console.log("\nFinal formatted response:\n");
      console.log(content);

      const tracePath = await saveTrace(messages, iterationStats, "success", {
        model,
        maxIter: MAX_ITER,
        gitChangesBefore,
      });
      printRunMetrics(iterationStats);
      return { outcome: "success", tracePath };
    }

    // 4. Execute each tool calls and push results back.
    for (const toolCall of toolCalls) {
      console.log(
        `  -> ${toolCall.function.name} ${toolCall.function.arguments}`,
      );

      const result = await executeToolCall(toolCall);
      console.log(`  <- ${formatToolResult(result)}`);

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }
  }

  // Max iterations exhausted. Land gracefully: give the model one last turn
  // with tools disabled so it summarizes what it accomplished, instead of
  // discarding the work. Without this a finished task can look like a failure.
  console.log(
    `\n[abnormal exit] hit MAX_ITER=${MAX_ITER} with the model still requesting tools`,
  );

  messages.push({
    role: "user",
    content:
      "You have reached the step limit and cannot call any more tools. " +
      "Summarize what you accomplished, what remains unfinished, and the exact next step.",
  });

  const t0 = Date.now();
  const response = await callWithRetry(
    {
      model,
      messages,
      tool_choice: "none",
    },
    client,
  );

  const { message } = response.choices[0];

  iterationStats.push({
    iteration: MAX_ITER,
    finishReason: response.choices[0].finish_reason,
    apiMs: Date.now() - t0,
    promptTokens: response.usage?.prompt_tokens ?? 0,
    completionTokens: response.usage?.completion_tokens ?? 0,
    totalTokens: response.usage?.total_tokens ?? 0,
    reasoning: message.reasoning_content ?? null,
  });

  messages.push(cleanAssistantMessage(message));

  console.log("\nFinal summary (step limit reached):\n");
  console.log(message.content);

  const tracePath = await saveTrace(
    messages,
    iterationStats,
    "max_iter_exhausted",
    { model, maxIter: MAX_ITER, gitChangesBefore },
  );
  printRunMetrics(iterationStats);
  return { outcome: "max_iter_exhausted", tracePath };
}

// Only auto-run when executed directly, not when imported in tests.
if (isMain) {
  loop();
}

export { client, model };
