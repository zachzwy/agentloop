import * as readFileMod from "./read_file.js";
import * as listFilesMod from "./list_files.js";
import * as writeFileMod from "./write_file.js";

const modules = [readFileMod, listFilesMod, writeFileMod];
export const tools = modules.map((m) => m.schema);
export const toolImpls = Object.fromEntries(
  modules.map((m) => [m.schema.function.name, m.impl]),
);
