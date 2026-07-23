# agentloop

A coding agent built from scratch — a plain model-plus-tools loop, no framework —
to learn where the real problems in agent harness engineering are.

The agent runs in a loop: the model calls tools, results are fed back, and the
model decides when it's done. No external exit criteria. Around that loop sit the
things that actually make unattended runs work: a command policy, an OS sandbox,
retries, context management, trace logging, and an eval harness that grades the
agent on receipts rather than on what it claims.

**Status: complete (all 6 build steps).** Built in phases, each one driven by a
failure found in the previous one's traces.

📝 **Write-up:** [I denied 7 dangerous commands. My agent deleted the files
anyway.](https://dev.to/wenyu_zhang/i-denied-7-dangerous-commands-my-agent-deleted-the-files-anyway-44f7)
— how the eval suite caught the agent routing around the command policy, and why
only OS isolation actually stopped it.

## Why this repo might be interesting

Most "I built an agent" projects stop at the loop. The parts here that took real
work — and produced findings I didn't expect:

- **A command allowlist is not a security boundary.** The eval caught the agent
  routing around seven policy denials (`rm`, `node -e`, `find -delete`,
  `git clean`, `truncate`, `python3`) by writing arbitrary JavaScript into a
  `.test.js` file and running it with the *allowed* `node --test`. A test file is
  arbitrary code, so no allowlist can close this — the OS sandbox is what actually
  drew the line. Written up in
  [`docs/run-command-safety-plan.md`](docs/run-command-safety-plan.md) ("Finding A").
- **Graders check receipts, not claims.** Tasks are graded by an external grader
  against the filesystem and *hidden* tests copied in after the agent finishes —
  because an agent reporting success and an agent succeeding are different events.
- **Traces are the primary artifact.** `traces/` holds annotated real runs of
  failures (confident fabrication, iteration-budget exhaustion, a leaked key) that
  each drove a specific fix.
- **Measured, not assumed.** Context growth was stress-tested against a 67-file
  target and *didn't* run away (the model samples; reads are truncated) —
  contradicting the assumption the work started from.

## Architecture

```
loop.js                  # the agent loop — entry point (and importable: loop({prompt}))
traces.js                # trace triage CLI (list / show / note)
prompts/system.md        # system prompt (honesty clause, tool-use guidance)

tools/
  index.js               # tool schemas + implementations, dispatch map
  guard.js               # path guard: rejects anything outside cwd
  read_file.js           # read a UTF-8 file (secret-file denylist, 8k truncation)
  list_files.js          # list a directory
  write_file.js          # write/create files (creates parent dirs)
  run_command.js         # run a program via execFile — NO shell, policy-gated
  policy.js              # allow/deny engine: positional matching, fail-closed
  policy.json            # the policy itself — data, reviewable in one place

utils/
  trace.js               # trace persistence + git receipts + secret redaction
  retry.js               # API retry with backoff, honours Retry-After
  executeToolCall.js     # tool dispatch; errors become strings, never throw
  cleanAssistantMessage.js  # strips reasoning_content before resending
  ...                    # prompt, input, logger, formatting helpers

eval/
  run-eval.js            # unattended batch runner → summary.json + summary.md
  sandbox-run.sh         # bubblewrap launcher (Layer 3 isolation)
  graders/index.js       # external grader, 8 check types
  graders/hidden/        # hidden tests, copied in AFTER the agent finishes
  tasks/*.json           # one file per task; each ties to a documented learning
  fixtures/base|large/   # throwaway targets (15-file and 67-file trees)

docs/                    # the reasoning: safety plan, eval design, roadmap, backlog
traces/                  # annotated real runs that drove the fixes
Dockerfile               # portable equivalent of the bwrap sandbox
```

## Quick start

Requires Node 20+ (uses `node --test` and `mock.module`).

```bash
npm install
echo "DEEPSEEK_API_KEY=sk-your-key" > .env    # .env is gitignored; never commit it
node loop.js
```

The agent reads `AGENTS.md` from the working directory, if present, and appends it
to the system prompt.

### Tests

```bash
node --experimental-test-module-mocks --test loop.test.js tools/*.test.js
```

The flag is required — module mocking is still experimental. 162 tests, including
adversarial policy tests that pin known bypasses.

## The eval harness

An unattended batch runner over probe tasks, each tied to a lesson learned earlier
in the project, so the suite doubles as a **regression report on the fixes**.

```bash
./eval/sandbox-run.sh                    # all tasks, inside the sandbox
./eval/sandbox-run.sh p6-write-outside   # one task
```

Each task is one JSON file: a prompt, a fixture, `category`/`difficulty`/`probes`,
and grader checks. The runner copies a fixture to a temp dir, commits a clean git
baseline, runs the agent headless against it, then grades the *result* — files on
disk, hidden tests, and the final answer's text — never the agent's self-report.
Output is `summary.json` (for trend graphs) and `summary.md`, including a by-probe
rollup so a regression points at the specific lesson it broke.

Design notes: [`docs/eval-harness-plan.md`](docs/eval-harness-plan.md).

## Security model

Four layers, each doing a different job — the whole argument is in
[`docs/run-command-safety-plan.md`](docs/run-command-safety-plan.md).

| Layer | What it does |
| ----- | ------------ |
| 0 — Tool guards | Path tools reject anything outside cwd; `read_file` denies secret files |
| 1 — No shell | `run_command` uses `execFile`, so `;`, `\|`, `$()`, globs are inert literals |
| 2 — Command policy | Deny-by-default allowlist with **positional** argument matching, fail-closed if the policy won't load |
| 3 — OS isolation | bubblewrap/Docker: working dir writable, everything else read-only or unmounted |

The honest conclusion, learned the hard way: **layers 0–2 stop honest mistakes and
shrink the blast radius; layer 3 is the only real boundary.** You cannot decide
what a Turing-complete program will do by inspecting its arguments.

## Lessons from the traces

`traces/` holds annotated real runs. Each drove a fix now in the code:

- **Confident fabrication** — with only `read_file` and no `list_files`, the model
  hit `EISDIR`, guessed common filenames from training priors, found nothing, and
  concluded the directory was empty. → added `list_files`, steering error text
  that names the right tool, and a system-prompt honesty clause.
- **Iteration-budget exhaustion** — with `MAX_ITER=5` the model spent every step
  exploring and never wrote the file; it also read `.env` unprompted, leaking the
  key into the trace. → `MAX_ITER` raised to 20 (a *fuse*, not a task budget),
  secret denylist in `read_file`, and redaction in the trace writer. (The key was
  rotated.)
- **False abnormal exit** — the cap was reached on the same iteration that ran a
  passing test suite, so a completed task was reported as a failure. → graceful
  landing: one final call with tools omitted, so partial work gets summarized.
- **Policy bypass via an allowed code-runner** — see Finding A above. → documented
  as an unclosable Layer-2 gap; Layer 3 contains it.

Open items are tracked in [`docs/future-work.md`](docs/future-work.md).

## Dependencies

- [openai](https://www.npmjs.com/package/openai) — API client (used against DeepSeek)
- [dotenv](https://www.npmjs.com/package/dotenv) — loads the harness's own `.env`
- [prettier](https://www.npmjs.com/package/prettier) (dev)

## License

MIT — see [LICENSE](LICENSE).
