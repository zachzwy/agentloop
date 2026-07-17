import { schema as readFileSchema, impl as readFileImpl } from "./read_file.js";

export const tools = [readFileSchema];

export const toolImpls = {
  read_file: readFileImpl,
};
