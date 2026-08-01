import { writeFile, mkdir, stat, open } from "node:fs/promises";
import path from "node:path";
import { outsideCwd } from "./guard.js";

// A file larger than read_file's 8k window can hide content past what a single
// read shows. write_file overwrites whole-file, so an agent that read only the
// truncated head and writes it back silently destroys the unseen tail (measured
// at ~20% of large-file edits — eval/tasks/p11-truncate-clobber).
const READ_WINDOW = 8000;
const TAIL_BYTES = 240;

/**
 * For an existing file bigger than the read window, return a distinctive slice
 * of its END. If the content about to be written doesn't contain that slice,
 * the write is dropping the tail — a clobber — and should be refused. A genuine
 * edit (whole file read via cat/full read, then one line changed) keeps the tail
 * and passes; only a partial-read overwrite fails. Returns null when the guard
 * doesn't apply (new file, small file, or unreadable).
 */
async function existingTail(filePath) {
  const st = await stat(filePath).catch(() => null);
  if (!st || !st.isFile() || st.size <= READ_WINDOW) return null;
  const n = Math.min(TAIL_BYTES, st.size);
  const fh = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(n);
    await fh.read(buf, 0, n, st.size - n);
    let tail = buf.toString("utf8");
    const nl = tail.indexOf("\n"); // drop a possibly-partial leading line/char
    if (nl !== -1) tail = tail.slice(nl + 1);
    return { tail: tail.trim(), size: st.size };
  } finally {
    await fh.close();
  }
}

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

  // Clobber guard: refuse to overwrite a large existing file with content that
  // drops its tail (data the agent likely never saw past the read window).
  const prior = await existingTail(filePath).catch(() => null);
  if (prior && prior.tail && !content.includes(prior.tail)) {
    return (
      `Error: refusing to overwrite '${filePath}'. The new content is missing the end of the ` +
      `existing ${prior.size}-char file, which is longer than a single read_file shows (${READ_WINDOW} chars). ` +
      `Overwriting would silently delete data past what you have seen. Read the ENTIRE file first ` +
      `(its full content, e.g. with a full read) and include everything you want to keep — or make a smaller, targeted change.`
    );
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
