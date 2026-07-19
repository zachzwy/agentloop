import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const systemPromptPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "prompts",
  "system.md",
);

export async function loadSystemPrompt() {
  return (await readFile(systemPromptPath, "utf8")).trim();
}
