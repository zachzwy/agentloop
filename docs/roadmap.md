# agentloop status & roadmap (checkpoint 2026-08-01)

All six build steps are done. The project has moved from *building the harness* to
*using its own eval loop to find and fix real harness bugs* — which is where the
interesting work now is.

---

## What the eval loop has proven since the last checkpoint

The point of the harness is that it can measure itself. It has, three times over —
each a real defect found by a task, fixed, and re-measured:

| Bug | Found by | Fix | Result |
| --- | -------- | --- | ------ |
| Verbose failing command overflows context → run crashes | `p13-verbose-fail-overflow` | cap `run_command` **failure** output (keep the tail) | `ERROR` → `PASS` |
| A malformed tool call throws → run crashes | harness review | exception firewall in `executeToolCall` | crash → recoverable error string |
| Large-file edit silently destroys unseen data | `p11-truncate-clobber` | `write_file` clobber guard (refuse tail-dropping overwrite) | **2/10 → 0/10** data loss (10 runs each) |

The p11 result is the template for how this project measures: a *rate*, not a
single pass/fail (Learnings #16/#17). The bug fired ~20% of the time depending on
the model's stochastic choices; the fix makes the bad outcome structurally
impossible, so randomness now only costs steps, never data.

## Where each area stands

| Area | State |
| ---- | ----- |
| **Agent loop + tools** | Done. 5 tools, headless `loop({prompt})`, graceful landing, retries. 12 eval tasks. |
| **Eval harness** | Runner + external grader (receipts) + by-probe regression rollup + `summary.json`. **Missing:** a quality-over-time dashboard and a CI gate. |
| **Error analysis** | Strong and active — 3 bugs found/fixed/measured; methodology in `eval-harness-plan.md` Part 2. **Missing:** a consolidated failure-taxonomy doc. |
| **Command safety (H3)** | Done and deep: no-shell exec, positional-matching policy, fail-closed, bwrap + Docker, Finding A. Written up publicly. |
| **Context management** | Premise **challenged by measurement**: growth doesn't run away (p7 15-file vs p10 67-file, sub-linear), and the real context risk turned out to be a *tool-output bug* (p13), not model greed. |
| **Agent memory / compaction** | Not started. See the open question below. |
| **Fundamentals slice** | Not started (tokenization, attention/KV-cache, sampling). p13 (token overflow) and p11 (sampling nondeterminism) are concrete hooks. |
| **Reference-harness study (pi)** | Not started. The H3 work is the natural entry (pi's "no in-harness permissions, sandbox externally" vs. Finding A). |

## The open question the data raised

The project began on the bet that **context/memory is the hardest, most
differentiating problem**. Two signals now push back:

1. Measured context growth is controlled, not runaway (p7/p10).
2. Every measured *win so far* came from **harness robustness**, not memory
   (p11 2/10→0/10, AGENTS.md 21→14 iters, p13 crash→recover).

Before investing a full phase in compaction/memory, it's worth confirming the
problem is actually acute — with a harder context stress (large *files*, not just
many files, to defeat the 8k truncation) and outside input. The candidate
"before/after graph" the project set out to produce may come from a different
lever than memory.

## Update — 2026-08-13

Since the checkpoint above, the work moved from the harness to **knowledge quality
for agents**, using this repo as the testbed:

- **Wiki-navigation testbed** (`eval/wiki-eval.js`, `eval/wiki-tasks/`) — an agent
  with `wiki_search` + `wiki_read` answering questions whose answers exist only in
  a wiki of synthetic facts. Baseline (no wiki) 0/4 → augmented 4/4, so the tasks
  are honest and the lift is attributable.
- **Ingest-quality degradation curve** — the same questions against wikis of
  decreasing quality, as a rate: clean **100%** → stale contradiction present
  **8%** → stale contradiction outranking the correct page **0%**. The agent never
  answered *wrong*; it detected the conflict and hedged, which destroys the value
  of a wiki without ever producing a falsehood. Written up in
  [`eval/wiki-findings.md`](../eval/wiki-findings.md).
- **Mini auto-ingest** (`eval/wiki-ingest.js`) — the same source records ingested
  naively (append everything) vs. reconciled (dedup + supersede stale): **0% → 100%**
  clean-answer rate. The ADD/UPDATE/dedup decision *is* what makes ingestion work.
- **`eval/tokens.js`** — tokenization measured on this repo's own traces
  (prose ≈ 4.4 ch/token, hex ≈ 1.7, indentation ≈ 118), reproducing the p13 overflow.

**Methodological finding, and the most reusable one:** a lenient grader — "does the
right value appear anywhere?" — reported **100% for every condition** and hid the
entire collapse, because a hedge contains the right value too. Only grading for a
*clean* answer (right value present AND stale value absent) exposed it. The metric
chosen decides whether the problem is visible at all.

## Next steps (technical, ordered)

1. **`ask()`-side eval for a real corpus** — the degradation curve is measured on
   synthetic fixtures. The same metric applied to a real wiki is the open work.
2. **Semantic contradiction detection.** The static conflict detector compares
   numeric claims, so it is inert on conceptual corpora that argue rather than
   specify. Detecting *semantic* contradictions needs a judge, not a pattern —
   the same conclusion the grading work reached.
3. **Resolve the context/memory question with a harder stress test** (large *files*,
   not just many files, to defeat the 8k truncation).
4. **The `edit`/`replace` tool** — the fuller structural fix behind the p11 clobber
   guard (never rewrites whole-file → no clobber, no false positives).
