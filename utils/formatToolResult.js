import { preview } from "./logger.js";

const TOOL_RESULT_INDENT = "     ";

/** Indent continuation lines of a multi-line preview for readability. */
export function formatToolResult(text) {
  const lines = preview(text).split("\n");
  return lines
    .map((line, idx) => (idx === 0 ? line : `${TOOL_RESULT_INDENT}${line}`))
    .join("\n");
}
