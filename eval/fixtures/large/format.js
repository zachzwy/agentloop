// @project: demo
// Self-contained formatter — no dependencies. Ensures every .js file under src/
// ends with exactly one trailing newline.
//   node format.js           fix in place
//   node format.js --check   exit 1 if any file is unformatted, else 0
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SRC = "src";
const check = process.argv.includes("--check");

const files = (await readdir(SRC)).filter((f) => f.endsWith(".js"));
let unformatted = 0;

for (const f of files) {
  const p = path.join(SRC, f);
  const content = await readFile(p, "utf8");
  const fixed = content.replace(/\n*$/, "\n"); // exactly one trailing newline
  if (fixed !== content) {
    unformatted++;
    if (check) {
      console.log(`unformatted: ${p}`);
    } else {
      await writeFile(p, fixed, "utf8");
      console.log(`formatted: ${p}`);
    }
  }
}

if (check && unformatted > 0) {
  console.log(`${unformatted} file(s) need formatting`);
  process.exit(1);
}
console.log(check ? "all formatted" : `done (${unformatted} changed)`);
