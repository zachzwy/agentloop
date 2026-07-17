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

import "dotenv/config";
import OpenAI from "openai";
import readline from "node:readline/promises";
import { readFile } from "node:fs/promises";
import { stdin as input, stdout as output } from "node:process";

const client = new OpenAI({
  baseURL: "https://api.deepseek.com",
  apiKey: process.env.DEEPSEEK_API_KEY,
});

const model = "deepseek-v4-flash";

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

// One self-defined simple function tool + read_file tool.
async function phase2() {
  const userInput = await getUserInput();

  // Define a list of callable tools for the model.
  const tools = [
    {
      type: "function",
      function: {
        name: "unhelpful_responder",
        description:
          "An unhelpful responder that always responds 'I dont know' regardless of the input.",
        parameters: {
          type: "object",
          properties: {
            question: {
              type: "string",
              description: "The input to the unhelpful responder.",
            },
          },
          required: ["question"],
          additionalProperties: false,
        },
        strict: true,
      },
    },
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Read a UTF-8 text file and return its contents.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "File path, relative to the current working directory.",
            },
          },
          required: ["path"],
          additionalProperties: false,
        },
        strict: true,
      },
    },
  ];

  const unhelpfulResponder = ({ question }) =>
    `regarding your question ${question}: I don't know.`;

  const readFileTool = async ({ path }) => {
    try {
      const content = await readFile(path, "utf8");
      // Truncation is a context-management decision.
      const MAX_CHARS = 50_000;
      return content.length <= MAX_CHARS
        ? content
        : content.slice(0, MAX_CHARS) +
            `\n[truncated: file is ${content.length} chars total]`;
    } catch (err) {
      // Errors return as strings, never throw.
      return `Error: ${err.message}`;
    }
  };

  const messages = [{ role: "user", content: userInput }];

  // First time calling model with available tools.
  let response = await client.chat.completions.create({
    model,
    messages,
    tools,
    tool_choice: "auto",
  });

  console.log("\nModel response before tool call: ");
  print(response);

  // Make sure to amend the model's response before tool call.
  messages.push(response.choices[0].message);

  const toolImpls = {
    unhelpful_responder: unhelpfulResponder,
    read_file: readFileTool,
  };

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

    // Second time calling model with tool call results.
    response = await client.chat.completions.create({
      model,
      messages,
      tools,
    });

    console.log("\nModel response after tool call: ");
    print(response);

    console.log(response.choices[0].message.content);
  }
}

phase2();
