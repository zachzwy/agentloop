import { readFile } from "node:fs/promises";
import path from "node:path";
import { outsideCwd } from "./guard.js";

export const schema = {
  type: "function",
  function: {
    name: "read_file",
    description:
      "Read a UTF-8 text file and return its contents. Cannot list directories",
    parameters: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "File path, relative to the current working directory.",
        },
      },
      required: ["filePath"],
      additionalProperties: false,
    },
    strict: true,
  },
};

export const impl = async ({ filePath }) => {
  if (outsideCwd(filePath)) {
    return `Error: '${filePath}' is outside the working directory. Only paths inside it are allowed.`;
  }

  const DENY = [".env", ".env.local", ".env.production"];
  if (DENY.includes(path.basename(filePath))) {
    return `Error: '${filePath}' contains secrets and cannot be read.`;
  }

  try {
    const content = await readFile(filePath, "utf8");
    // Truncation is a context-management decision.
    const MAX_CHARS = 50_000;
    return content.length <= MAX_CHARS
      ? content
      : content.slice(0, MAX_CHARS) +
          `\n[truncated: file is ${content.length} chars total]`;
  } catch (err) {
    // Errors return as strings, never throw.
    // The raw error tells the model what happened; the translation tells it what to do next.
    switch (err.code) {
      case "EISDIR":
        return `Error: '${filePath}' is a directory, not a file. read_file cannot list directories; use list_files instead.`;
      case "ENOENT":
        return `Error: no file exists at '${filePath}'. Use list_files to see what's actually here before reading.`;
      case "EACCES":
        return `Error: permission denied reading '${filePath}'.`;
      default:
        return `Error: ${err.message}`; // always keep the raw fallback
    }
  }
};
