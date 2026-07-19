# Agent Loop

A minimal, phased learning project that builds an LLM-powered coding assistant with tool-calling capabilities. The agent runs in a loop: the model calls tools, results are fed back, and the model decides when it's done — no external exit criteria.

## Overview

This project started as a simple Q&A agent (Phase 1) and has evolved through incremental phases into a tool-using coding assistant. It's designed to explore the full tool-calling protocol: schema definitions, round-trip message handling, iteration budgets, error resilience, and trace logging.

Currently implements **Phase 4** (three tools, loop with safety cap) with several robustness features from Phase 5 (tool exceptions as strings, context truncation) and Phase 6 (trace logging, secret redaction) already in place.

## Architecture

```
├── .antigravitycli/         # Local Antigravity CLI session data
│   └── <local-session>.json
├── .env                     # Environment variables (API key, etc.)
├── .gitignore
├── .prettierignore
├── README.md
├── loop.js                  # Main entry point - the agent loop
├── package.json
├── prompts/
│   └── system.md            # System prompt / persona (honesty clause, tool-use guidelines)
├── tools/
│   ├── index.js             # Exports tool schemas and implementations
│   ├── guard.js             # Path security: blocks access outside CWD
│   ├── read_file.js         # Read a UTF-8 file (with .env denial)
│   ├── list_files.js        # List directory contents
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

| Tool         | Description                                   | Security                                                                             |
| ------------ | --------------------------------------------- | ------------------------------------------------------------------------------------ |
| `read_file`  | Read a UTF-8 text file                        | Path-guarded; blocks `.env`, `.env.local`, `.env.production`; truncates at 50K chars |
| `list_files` | List files/directories in a path              | Path-guarded; friendly errors for missing dirs                                       |
| `write_file` | Write content to a file (creates parent dirs) | Path-guarded                                                                         |

All tools return errors as strings (never throw) so the agent can gracefully handle failures.

## Agent Loop

The main loop in `loop.js` (function `phase3`):

1. Loads the system prompt and accepts user input
2. Calls the LLM with available tools (`tool_choice: "auto"`)
3. If the model calls tools → executes them → feeds results back → repeats
4. If the model replies with plain text → prints the answer and exits
5. If `MAX_ITER` (currently **20**) is reached → exits with an abnormal-termination message

### Token Metrics

After each successful run, the loop prints per-iteration and total token usage (prompt, completion, sum).

## Development Phases

| Phase | Description                                                             | Status     |
| ----- | ----------------------------------------------------------------------- | ---------- |
| **1** | Single-round Q&A, no tools                                              | ✅ Done    |
| **2** | One tool (read_file), one round-trip                                    | ✅ Done    |
| **3** | Full loop with MAX_ITER cap, model decides when done                    | ✅ Done    |
| **4** | Three tools (read_file, list_files, write_file)                         | ✅ Done    |
| **5** | Robustness: tool exceptions as strings, API retries, context management | 📋 Partial |
| **6** | 20-task harness, unattended runner, trace logging, secret redaction     | 📋 Partial |

**Phase 5 status**: Tool exceptions returned as strings ✅. Context management (50K char truncation) ✅. API retries — not yet implemented.

**Phase 6 status**: Trace logging ✅ (each run saves a JSON trace). Secret redaction ✅ (auto-redacts `sk-...` patterns before writing). 20-task harness and unattended runner — not yet implemented.

## Security

- **Path guardrail**: All tools reject paths outside the working directory (`outsideCwd` check in `tools/guard.js`)
- **Sensitive file denial**: `read_file` explicitly blocks `.env`, `.env.local`, `.env.production`
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

## Lessons Learned (from traces)

The `traces/` directory contains real run logs that document failure modes found during development:

- **Confident fabrication** (trace-hallucinated-empty-dir.json): An early version had only `read_file` (no `list_files`). When the model tried to read the directory (EISDIR error), it guessed common filenames from training priors, found nothing, and confidently concluded the directory was empty.
- **Iteration budget exhaustion** (trace-readme-task-iter-budget-exhausted.json): With MAX_ITER=5, the model spent all iterations exploring the codebase (reading every file) and ran out of steps before writing the README. The model also read `.env` unprompted, leaking the API key into the trace.

These traces informed the fixes now in place: `list_files` tool, `MAX_ITER` raised to 20, `.env` denial in `read_file`, and the system prompt honesty clause.

## Dependencies

- [openai](https://www.npmjs.com/package/openai) ^6.47.0 — OpenAI/DeepSeek API client
- [dotenv](https://www.npmjs.com/package/dotenv) ^17.4.2 — Environment variable loading
- [prettier](https://www.npmjs.com/package/prettier) ^3.9.5 (dev) — Code formatting

```bash
npm run format    # Format all files with Prettier
```

## License

Internal / learning project.
