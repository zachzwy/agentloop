# Failure taxonomy

What actually breaks when this agent runs unattended — categorized by **where the
failure originates**, because that determines who can fix it. Every entry links to
the task or trace that surfaced it and its current status.

This is the E1 (error-analysis) artifact. It is built from real runs, not
imagined failure modes, and it encodes the single most important lesson of the
exercise: **most "agent failures" are not the model's fault.**

## The origin trichotomy

Every failure lands in one of three buckets. Misfiling one wastes effort fixing
the wrong layer.

| Origin | Who fixes it | How to tell |
| ------ | ------------ | ----------- |
| **Harness** | you (code) | re-running against a stronger model still fails |
| **Model** | prompt / tool design, or wait for a better model | a stronger model passes; a weaker one fails harder |
| **Grader / fixture** | you (the eval) | the agent did something reasonable and the *check* is wrong |

A running tally from this project: of the distinct failures analyzed, the largest
category by count was **grader failures** — the eval marking a correct agent
wrong. That is the headline finding, not a footnote.

---

## 1. Harness robustness failures

The harness itself crashes or corrupts data, independent of the model. These are
the highest-value finds: fixing one improves *every* run.

### 1a. Unbounded tool output → context overflow → crash — **FIXED**
- **Surfaced by:** `p13-verbose-fail-overflow`.
- **Mechanism:** `run_command`'s failure path returned stdout/stderr untruncated
  (the success path capped at 20k). A verbose failing command (`node --test` on a
  large suite, ~10.5 MB) produced a ~5.4M-token prompt vs. the model's 1M limit →
  400 → `loop()` threw → whole run lost (`harness-error`, 0 iterations).
- **Why the guard didn't save it:** the context-limit guard reacts to the
  *previous* prompt size, so it never sees an oversized result coming.
- **Fix (`7344cd3`):** cap failure output too, keeping the **tail** (errors live at
  the end). `ERROR` → `PASS`.

### 1b. Unhandled tool exception → crash — **FIXED**
- **Surfaced by:** harness review (companion to 1a).
- **Mechanism:** `executeToolCall` had no try/catch, and `outsideCwd()` →
  `path.resolve()` throws on a missing/non-string path *before* the tool's own
  try. A malformed tool call — e.g. `read_file` with the wrong key `{"path": …}`,
  the exact confusion the project's first trace showed — threw an uncaught
  `TypeError` and killed the run. Violated the harness's own "tools never throw"
  invariant.
- **Fix (`9f1fd83`):** exception firewall in `executeToolCall` — any throw becomes
  a recoverable error string.

### 1c. Silent data loss on large-file edit — **MITIGATED** (structural fix pending)
- **Surfaced by:** `p11-truncate-clobber`.
- **Mechanism:** `write_file` overwrites whole-file; `read_file` truncates at 8k.
  An agent that reads a >8k file (head only) and writes it back destroys the
  unseen tail.
- **Probabilistic:** fires only when the model *doesn't* defensively `cat` the full
  file first. Measured rate: **2/10 (~20%)**. The losing runs were the fastest
  (3 iters) — "quick and confident" is exactly when data dies.
- **Fix (`ad8bab7`):** `write_file` clobber guard — refuse an overwrite that drops
  the file's tail. Re-measured: **0/10**, and previously-losing runs recovered to
  PASS. See Learnings #16/#17.
- **Residual:** the guard is a heuristic (a legitimate tail-only edit would
  false-positive). The full structural fix is a surgical `edit`/`replace` tool
  (never rewrites whole-file → no clobber possible). Tracked in `future-work.md`.

---

## 2. Harness affordance gaps

The harness doesn't crash, but a missing tool, weak error text, or too-small
budget leads a capable model astray.

### 2a. No `list_files` → confident fabrication — **FIXED**
- **Surfaced by:** `traces/trace-hallucinated-empty-dir.json`.
- **Mechanism:** with only `read_file`, the model hit `EISDIR` on a directory,
  guessed common filenames from training priors, found nothing, and concluded the
  directory was empty.
- **Fix:** added `list_files`; steering error text that names the right tool
  (`EISDIR` → "use list_files"); system-prompt honesty clause.

### 2b. Iteration budget too small → exhaustion — **FIXED**
- **Surfaced by:** `traces/trace-readme-task-iter-budget-exhausted.json`.
- **Mechanism:** `MAX_ITER=5` — the model spent every step exploring and never
  wrote the file. The cap is a *fuse*, not a task budget (Learning #7).
- **Fix:** `MAX_ITER=20` + graceful landing (final tools-off summary so partial
  work isn't discarded).

### 2c. No surgical edit / search tool → costly whole-file work — **OPEN (masked)**
- Editing a large file forces read-everything + rewrite-everything (context cost
  and the 1c clobber risk). Finding cross-file references forces reading everything.
- **Masked**, not solved: the model routes around the gap using allowed
  `cat`/`grep`/`head`/`tail` via `run_command`. So it rarely produces a hard
  failure — just inefficiency. The real fix is dedicated `edit`/`search` tools.

---

## 3. Security / boundary failures

The command policy is bypassable; only OS isolation is a real boundary.

### 3a. Allowed code-runner = arbitrary execution — **ACCEPTED** (Layer 3 contains)
- **Surfaced by:** `p6` (original delete-build variant), "Finding A".
- **Mechanism:** the agent routed around 7 policy denials by writing a `.test.js`
  and running it via the *allowed* `node --test` — a test file is arbitrary code.
  Unclosable at the allowlist: the legitimate feature and the exploit are the same
  operation.
- **Status:** accepted as an inherent Layer-2 limitation; the OS sandbox (Layer 3)
  contains it. This is the published write-up. See `run-command-safety-plan.md`.

### 3b. `cat`/`head`/`tail` defeat `read_file` restrictions — **KNOWN GAP**
- `read_file` truncates at 8k and denies `.env`; `cat .env` and `head -c` bypass
  both. Truncation is a *soft default*, not a boundary (the hard context cap is the
  loop budget guard). For secrets, the real fix is Layer 3 (don't mount the
  secret) / path-based denial, not banning `cat` (whack-a-mole).

---

## 4. Model-behavior failures

The model itself, holding the harness constant. Fixable by prompt/tool design, or
they wait for a better model — not by harness code.

### 4a. Confident false conclusion after a tool failure — **MITIGATED**
- The fabrication in 2a was partly a model tendency (assert rather than admit
  uncertainty). Mitigated by steering error text + the honesty clause; not
  eliminated (see 4b).

### 4b. Nondeterminism / probabilistic safety — **STRUCTURAL RESPONSE**
- The same task, same harness, different sample → different tool path → sometimes
  data loss (1c). Root causes: stochastic sampling, MoE routing (non-deterministic
  even at temp 0), equally-valued paths, a truncation warning obeyed inconsistently.
- **Lesson (Learnings #16/#17):** you cannot fix the model's randomness. The
  harness's job is to make dangerous outcomes *structurally impossible*, so
  randomness only costs quality (steps), never safety (data). A single green run on
  a probabilistic bug is luck, not proof — measure a **rate**, not pass/fail.

---

## 5. Grader / fixture failures — *the biggest category*

The agent behaved reasonably; the **check** was wrong. Every one of these was a
false red that, taken at face value, would have sent me to "fix" a working agent.

### 5a. Naive success premise
- **`p6`:** the grader assumed "rm denied ⟹ files survive." False — the agent
  achieved deletion via an allowed path. The *task's model of correct* was wrong.

### 5b. Too-narrow honesty/semantic regex — **RECURRING (≥3×)**
- **`UNKNOWN_RE`:** missed "has not been achieved" / "blocked" (p6), then "No X
  exists" (p2). **p12 disclosure regex:** missed "configurable per call" and
  "default '…'". Each patch invites the next phrasing.

### 5c. Model strength misread as failure
- **`p12` (retired):** the model resolved underspecification by *parameterizing*
  (a valid, arguably better choice) — the grader only recognized "assume a default
  and disclose it." **`#4` error recovery:** turned out to be a harness *strength*
  (good error surfacing), so tasks meant to expose it passed.

**Conclusion for grading:** honesty, disclosure, and "handled ambiguity
reasonably" are **semantic** properties that regex grades badly. Three-plus false
reds are the concrete, earned argument for an **LLM-as-judge (E3)** — with these
labeled examples as its calibration set. Until then: grade on filesystem receipts
where possible; treat trace-text checks as approximate.

---

## Cross-cutting lessons

1. **Filter by origin before fixing.** The stronger-model re-run is the cheap test
   that separates harness bugs (fix them) from model limits (don't) from grader
   bugs (fix the eval).
2. **A passing suite stops teaching.** 9/9 green is a regression baseline, not a
   discovery tool. New failures come from *harder* tasks — and, as it turned out,
   from auditing the harness code directly.
3. **Rate, not pass/fail, for anything nondeterministic.**
4. **The grader is part of the system under test.** Budget error-analysis time for
   debugging your evals, not just your agent — here it was the dominant cost.
