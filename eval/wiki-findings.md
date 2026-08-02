# Wiki testbed — findings

A navigation (not RAG) agent-wiki testbed: the agent gets `wiki_search` + `wiki_read`
tools and answers questions whose answers live only in the wiki (synthetic facts —
invented services, specific numbers — the model cannot know from training). Run
`node eval/wiki-eval.js`.

## Delta 1 — does the wiki help at all?

Augmented (wiki tools) vs. baseline (no tools), 4 fact tasks:

| | pass |
| --- | --- |
| baseline (no wiki) | 0/4 |
| augmented (wiki)   | **4/4** |

The wiki lifts task success from 0 → 100%. The tasks are valid: the baseline
*cannot* answer, so the delta is real, not the model reciting training data.

## Delta 2 — does ingest quality matter? (the auto-ingest question)

Same tasks, augmented, against wikis of decreasing ingest quality — measured as a
RATE (3 runs/task) and graded on a **confident, clean answer** (right value present
AND the stale wrong value absent):

| condition | what it models | clean-answer rate |
| --------- | -------------- | ----------------- |
| **clean** | authoritative pages only | **100%** (12/12) |
| **uncued** | a stale contradiction, same title, no "(draft)" marker, ranked *below* the real page | **8%** (1/12) |
| **outranked** | the stale contradiction *outranks* the real page | **0%** (0/12) |

**Wiki usefulness collapses as ingest quality drops.**

## The mechanism — and why the first grader hid it

The agent does NOT give confidently wrong answers. It reads multiple pages, detects
the contradiction, and **hedges** — e.g. *"the wiki has conflicting information: one
page says 45 minutes, another says 30."* Honest behaviour; never a fabrication.

So the cost of bad ingest is not "the agent hallucinates." It is:

1. **The wiki stops giving authoritative answers.** The user asks "how long is the
   canary hold?" and gets "45 or 30, the wiki disagrees" — the whole point of a wiki
   (a single trusted answer) is destroyed.
2. **Every query costs more** — extra searches, extra reads, extra reasoning to
   detect and report the conflict.
3. **The latent risk**: a *less capable* agent, or a subtler contradiction, may not
   detect the conflict and would answer wrong. We tested a strong model; the failure
   is worse below it.

A lenient grader (`answer contains "45"`) reported **100%** for every condition —
because the hedges contain the right value too. Only grading for a *clean* answer
(right value present, wrong value absent) revealed the collapse. This is the 5th
time in this project a too-lenient grader hid a real effect — **the grader is part
of the system under test** (see docs/failure-taxonomy §5).

## What this says for auto-ingest

- The lever is **not** "the agent will be wrong" — a capable navigation agent is
  robust to that. The lever is **wiki usefulness**: contradictions turn clean
  answers into hedges.
- Ranking matters: `uncued` (stale ranked below) already drops to 8%; `outranked`
  (stale wins retrieval) hits 0%. So ingest quality must ensure the authoritative
  page **wins retrieval** — via dedup (no stale copy to compete), staleness
  detection/removal, and recency/authority in ranking.
- The metric to use in production is **confident clean-answer rate**, not
  "the right value appears somewhere."

## Delta 3 — auto-ingest: reconciliation is the whole game

Fed the same facts (raw source records with topic + timestamp, incl. stale +
duplicate + current versions in `eval/fixtures/wiki-sources/sources.json`) through
a mini auto-ingest (`eval/wiki-ingest.js`) two ways, then graded the resulting
wiki (3 runs/task, confident clean-answer rate):

| ingest mode | what it does | clean-answer rate |
| ----------- | ------------ | ----------------- |
| **naive** (append every source) | 11 sources → 11 pages; stale + dup versions all land, contradicting | **0%** |
| **reconcile** (group by topic, keep latest ts) | 11 sources → 6 pages; supersede stale, dedup | **100%** |
| clean (hand-authored reference) | — | 100% |

Append-everything ingest produces a *useless* wiki; the dedup + supersede-stale
reconciliation restores it to the hand-authored baseline. **The ADD/UPDATE/dedup
decision is what makes auto-ingest work** — measured, not asserted.

Caveat: the reconciler matches same-topic sources by a `topic` tag (deterministic).
The hard part in production is *detecting* that two sources are about the same topic
(Mem0/A-MEM use an LLM/embedding). The methodology — build ingest, grade with
clean-answer rate, prove reconciliation matters — transfers unchanged.
