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

  return await toolImpl(args);
}
