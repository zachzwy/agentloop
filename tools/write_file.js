import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { outsideCwd } from "./guard.js";

export const schema = {
  type: "function",
  function: {
    name: "write_file",
    description:
      "Write content to a file, creating it if it doesn't exist or completely overwriting it if it does. Automatically creates parent directories.",
    parameters: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "File path, relative to the current working directory.",
        },
        content: {
          type: "string",
          description: "The exact content to write to the file.",
        },
      },
      required: ["filePath", "content"],
      additionalProperties: false,
    },
    strict: true,
  },
};

export const impl = async ({ filePath, content }) => {
  // Guardrail.
  if (outsideCwd(filePath)) {
    return `Error: '${filePath}' is outside the working directory. Only paths inside it are allowed.`;
  }

  try {
    const dir = path.dirname(filePath);
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, content, "utf8");
    return `Successfully wrote to '${filePath}'. Wrote ${content.length} chars`;
  } catch (err) {
    switch (err.code) {
      case "EACCES":
        return `Error: permission denied writing to '${filePath}'.`;
      case "EISDIR":
        return `Error: '${filePath}' is a directory, not a file.`;
      default:
        return `Error: ${err.message}`;
    }
  }
};
