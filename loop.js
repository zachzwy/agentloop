// [done] Phase 1: A simple Q&A agent, with no tool calling, single round.
// [done] Phase 2: One tool (read_file), one round-trip. Learn the tool-calling protocol:
//          tools= schema, msg.tool_calls, the role:"tool" result message.
// [done] Phase 3: The loop. Continue while the model calls tools; stop when it replies
//          with plain text. Add a max-iteration safety cap. The model decides
//          when it's done — no external exit criteria.
// [done] Phase 4: More tools -> coding assistant: read_file, list_files, write_file, run_command.
//          Same loop, different tools and system prompt.
// [done] Phase 5: Robustness for unattended runs: tool exceptions returned as tool
//          results (not crashes), API retries, runaway context growth.
// Phase 6: The 20-task harness: ~20 concrete tasks, an unattended runner, and
//          a trace log (one JSON file per run with the full message history).
//          Scan tool results for /sk-[A-Za-z0-9]{20,}/-style patterns before writing.
// Check point and define next phases (traces from phase 6 inform what's next).

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import "dotenv/config";
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
} from "./utils/index.js";

const client = new OpenAI({
  baseURL: "https://api.deepseek.com",
  apiKey: process.env.DEEPSEEK_API_KEY,
});

const model = "deepseek-v4-flash";
const MAX_ITER = 20;

// ---------------------------------------------------------------------------
// Main loop.
// ---------------------------------------------------------------------------

export async function loop() {
  const userInput = await getUserInput();
  let systemPrompt = await loadSystemPrompt();
  const agentsMd = await readFile("AGENTS.md", "utf8").catch(() => null);
  if (agentsMd) systemPrompt += `\n\n## Project notes\n${agentsMd}`;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userInput },
  ];

  const iterationStats = [];

  // Snapshot the working tree before the run. Compared against the state at
  // save time, this is independent evidence of what the agent actually changed
  // on disk — the model's summary is a claim; this is the receipt.
  const gitChangesBefore = gitChanges();

  for (let i = 0; i < MAX_ITER; i++) {
    console.log(`\nIteration ${i + 1}\n`);

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

    iterationStats.push({
      iteration: i,
      finishReason: response.choices[0].finish_reason,
      apiMs: Date.now() - t0,
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
    });

    if (content) {
      console.log(`assistant: ${preview(content)}`);
    }

    // 2. Append model message to conversation.
    messages.push(message);

    // 3. If no tool calls → we're done.
    if (toolCalls.length === 0) {
      console.log("\nFinal formatted response:\n");
      console.log(content);

      await saveTrace(messages, iterationStats, "success", {
        model,
        maxIter: MAX_ITER,
        gitChangesBefore,
      });
      printRunMetrics(iterationStats);
      return;
    }

    // 4. Execute each tool call and push results back.
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
  });

  messages.push(message);

  console.log("\nFinal summary (step limit reached):\n");
  console.log(message.content);

  await saveTrace(messages, iterationStats, "max_iter_exhausted", {
    model,
    maxIter: MAX_ITER,
    gitChangesBefore,
  });
  printRunMetrics(iterationStats);
}

// Only auto-run when executed directly, not when imported in tests.
const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) ===
    fileURLToPath(new URL(process.argv[1], "file://"));
if (isMain) loop();
