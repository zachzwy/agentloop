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
