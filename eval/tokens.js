#!/usr/bin/env node
// @ts-check
// Tokenization, measured on this harness's own data — the hands-on companion to
// the "Fundamentals: Tokenization" slide.
//
//   node eval/tokens.js              # ratios by content type + trace files + the p13 reproduction
//   node eval/tokens.js <file...>    # char:token for specific files
//
// NOTE: uses the GPT-4 (o200k) BPE tokenizer as a representative modern
// tokenizer. DeepSeek's tokenizer gives different exact counts, but the
// phenomenon — token != char, and code/hex/prose tokenize differently — is the
// same. That's the point: a token is a learned subword unit, not a character.
import { encode } from "gpt-tokenizer";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tok = (s) => encode(s).length;
const ratio = (s) => (s.length / Math.max(1, tok(s))).toFixed(2);
const pad = (s, n) => String(s).padEnd(n);
const num = (n) => n.toLocaleString();

function row(label, s) {
  console.log(
    `  ${pad(label, 22)} ${pad(num(s.length) + " ch", 14)} ${pad(num(tok(s)) + " tok", 14)} ${ratio(s)} ch/tok`,
  );
}

async function byContentType() {
  console.log("\n== char : token ratio by content type ==");
  console.log(`  ${pad("type", 22)} ${pad("chars", 14)} ${pad("tokens", 14)} ratio`);
  row("english prose", "The agent runs in a loop: the model calls tools, results are fed back, and the model decides when it is done. No external exit criteria. ".repeat(4));
  row("source code (js)", "export async function getJson(url){const res=await fetch(url);if(!res.ok)throw new Error(`HTTP ${res.status}`);return res.json();}".repeat(4));
  row("json (structured)", JSON.stringify({ role: "assistant", tool_calls: [{ id: "call_00", function: { name: "read_file", arguments: '{"filePath":"src/util.js"}' } }] }).repeat(4));
  row("repeated chars", "x".repeat(2000));
  row("hex / high-entropy", Array.from({ length: 60 }, (_, i) => createHash("sha256").update("row-" + i).digest("hex")).join(" "));
  row("whitespace / indent", "        ".repeat(250));
  console.log("\n  -> prose packs ~4 chars/token; repeated chars pack HUGELY (BPE merges");
  console.log("     runs into one token); high-entropy hex barely merges at all.");
}

async function traceFiles() {
  const dir = path.join(ROOT, "traces");
  if (!existsSync(dir)) return;
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  if (!files.length) return;
  console.log("\n== my own trace files ==");
  console.log(`  ${pad("file", 40)} ${pad("chars", 14)} ${pad("tokens", 14)} ratio`);
  for (const f of files) {
    const s = await readFile(path.join(dir, f), "utf8");
    row(f.slice(0, 21), s);
  }
}

async function p13Reproduction() {
  console.log("\n== reproducing the p13 overflow (why the run crashed) ==");
  // The same shape of output p13's test emits: high-entropy rows.
  let out = "";
  for (let i = 0; i < 20000; i++) out += `row ${i}\tchecksum ${createHash("sha256").update("row-" + i).digest("hex")}\tstatus OK\n`;
  const chars = out.length;
  const tokens = tok(out);
  const perMB = tokens / (chars / 1_000_000);
  console.log(`  20k rows: ${num(chars)} chars -> ${num(tokens)} tokens  (${(chars / 1e6).toFixed(1)} MB, ${ratio(out)} ch/tok)`);
  console.log(`  extrapolated to run_command's 10 MB maxBuffer: ~${num(Math.round(perMB * 10))} tokens`);
  console.log(`  the actual p13 crash: 5,447,248 tokens requested vs a 1,048,576 context limit.`);
  console.log(`  => a single verbose failing command was ~5x the whole context window. Hence the fix:`);
  console.log(`     cap run_command failure output (tools/run_command.js). See docs/failure-taxonomy 1a.`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length) {
    console.log(`  ${pad("file", 40)} ${pad("chars", 14)} ${pad("tokens", 14)} ratio`);
    for (const f of args) row(path.basename(f).slice(0, 39), await readFile(f, "utf8"));
    return;
  }
  console.log("Tokenization, measured (GPT-4 o200k tokenizer as a stand-in for DeepSeek's).");
  await byContentType();
  await traceFiles();
  await p13Reproduction();
}

main();
