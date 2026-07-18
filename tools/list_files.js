import { readdir } from "node:fs/promises";
import { outsideCwd } from "./guard.js";

export const schema = {
  type: "function",
  function: {
    name: "list_files",
    description: "List files and directories in a given directory path.",
    parameters: {
      type: "object",
      properties: {
        dirPath: {
          type: "string",
          description:
            "Directory path, relative to the current working directory.",
        },
      },
      required: ["dirPath"],
      additionalProperties: false,
    },
    strict: true,
  },
};

export const impl = async ({ dirPath }) => {
  if (outsideCwd(dirPath)) {
    return `Error: '${dirPath}' is outside the working directory. Only paths inside it are allowed.`;
  }

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    if (entries.length === 0) {
      return `Directory '${dirPath}' is empty.`;
    }
    return entries
      .map((entry) => {
        const type = entry.isDirectory() ? "[DIR]" : "[FILE]";
        return `${type} ${entry.name}`;
      })
      .join("\n");
  } catch (err) {
    switch (err.code) {
      case "ENOENT":
        return `Error: directory does not exist at '${dirPath}'.`;
      case "ENOTDIR":
        return `Error: '${dirPath}' is not a directory.`;
      case "EACCES":
        return `Error: permission denied listing '${dirPath}'.`;
      default:
        return `Error: ${err.message}`;
    }
  }
};
