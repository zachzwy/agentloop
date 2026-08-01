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

## Next steps (technical, ordered)

1. **Write the failure-taxonomy doc** — consolidate the 3 fixed bugs + the
   retired/strength findings (p12 underspecification, #4 error-recovery) into one
   categorized artifact. The analysis is done; this is the write-up.
2. **CI + a quality-over-time view** — wire `summary.json` into a regression gate
   and a simple trend graph, so a fix that regresses is caught automatically.
3. **Fundamentals slice** — tokenization first (p13's 5.4M-token overflow is the
   hook), then attention/KV-cache and sampling.
4. **Resolve the context/memory question with a harder stress test**, then decide
   whether compaction is worth building or the improvement graph comes from
   robustness/efficiency levers already in hand.
5. **The `edit`/`replace` tool** — the fuller structural fix behind the p11 guard
   (never rewrites whole-file → no clobber, no false positives) and the natural
   pi-comparison exercise.
