# Agent Loop

A minimal, phased learning project that builds an LLM-powered coding assistant with tool-calling capabilities. The agent runs in a loop: the model calls tools, results are fed back, and the model decides when it's done — no external exit criteria.

## Overview

This project started as a simple Q&A agent (Phase 1) and has evolved through incremental phases into a tool-using coding assistant. It's designed to explore the full tool-calling protocol: schema definitions, round-trip message handling, iteration budgets, error resilience, and trace logging.

**Phase 4 is complete**: four tools (`read_file`, `list_files`, `write_file`, `run_command`) driving a loop with a safety cap — the agent can now read code, write it, and run commands to verify its own work. Several Phase 5 features (tool exceptions as strings, context truncation, graceful landing on cap exhaustion) and Phase 6 features (trace logging, secret redaction, trace triage CLI) are already in place.

Agent/dev conventions: see AGENTS.md.

## Architecture

```
├── .antigravitycli/         # Local Antigravity CLI session data
│   └── <local-session>.json
├── .env                     # Environment variables (API key, etc.)
├── .gitignore
├── .prettierignore
├── README.md
├── loop.js                  # Main entry point - the agent loop
├── traces.js                # Trace triage CLI (list / show / note)
├── package.json
├── prompts/
│   └── system.md            # System prompt / persona (honesty clause, tool-use guidelines)
├── tools/
│   ├── index.js             # Exports tool schemas and implementations
│   ├── guard.js             # Path security: blocks access outside CWD
│   ├── read_file.js         # Read a UTF-8 file (with .env denial)
│   ├── list_files.js        # List directory contents
│   ├── run_command.js       # Run a shell command with user confirmation
│   ├── run_command.test.js  # Unit tests for run_command
│   └── write_file.js        # Write/create files (creates dirs automatically)
├── traces/                  # JSON trace logs from agent runs
│   ├── *.json               # Auto-named traces (ISO timestamp)
│   ├── trace-hallucinated-empty-dir.json
│   └── trace-readme-task-iter-budget-exhausted.json
└── utils/
    ├── index.js             # Re-exports all utilities
    ├── executeToolCall.js   # Executes a single tool call with argument parsing
    ├── formatToolResult.js  # Formats tool results for console display
    ├── input.js             # User input handling (readline prompt)
    ├── logger.js            # Logging utilities (preview, metrics)
    ├── parseToolArgs.js     # Safe JSON argument parsing
    ├── prompt.js            # Prompt loading / management
    └── trace.js             # Trace logging (with secret redaction)
```

## Tools

| Tool          | Description                                   | Security                                                                             |
| ------------- | --------------------------------------------- | ------------------------------------------------------------------------------------ |
| `read_file`   | Read a UTF-8 text file                        | Path-guarded; blocks `.env`, `.env.local`, `.env.production`; truncates at 50K chars |
| `list_files`  | List files/directories in a path              | Path-guarded; friendly errors for missing dirs                                       |
| `write_file`  | Write content to a file (creates parent dirs) | Path-guarded                                                                         |
| `run_command` | Run a shell command with user confirmation    | Asks for user approval before executing; 60-second timeout                           |

All tools return errors as strings (never throw) so the agent can gracefully handle failures.

## Agent Loop

The main loop in `loop.js` (function `phase3`):

1. Loads the system prompt and accepts user input
2. Calls the LLM with available tools (`tool_choice: "auto"`)
3. If the model calls tools → executes them → feeds results back → repeats
4. If the model replies with plain text → prints the answer and exits
5. If `MAX_ITER` (currently **20**) is reached → makes one final call with `tool_choice: "none"` so the model summarizes what it accomplished and what remains, then exits with an abnormal-termination message

The cap is a **fuse against runaway loops, not a task budget** — it should sit well above any legitimate workload. The graceful landing exists because a run once hit the cap on the same iteration that finished the task, so a success was reported as a failure (see Lessons Learned).

### Token Metrics

After each successful run, the loop prints per-iteration and total token usage (prompt, completion, sum).

## Development Phases

| Phase | Description                                                             | Status     |
| ----- | ----------------------------------------------------------------------- | ---------- |
| **1** | Single-round Q&A, no tools                                              | ✅ Done    |
| **2** | One tool (read_file), one round-trip                                    | ✅ Done    |
| **3** | Full loop with MAX_ITER cap, model decides when done                    | ✅ Done    |
| **4** | Four tools (read_file, list_files, write_file, run_command)             | ✅ Done    |
| **5** | Robustness: tool exceptions as strings, API retries, context management | 📋 Partial |
| **6** | 20-task harness, unattended runner, trace logging, secret redaction     | 📋 Partial |

**Phase 4 done when**: the agent could write code and run commands to verify it. Demonstrated by a run where it wrote a 16-test suite for `run_command`, discovered Node's `--experimental-test-module-mocks` flag on its own, and got the suite passing (trace `2026-07-19T13-46`).

**Phase 5 status**: Tool exceptions returned as strings ✅. Context management (50K char truncation) ✅. Tool results coerced to strings at the dispatch boundary ✅. Graceful landing on cap exhaustion ✅. API retries — not yet implemented.

**Phase 6 status**: Trace logging ✅ (each run saves a JSON trace). Secret redaction ✅ (auto-redacts `sk-...` patterns before writing). Trace triage CLI ✅. 20-task harness and unattended runner — not yet implemented. **Blocker**: `run_command` asks for interactive approval, which will hang an unattended run — needs an auto-approve policy first.

## Security

- **Path guardrail**: All tools reject paths outside the working directory (`outsideCwd` check in `tools/guard.js`)
- **Sensitive file denial**: `read_file` explicitly blocks `.env`, `.env.local`, `.env.production`
- **Command approval**: `run_command` asks for user confirmation before executing any shell command
- **Secret redaction**: Trace logs automatically redact `sk-...` API key patterns before writing to disk

## Getting Started

### Prerequisites

- Node.js 18+
- A DeepSeek (or OpenAI-compatible) API key

### Setup

```bash
# Install dependencies
npm install

# Set your API key
echo "DEEPSEEK_API_KEY=sk-..." > .env

# Run the agent
node loop.js
```

### Usage

The agent will prompt you for a question. For example:

```
Enter your question: what files are in the current directory?
```

It will use its tools to explore, then provide an answer.

### Running Tests

Unit tests use Node's built-in test runner. To run the tests for `run_command`:

```bash
node --experimental-test-module-mocks --test tools/run_command.test.js
```

The `--experimental-test-module-mocks` flag enables module mocking (used by the tests to simulate user input and command execution without actually running commands).

## Traces

Every run saves a JSON trace to `traces/`, named by ISO timestamp. Each trace holds the full message history plus top-level summary fields so a run can be scanned without reading the whole conversation:

| Field                                              | Meaning                                                               |
| -------------------------------------------------- | --------------------------------------------------------------------- |
| `task`                                             | The user's request                                                    |
| `outcome`                                          | How the **loop** ended: `success` or `max_iter_exhausted`             |
| `taskSucceeded`                                    | Whether the **task** actually succeeded — set by hand during triage   |
| `tags`, `notes`                                    | Failure categories and free-text findings — set by hand during triage |
| `model`, `maxIter`, `gitSha`, `savedAt`            | Provenance: which harness version produced this run                   |
| `iterations`, `promptTokensFinal`, `apiMsTotal`, … | Rolled-up metrics                                                     |

`outcome` and `taskSucceeded` are deliberately separate: a run can end abnormally while the task actually succeeded (or end cleanly with a wrong answer). Filenames never change — annotations go **inside** the file.

### Trace Triage CLI

```bash
node traces.js list                          # scan every run
node traces.js list --tag runtime-probing    # filter to one failure category
node traces.js list --untagged               # the triage backlog
node traces.js show 2026-07-19T13-46         # metadata + collapsed conversation
```

Annotate a run after reading it (trace IDs are filename prefixes — any unambiguous prefix works):

```bash
node traces.js note 2026-07-19T13-46 \
  --tag runtime-probing --tag false-abnormal-exit \
  --ok \
  --note "Tests passed 16/16; harness reported failure because MAX_ITER hit on the same iteration."
```

| Flag              | Effect                                       |
| ----------------- | -------------------------------------------- |
| `--tag <name>`    | Add a failure category (repeatable, deduped) |
| `--note "<text>"` | Set the free-text note                       |
| `--ok` / `--fail` | Set `taskSucceeded` to `true` / `false`      |

Listing shows both outcomes side by side, so discrepancies are visible at a glance:

```
2026-07-19T13-46  ABN task:ok   20it  16k  create a unit test for tools/run_command.js  [runtime-probing, …]
                    ↳ Tests passed 16/16; harness reported failure because MAX_ITER hit …
```

Tags are the raw material for a failure taxonomy: start loose, and let the vocabulary that recurs become the categories worth measuring.

## Lessons Learned (from traces)

The `traces/` directory contains real run logs that document failure modes found during development:

- **Confident fabrication** (trace-hallucinated-empty-dir.json): An early version had only `read_file` (no `list_files`). When the model tried to read the directory (EISDIR error), it guessed common filenames from training priors, found nothing, and confidently concluded the directory was empty.
- **Iteration budget exhaustion** (trace-readme-task-iter-budget-exhausted.json): With MAX_ITER=5, the model spent all iterations exploring the codebase (reading every file) and ran out of steps before writing the README. The model also read `.env` unprompted, leaking the API key into the trace.
- **False abnormal exit** (2026-07-19T13-46, tagged `false-abnormal-exit`): The agent wrote a 16-test suite for `run_command` and got it green — but the cap was reached on the same iteration that ran the tests, so the model never summarized and the harness reported `max_iter_exhausted`. A completed task looked like a failure. Same trace, tagged `runtime-probing`: after hitting `TypeError: mock.module is not a function`, the model spent seven iterations inspecting Node internals before trying `node --help | grep -i mock`, which found the flag immediately.

These traces informed the fixes now in place: `list_files` tool, `MAX_ITER` raised to 20, `.env` denial in `read_file`, and the system prompt honesty clause. Still open: a graceful landing on cap exhaustion (one final call with `tool_choice: "none"` so partial work is summarized rather than discarded).

## Dependencies

- [openai](https://www.npmjs.com/package/openai) ^6.47.0 — OpenAI/DeepSeek API client
- [dotenv](https://www.npmjs.com/package/dotenv) ^17.4.2 — Environment variable loading
- [prettier](https://www.npmjs.com/package/prettier) ^3.9.5 (dev) — Code formatting

```bash
npm run format    # Format all files with Prettier
```

## License

Internal / learning project.
