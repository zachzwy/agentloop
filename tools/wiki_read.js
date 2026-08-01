import { readFile } from "node:fs/promises";
import path from "node:path";

const wikiDir = () => process.env.AGENTLOOP_WIKI_DIR;

export const schema = {
  type: "function",
  function: {
    name: "wiki_read",
    description:
      "Read a wiki page by its id (from wiki_search results). Returns the full page content.",
    parameters: {
      type: "object",
      properties: {
        pageId: {
          type: "string",
          description: "The page id, e.g. 'deploy-orion' (no .md).",
        },
      },
      required: ["pageId"],
      additionalProperties: false,
    },
    strict: true,
  },
};

export const impl = async ({ pageId }) => {
  const dir = wikiDir();
  if (!dir) return "Error: no wiki is configured (AGENTLOOP_WIKI_DIR unset).";

  const id = String(pageId).replace(/\.md$/, "");
  // Page ids are flat slugs — reject anything that could traverse the wiki dir.
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) {
    return `Error: invalid page id "${pageId}". Use an id from wiki_search.`;
  }
  try {
    return await readFile(path.join(dir, id + ".md"), "utf8");
  } catch {
    return `Error: no wiki page "${pageId}". Use wiki_search to find pages.`;
  }
};
