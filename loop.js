// [done] Phase 1: A simple Q&A agent, with no tool calling, single round.
// Phase 2: One tool (read_file), one round-trip. Learn the tool-calling protocol:
//          tools= schema, msg.tool_calls, the role:"tool" result message.
// Phase 3: The loop. Continue while the model calls tools; stop when it replies
//          with plain text. Add a max-iteration safety cap. The model decides
//          when it's done — no external exit criteria.
// Phase 4: More tools -> coding assistant: write_file, list_files, run_command.
//          Same loop, different tools and system prompt.
// Phase 5: Robustness for unattended runs: tool exceptions returned as tool
//          results (not crashes), API retries, runaway context growth.
// Phase 6: The 20-task harness: ~20 concrete tasks, an unattended runner, and
//          a trace log (one JSON file per run with the full message history).
// Check point and define next phases (traces from phase 6 inform what's next).

import OpenAI from "openai";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const client = new OpenAI({
  baseURL: "https://api.deepseek.com",
  apiKey: process.env.DEEPSEEK_API_KEY,
});

async function phase1() {
  const rl = readline.createInterface({ input, output });
  const userInput = await rl.question("Enter your question: ");
  rl.close();

  const response = await client.chat.completions.create({
    model: "deepseek-v4-flash",
    messages: [{ role: "user", content: userInput }],
  });

  console.log(response.choices[0].message.content);
}

phase1();
