import * as readFileMod from "./read_file.js";
import * as listFilesMod from "./list_files.js";
import * as writeFileMod from "./write_file.js";
import * as runCommandMod from "./run_command.js";
import * as wikiSearchMod from "./wiki_search.js";
import * as wikiReadMod from "./wiki_read.js";

// The standard coding tools — the default tool set for a normal agentloop run.
const modules = [readFileMod, listFilesMod, writeFileMod, runCommandMod];
export const tools = modules.map((m) => m.schema);

// Wiki tools are testbed-only (the wiki-navigation eval), so they're NOT in the
// default `tools` set — a run opts into them (see eval/wiki-eval.js), which is
// what makes the augmented-vs-baseline comparison clean.
const wikiModules = [wikiSearchMod, wikiReadMod];
export const wikiTools = wikiModules.map((m) => m.schema);

// Dispatch table covers ALL tools; the schema list passed per run decides which
// the model is actually offered.
export const toolImpls = Object.fromEntries(
  [...modules, ...wikiModules].map((m) => [m.schema.function.name, m.impl]),
);
