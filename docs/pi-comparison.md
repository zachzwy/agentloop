# pi vs agentloop — reading notes, session 1

Comparing [earendil-works/pi](https://github.com/earendil-works/pi) (v0.84.x, actively
developed) against this harness. The rule for this project has been *build first, then
read* — every design below was reached independently here before pi's version was
opened, which is what makes the diff worth anything.

This is a first pass over `packages/agent` (the loop) and `packages/coding-agent`
(tools, system prompt). Not a finished study.

## The framing that changed on contact

**pi is no longer "the smallest serious harness."** That premise — 4 packages, 4
tools, a sub-1,000-token system prompt — is what made it the reference implementation
for this project. As of now:

| | pi | agentloop |
| --- | --- | --- |
| packages | 10 | 1 |
| tools | 8 (read, write, edit, bash, ls, grep, find, truncate) | 5 |
| tool source | 2,861 lines | 856 lines |
| agent core | ~12,600 lines | ~300 (`loop.js`) |
| iteration cap | **none** (`while (true)`) | `MAX_ITER = 20` |
| compaction | **yes** — manual / threshold / overflow | none (budget guard only) |

The minimalism thesis has eroded as the project matured. That is itself the most
interesting finding of the session: the things a "minimal" harness grows into are
evidence about what is actually load-bearing.

> **Corrected in session 2:** "eroded" is too crude. pi grew in *depth* — a better
> edit tool, compaction, sessions, extensions, evals — while holding **every one of
> its categorical refusals**. See below. The discipline was never line count; it is
> what the project says no to.

## Two things to adopt

### 1. Truncated output must fail every tool call in the message

pi checks `stopReason === "length"` and, if the assistant message was cut off by the
token limit, **fails all tool calls in that message rather than executing them**:

> *"A `length` stop means the output was cut off by the token limit, so every tool
> call in the message may carry truncated arguments. Fail them all instead of
> executing potentially borked calls."*

**agentloop does not handle `finish_reason: "length"` at all.** It records the value
in `iterationStats` and otherwise proceeds — meaning a truncated message's tool calls
get parsed and executed with possibly-truncated arguments. Given that this harness
already found one context-overflow crash (p13) and one silent data-loss bug (p11)
from exactly this family, this is a real gap with a cheap fix.

*Test to write:* a probe that forces a `length` stop mid-tool-call and asserts the
call is refused rather than executed.

### 2. No iteration cap — and the design that replaces it

pi's loop is `while (true)`. Termination is: the model stops requesting tools, an
error, an abort, or the user interrupting. There is no `MAX_ITER`.

This is the opposite of the conclusion here (Learning #7: the cap is a *fuse*, not a
task budget). Both can be right — pi is interactive, so a human is the circuit
breaker; agentloop runs unattended, where nobody is watching. Worth stating explicitly
in the write-up: **the cap is a function of who is in the loop, not of good design.**

Note also `future-work.md`'s open item — no-progress detection — is what pi gets for
free from having a human present.

## Design diffs worth arguing about

| Decision | pi | agentloop | Evidence here |
| --- | --- | --- | --- |
| **Edit** | `edit` tool: 443 lines, multiple disjoint edits per call, each `oldText` matched against the **original** file (not incrementally), uniqueness enforced with a steering error naming the occurrence count | no edit tool; whole-file `write_file` + a clobber guard | p11: whole-file write destroyed data **2/10 runs**; the guard took it to **0/10**. pi's design makes the failure impossible rather than refused. |
| **Tools shape the prompt** | each tool exports `systemPromptContribution` — a one-line snippet plus guidelines; a tool appears in "Available tools" only if it supplies a snippet, and the prompt is composed from the *enabled* set | tool descriptions live in the schema; system prompt is static | AGENTS.md injection moved a task **21 → 14 iterations**, so prompt composition demonstrably matters. pi's version is more granular. |
| **Project context** | wrapped as `<project_instructions path="...">` inside a `<project_context>` block | appended under a `## Project notes` heading | Untested which framing the model honors better — a clean A/B with the existing suite. |
| **Steering** | outer loop injects user messages that arrive mid-run, before the next assistant turn | none (single prompt, headless) | Not applicable unattended, but the *mechanism* is how pi handles a course correction without restarting. |
| **Events** | loop emits `turn_start` / `message_start` / `turn_end` / `agent_end`; UI is a consumer | `console.log` inline | Decoupling would make the trace writer a subscriber instead of a special case. |
| **Compaction** | `core/compaction/`, triggered manually, by threshold, or on overflow | none | See below. |

## A plan assumption that is now stale

The learning plan's checkpoint 4 reads: *"pi claims hundreds of exchanges fit without
formal compaction. Your eval harness can actually test that claim."*

**pi now ships compaction**, with three trigger reasons — `manual`, `threshold`,
`overflow` — and branch summarization. Either the claim has been overtaken by the
implementation, or it was narrower than remembered.

This cuts against the measurement here (p7/p10: context growth was sub-linear and
*not* the acute problem). A harness with far more production exposure decided
compaction was worth building. Two readings, and the honest answer is unresolved:

- Growth is benign for short unattended tasks (measured here) but not for long
  interactive sessions (pi's use case), or
- The measurement here was too small to see the problem.

The distinguishing experiment is a long-session run, which is the C3 stress test
already on the list.

## Next session

1. Implement pi's `edit` semantics and re-run p11 against the clobber guard —
   head-to-head on a decision where the two harnesses diverged.
2. Add `finish_reason: "length"` handling + a probe.
3. A/B the project-context framing (`<project_instructions>` vs `## Project notes`)
   on the existing 12-task suite.

## Refusals still to study

pi's omissions are arguments, and the plan says to study them as hard as the code: no
MCP, no subagents, no to-do tool, no plan mode, no background bash. Not yet verified
whether these still hold at v0.84 — given how much else has grown, they may not.

---

# Session 2 — the refusals, and pi's own eval suite

## The refusals all still hold at v0.84

The plan says to study pi's omissions as hard as its code, because each one is a
design argument. Verified against the source:

| Refusal | Status |
| --- | --- |
| no MCP | **holds** |
| no subagents | **holds** |
| no to-do tool | **holds** |
| no plan mode | **holds** |
| no background bash | **holds** |

A first grep suggested MCP and a to-do tool had appeared. Both were false positives
from a **vendored `highlight.min.js`** — the "MCP" hits were the string `mcpy`, and
the "TODO"s were comments inside third-party code. Checking what the matches actually
were, rather than trusting the counts, reversed the conclusion. (Sixth instance in
this project of a measurement being confidently wrong until interrogated; the rule
keeps earning itself.)

**This is the real finding of the comparison so far.** pi doubled its packages and
its tool count while refusing every additional *category* of capability. Growth went
into depth — a 443-line edit tool, compaction, session branching, an extension
system, an eval suite — not into scope. "Minimal" turned out to mean *narrow*, not
*small*, and only the narrowness was load-bearing.

## pi ships an eval suite — and it converges with this one

`packages/evals` (~1,800 lines), built on
[`vitest-evals`](https://github.com/getsentry/vitest-evals). It runs a real
`AgentSession` in isolated temporary project directories and attaches session
artifacts. Its stated purpose: *"compare prompts, tools, skills, models, or other
harness configurations."*

Independently arrived at, on both sides:

| Concern | pi | agentloop |
| --- | --- | --- |
| isolation per run | temp project + agent dirs | `mkdtemp` fixture copies |
| artifacts | session JSONL attachments | `traces/*.json` |
| run index | `runs.jsonl` | `history.jsonl` |
| config comparison | harness table | `--conditions A,B` |
| provider/model pinned in results | yes | yes (`meta.model`, `gitSha`) |

The convergence is worth more than either design: two people solving unattended
agent evaluation separately produced the same five primitives.

## pi's "judge" is deterministic — not an LLM

The most useful correction of the session. `createJudge(...)` sounds like
LLM-as-judge; it is not. It is a **multi-criteria deterministic scorer**: it inspects
the output, accumulates a `failures[]` list, and returns `score: failures.length === 0
? 1 : 0` plus a `rationale` that joins the failures into a sentence.

That is structurally what `eval/graders/index.js` already does — accumulate per-check
results with reasons. The difference is *what* it inspects.

### The one thing to steal: trajectory assertions

pi's judges assert on **tool calls**, not just the final answer:

```
no successful hello({ name: "Bob" }) call returned "Hello, Bob!"
```

It checks the call's `name`, `arguments`, `status`, *and* `result`. agentloop grades
the final message and filesystem receipts — it can tell you the task succeeded, but
not whether the agent got there the right way.

A `tool-call-matches` check type would close that gap, and several existing findings
would have been caught more directly by it: p6's policy bypass (a `node --test` call
on a written file), the p11 clobber path (a `write_file` that shrank a large file),
and the cat-vs-read_file routing in the wiki testbed. All were found by reading traces
by hand; all are mechanically assertable.

## Standing on the safety question

pi has sandbox handling (`restore-sandbox-env.ts`) and no in-harness permission
prompts, consistent with the position that guardrails belong outside the harness —
the same conclusion reached here from measurement in write-up #1. No change.

## Revised next steps

1. **`tool-call-matches` grader check** — cheapest high-value item, and it upgrades
   several existing probes from "read the trace by hand" to mechanically checked.
2. **`finish_reason: "length"` handling** (session 1) — still the clearest correctness gap.
3. **pi's `edit` semantics vs the clobber guard**, measured on p11.
4. Open question for the write-up: pi refuses subagents, to-do lists and plan mode
   while shipping compaction and sessions. That is a claim about which context
   problems are real — and it is testable here.
