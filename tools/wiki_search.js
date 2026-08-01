import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

// The wiki is a directory of markdown pages, pointed to by AGENTLOOP_WIKI_DIR.
// This is keyword search (navigation model), NOT vector/RAG — the agent decides
// what to look up and reads pages itself, the way it navigates a filesystem.
const wikiDir = () => process.env.AGENTLOOP_WIKI_DIR;

export const schema = {
  type: "function",
  function: {
    name: "wiki_search",
    description:
      "Search the project wiki by keyword. Returns matching pages as [id] Title + a snippet, best match first. Open a page with wiki_read.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Keywords to search the wiki for.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    strict: true,
  },
};

export const impl = async ({ query }) => {
  const dir = wikiDir();
  if (!dir) return "Error: no wiki is configured (AGENTLOOP_WIKI_DIR unset).";

  let files;
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  } catch {
    return "Error: the wiki directory could not be read.";
  }

  const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return "Error: empty query.";

  const results = [];
  for (const f of files) {
    const content = await readFile(path.join(dir, f), "utf8");
    const lc = content.toLowerCase();
    // Score by distinct query terms present (title hits weighted higher).
    const title = content.match(/^#\s*(.+)/m)?.[1]?.trim() ?? f;
    const titleLc = title.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (titleLc.includes(t)) score += 2;
      else if (lc.includes(t)) score += 1;
    }
    if (score > 0) {
      const line =
        content
          .split("\n")
          .find((l) => terms.some((t) => l.toLowerCase().includes(t))) ?? "";
      results.push({
        id: f.replace(/\.md$/, ""),
        title,
        snippet: line.trim().replace(/^#+\s*/, "").slice(0, 160),
        score,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  if (!results.length) return `No wiki pages matched "${query}".`;
  return results
    .slice(0, 5)
    .map((r) => `[${r.id}] ${r.title}\n  ${r.snippet}`)
    .join("\n");
};
