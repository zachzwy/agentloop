#!/usr/bin/env node
// @ts-check
// Mini auto-ingest: raw source records -> a navigation wiki (markdown pages).
// Two modes, to measure why reconciliation matters:
//
//   node eval/wiki-ingest.js naive       # one page per source — dumps stale + duplicate + current
//   node eval/wiki-ingest.js reconcile   # group by topic, keep the LATEST — dedup + supersede stale
//
// Then grade the two wikis with eval/wiki-eval.js (conditions ingest-naive /
// ingest-reconcile). Naive collapses (contradictions); reconcile holds. This is
// the write-path (auto-ingest) rehearsal — the ADD/UPDATE/dedup decision, the
// deterministic version. Production would match same-topic sources with an
// LLM/embedding instead of a topic tag (à la Mem0), but the lesson is identical.
import { readFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EVAL_ROOT = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = path.join(EVAL_ROOT, "fixtures", "wiki-sources", "sources.json");

function pagesFor(mode, sources) {
  if (mode === "naive") {
    // Append everything: every source becomes its own page. Stale versions and
    // exact duplicates all land in the wiki, contradicting each other.
    return sources.map((s) => ({ file: s.id, title: s.title, body: s.body }));
  }
  // reconcile: one page per topic, keeping the source with the latest timestamp
  // (supersede stale) — which also collapses exact duplicates (dedup).
  const latest = new Map();
  for (const s of sources) {
    const cur = latest.get(s.topic);
    if (!cur || s.ts > cur.ts) latest.set(s.topic, s);
  }
  return [...latest.values()].map((s) => ({ file: s.topic, title: s.title, body: s.body }));
}

async function main() {
  const mode = process.argv[2] === "reconcile" ? "reconcile" : "naive";
  const out =
    process.argv[3] ?? path.join(EVAL_ROOT, "fixtures", `wiki-ingest-${mode}`);

  const sources = JSON.parse(await readFile(SOURCES, "utf8"));
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  const pages = pagesFor(mode, sources);
  for (const p of pages) {
    await writeFile(path.join(out, `${p.file}.md`), `# ${p.title}\n\n${p.body}\n`);
  }
  await writeFile(path.join(out, "README.md"), "# Team wiki\n\nAuto-ingested from sources.\n");

  console.log(`ingest[${mode}] -> ${out}`);
  console.log(`  ${sources.length} sources -> ${pages.length} pages` +
    (mode === "reconcile" ? `  (deduped + kept latest per topic)` : `  (appended every source)`));
}

main();
