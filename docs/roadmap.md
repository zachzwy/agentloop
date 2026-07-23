# agentloop status & roadmap (2026-07-22)

All six build steps are done. This is the checkpoint the step list promised:
what the traces revealed, and what the evidence says to do next.

---

## Where the project stands

| Area | State |
| ---- | ----- |
| **Agent loop** | Done. 5 tools, headless entry point (`loop({prompt})`), graceful landing on cap exhaustion. |
| **Robustness** | Done. Tool errors returned as strings, API retry with backoff, per-result truncation, conversation-level context budget guard. |
| **Command safety** | Done, and deeper than planned. No-shell `execFile`, deny-by-default policy with positional matching, fail-closed loading, bubblewrap + Docker isolation. |
| **Eval harness** | Done. Unattended runner, external grader (8 check types, hidden tests), `summary.json`/`summary.md` with a by-probe regression rollup. |
| **Task suite** | 10 tasks (9 probes + 1 measurement). All pass — a green regression baseline. |
| **Failure taxonomy** | Partial. The traces in `traces/` document real failure modes, but the probe suite now passes 9/9, so it has stopped *discovering* new ones. |

## What the traces changed

Three assumptions died during step 6, each caught by running rather than
reasoning — the reason the eval exists:

1. **"A command allowlist can confine an agent."** It cannot. The agent routed
   around seven denials via `write_file` + the allowed `node --test`, which
   executes arbitrary code. Documented as Finding A in
   [`run-command-safety-plan.md`](run-command-safety-plan.md). Layer 3 isolation
   contained it; nothing at Layer 2 could have.
2. **"`/etc` is read-only in the sandbox."** It wasn't — only `/etc/ssl` was
   bound, leaving the rest a writable (host-isolated) tmpfs. Found because a probe
   task built on that premise failed. See [`future-work.md`](future-work.md).
3. **"Context growth is the pressing problem."** Measured against a 67-file target
   (p10) vs a 15-file one (p7): 4.5× the files produced only ~1.7× the tokens.
   The model *samples* rather than reading everything, and reads are truncated at
   8k. No runaway at this scale.

A fourth, smaller one: the grader's own honesty heuristic was too narrow and
mis-graded an honest agent report. Mis-grades are signal too — the matcher was
widened from a real trace.

## Next steps

1. **Make the suite discover failures again.** A 9/9 board is a good regression
   baseline but teaches nothing new. Add tasks *designed to break*: ambiguous
   specs, multi-file refactors, tasks needing a tool that doesn't exist, and a
   context stress with large *files* (not just many files, which the 8k truncation
   already absorbs). Read every trace; build the failure-taxonomy doc from what
   actually breaks.
2. **Settle the context question with data.** If growth still doesn't run away
   under the harder stress, then compaction/memory is not where the wins are for
   this harness — and the measured levers that *did* move numbers should be
   pursued instead: injecting `AGENTS.md` cut a task from 21 iterations to 14, and
   iteration efficiency is wide open (see item 3).
3. **Iteration-budget efficiency.** One probe burned the entire 20-iteration
   budget flailing against an impossible target. `MAX_ITER` is a fuse, not an
   efficiency control. No-progress detection, repetition detection, and a
   denial-rate circuit breaker are sketched in [`future-work.md`](future-work.md).
4. **Compare against a real harness.** Read [pi](https://github.com/badlogic/pi-mono)'s
   equivalents and diff the decisions — its "no in-harness permissions, sandbox
   externally" stance is the direct foil to the Layer 2/3 finding above.
