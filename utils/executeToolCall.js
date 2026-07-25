import { parseToolArgs } from "./parseToolArgs.js";
import { toolImpls } from "../tools/index.js";

/** Execute a single tool call and return the result string. */
export async function executeToolCall(toolCall) {
  const args = parseToolArgs(toolCall.function.arguments);
  if (args === null) {
    return `Error: could not parse arguments for ${toolCall.function.name}`;
  }

  const toolImpl = toolImpls[toolCall.function.name];
  if (toolImpl === undefined) {
    return `Error: unknown tool "${toolCall.function.name}"`;
  }

  // Exception firewall. Tools are designed to return error strings, never
  // throw — but a bug, or a malformed arg reaching e.g. path.resolve() before a
  // tool's own try block, could still throw. Catching it here (rather than
  // trusting every tool) is what makes that invariant hold: one bad tool call
  // returns a recoverable error to the model instead of crashing the whole run.
  try {
    // The API requires tool result `content` to be a string, so guarantee one.
    return String((await toolImpl(args)) ?? "");
  } catch (err) {
    return `Error: tool "${toolCall.function.name}" failed: ${err?.message ?? String(err)}`;
  }
}
