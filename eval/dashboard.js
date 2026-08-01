#!/usr/bin/env node
// @ts-check
// Generate a self-contained eval dashboard (HTML fragment, no external deps) from
// eval/history.jsonl: a pass-rate-over-time line, a by-probe regression matrix,
// and the latest run's task table. Emits a fragment (style + content, no
// html/head/body) so it opens standalone AND publishes directly as an artifact.
//
//   node eval/dashboard.js            # -> eval/dashboard.html
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const EVAL_ROOT = path.dirname(fileURLToPath(import.meta.url));
const HISTORY = path.join(EVAL_ROOT, "history.jsonl");
const OUT = path.join(EVAL_ROOT, "dashboard.html");

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function lineChart(runs) {
  const W = 760, H = 240, P = { l: 46, r: 18, t: 18, b: 34 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const n = runs.length;
  const x = (i) => P.l + (n === 1 ? iw / 2 : (iw * i) / (n - 1));
  const y = (pct) => P.t + ih * (1 - pct / 100);
  const pts = runs.map((r, i) => ({ i, cx: x(i), cy: y((r.passed / r.total) * 100), r }));
  const grid = [0, 50, 100]
    .map((v) => `<line x1="${P.l}" y1="${y(v)}" x2="${W - P.r}" y2="${y(v)}" class="grid"/>` +
      `<text x="${P.l - 8}" y="${y(v) + 3}" class="tick" text-anchor="end">${v}%</text>`)
    .join("");
  const poly = pts.map((p) => `${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(" ");
  const dots = pts
    .map((p) => `<circle cx="${p.cx.toFixed(1)}" cy="${p.cy.toFixed(1)}" r="4.5" class="dot">` +
      `<title>${esc(p.r.gitSha)} · ${p.r.passed}/${p.r.total} (${Math.round((p.r.passed / p.r.total) * 100)}%) · ${esc(p.r.date.slice(0, 10))}</title></circle>`)
    .join("");
  const xlabels = pts
    .map((p) => `<text x="${p.cx.toFixed(1)}" y="${H - 10}" class="tick" text-anchor="middle">${esc(p.r.gitSha)}</text>`)
    .join("");
  const last = pts[pts.length - 1];
  const lastLabel = last
    ? `<text x="${last.cx.toFixed(1)}" y="${(last.cy - 10).toFixed(1)}" class="pt-label" text-anchor="middle">${Math.round((last.r.passed / last.r.total) * 100)}%</text>`
    : "";
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Pass rate over runs">` +
    `${grid}${n > 1 ? `<polyline points="${poly}" class="series"/>` : ""}${dots}${lastLabel}${xlabels}</svg>`;
}

function probeMatrix(runs) {
  const probes = [...new Set(runs.flatMap((r) => r.tasks.flatMap((t) => t.probes)))].sort();
  const perRun = runs.map((r) => {
    const m = {};
    for (const t of r.tasks) for (const p of t.probes) {
      m[p] ??= { pass: 0, total: 0 };
      m[p].total++; if (t.pass) m[p].pass++;
    }
    return m;
  });
  const head = `<tr><th>probe</th>${runs.map((r) => `<th>${esc(r.gitSha)}</th>`).join("")}</tr>`;
  const body = probes
    .map((p) => {
      const cells = perRun
        .map((m) => {
          const c = m[p];
          if (!c) return `<td class="na">·</td>`;
          const cls = c.pass === c.total ? "ok" : c.pass === 0 ? "bad" : "warn";
          const mark = c.pass === c.total ? "✓" : "✗";
          return `<td class="${cls}"><span class="mk">${mark}</span> ${c.pass}/${c.total}</td>`;
        })
        .join("");
      return `<tr><th class="probe">${esc(p)}</th>${cells}</tr>`;
    })
    .join("");
  return `<table class="matrix"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function taskTable(run) {
  const rows = [...run.tasks]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((t) => `<tr><td class="mono">${esc(t.id)}</td>` +
      `<td class="${t.pass ? "ok" : "bad"}"><span class="mk">${t.pass ? "✓" : "✗"}</span> ${t.pass ? "PASS" : "FAIL"}</td>` +
      `<td class="mono muted">${esc(t.outcome ?? "")}</td>` +
      `<td class="muted">${esc((t.probes || []).join(", "))}</td></tr>`)
    .join("");
  return `<table class="tasks"><thead><tr><th>task</th><th>result</th><th>loop outcome</th><th>probes</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function render(runs) {
  const latest = runs[runs.length - 1];
  const pct = Math.round((latest.passed / latest.total) * 100);
  const style = `<style>
  .viz-root{color-scheme:light;--surface:#fcfcfb;--plane:#f9f9f7;--ink:#0b0b0b;--ink2:#52514e;--muted:#898781;--grid:#e1e0d9;--axis:#c3c2b7;--series:#2a78d6;--ok:#0ca30c;--bad:#d03b3b;--warn:#fab219;--ring:rgba(11,11,11,.10);
    font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--plane);color:var(--ink);padding:24px;max-width:900px;margin:0 auto;}
  @media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])) .viz-root{color-scheme:dark;--surface:#1a1a19;--plane:#0d0d0d;--ink:#fff;--ink2:#c3c2b7;--grid:#2c2c2a;--axis:#383835;--series:#3987e5;--ring:rgba(255,255,255,.10);}}
  :root[data-theme="dark"] .viz-root{color-scheme:dark;--surface:#1a1a19;--plane:#0d0d0d;--ink:#fff;--ink2:#c3c2b7;--grid:#2c2c2a;--axis:#383835;--series:#3987e5;--ring:rgba(255,255,255,.10);}
  .viz-root h1{font-size:20px;margin:0 0 2px;} .viz-root h2{font-size:13px;font-weight:600;color:var(--ink2);margin:28px 0 10px;text-transform:uppercase;letter-spacing:.04em;}
  .sub{color:var(--muted);font-size:13px;margin-bottom:20px;}
  .tiles{display:flex;gap:12px;flex-wrap:wrap;} .tile{background:var(--surface);border:1px solid var(--ring);border-radius:10px;padding:14px 18px;min-width:120px;}
  .tile .v{font-size:30px;font-weight:650;} .tile .k{font-size:12px;color:var(--muted);margin-top:2px;}
  .card{background:var(--surface);border:1px solid var(--ring);border-radius:10px;padding:14px;overflow-x:auto;}
  svg.chart{width:100%;height:auto;display:block;} .grid{stroke:var(--grid);stroke-width:1;} .tick{fill:var(--muted);font-size:11px;font-family:system-ui;}
  .series{fill:none;stroke:var(--series);stroke-width:2;} .dot{fill:var(--series);stroke:var(--surface);stroke-width:2;} .pt-label{fill:var(--ink);font-size:12px;font-weight:600;}
  table{border-collapse:collapse;font-size:13px;width:100%;} th,td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--ring);white-space:nowrap;}
  thead th{color:var(--muted);font-weight:600;font-size:12px;} .probe,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;}
  td.ok{color:var(--ok);} td.bad{color:var(--bad);} td.warn{color:var(--warn);} td.na{color:var(--muted);text-align:center;} .muted{color:var(--muted);} .mk{font-weight:700;}
  .foot{color:var(--muted);font-size:12px;margin-top:24px;}
  </style>`;
  return style + `<div class="viz-root">
  <h1>agentloop · eval dashboard</h1>
  <div class="sub">${runs.length} run(s) recorded · latest <span class="mono">${esc(latest.gitSha)}</span> · ${esc(latest.date.slice(0, 10))}</div>
  <div class="tiles">
    <div class="tile"><div class="v" style="color:var(--${pct === 100 ? "ok" : pct >= 80 ? "ink" : "bad"})">${pct}%</div><div class="k">latest pass rate</div></div>
    <div class="tile"><div class="v">${latest.passed}/${latest.total}</div><div class="k">tasks passing</div></div>
    <div class="tile"><div class="v">${runs.length}</div><div class="k">runs recorded</div></div>
  </div>
  <h2>Pass rate over runs</h2>
  <div class="card">${lineChart(runs)}</div>
  <h2>By-probe regression matrix</h2>
  <div class="card">${probeMatrix(runs)}</div>
  <h2>Latest run · ${esc(latest.gitSha)}</h2>
  <div class="card">${taskTable(latest)}</div>
  <div class="foot">Generated by <span class="mono">eval/dashboard.js</span> from <span class="mono">eval/history.jsonl</span>. ✓ pass · ✗ fail — color is paired with a mark, never alone.</div>
</div>`;
}

async function main() {
  if (!existsSync(HISTORY)) {
    console.error("no eval/history.jsonl — run an eval and `node eval/ingest-history.js` first");
    process.exit(1);
  }
  const runs = (await readFile(HISTORY, "utf8"))
    .trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .sort((a, b) => a.date.localeCompare(b.date));
  await writeFile(OUT, render(runs));
  console.log(`dashboard: ${OUT}  (${runs.length} runs)`);
}

main();
