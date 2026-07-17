// [done] Phase 1: A simple Q&A agent, with no tool calling, single round.
// [done] Phase 2: One tool (read_file), one round-trip. Learn the tool-calling protocol:
//          tools= schema, msg.tool_calls, the role:"tool" result message.
// [done] Phase 3: The loop. Continue while the model calls tools; stop when it replies
//          with plain text. Add a max-iteration safety cap. The model decides
//          when it's done — no external exit criteria.
// Phase 4: More tools -> coding assistant: write_file, list_files, run_command.
//          Same loop, different tools and system prompt.
// Phase 5: Robustness for unattended runs: tool exceptions returned as tool
//          results (not crashes), API retries, runaway context growth.
// Phase 6: The 20-task harness: ~20 concrete tasks, an unattended runner, and
//          a trace log (one JSON file per run with the full message history).
// Check point and define next phases (traces from phase 6 inform what's next).

import "dotenv/config";
import OpenAI from "openai";
import readline from "node:readline/promises";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { stdin as input, stdout as output } from "node:process";

import { tools, toolImpls } from "./tools/index.js";

const client = new OpenAI({
  baseURL: "https://api.deepseek.com",
  apiKey: process.env.DEEPSEEK_API_KEY,
});

const model = "deepseek-v4-flash";

const systemPromptPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "prompts",
  "system.md",
);

async function loadSystemPrompt() {
  return (await readFile(systemPromptPath, "utf8")).trim();
}

async function getUserInput() {
  const rl = readline.createInterface({ input, output });
  const userInput = await rl.question("Enter your question: ");
  rl.close();

  return userInput;
}

const print = (input) => console.log(JSON.stringify(input, null, 2));

async function phase1() {
  const userInput = await getUserInput();

  const response = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: userInput }],
  });

  // console.log(response.choices[0].message.content);
  print(response);
}

// phase1();

// Tools are imported from ./tools/index.js

// Maximum tool call iteration.
const MAX_ITER = 5;

// A loop with read_file tool.
async function phase3() {
  const userInput = await getUserInput();
  const systemPrompt = await loadSystemPrompt();
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userInput },
  ];

  let response;

  for (let i = 0; i < MAX_ITER; i++) {
    console.log(`\nIteration ${i}`);

    // Call model with available tools.
    response = await client.chat.completions.create({
      model,
      messages,
      tools,
      tool_choice: "auto",
    });

    console.log(`\nIteration ${i}: model response before tool call: `);
    print(response);

    // Make sure to amend the model's response before tool call.
    messages.push(response.choices[0].message);

    const toolCalls = response.choices[0].message.tool_calls ?? [];
    for (const toolCall of toolCalls) {
      const args = JSON.parse(toolCall.function.arguments);
      const toolImpl = toolImpls[toolCall.function.name];

      // Execute the function.
      const toolRes =
        toolImpl === undefined ? "Error: unknown tool" : await toolImpl(args);

      // Provide the function call results to the model.
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: toolRes,
      });
    }

    if (toolCalls.length) {
      console.log("\nMsg sent to model after tool call: ");
      print(messages);
    } else {
      console.log("\nFinal formatted response: ");
      console.log(response.choices[0].message.content);

      // Exit successfully.
      return;
    }
  }

  console.log(
    `\n[abnormal exit] hit MAX_ITER=${MAX_ITER} with the model still requesting tools`,
  );
}

phase3();
