#!/usr/bin/env bash
# Layer 3 sandbox for the eval batch, using bubblewrap (no daemon, no root).
#
# The whole runner — and therefore every program run_command spawns — is confined:
#   • filesystem: only the output dir and /tmp are writable; the harness and
#     system dirs are read-only; the host $HOME and other projects are NOT
#     mounted, so they don't exist inside the sandbox (`cat ~/.ssh/id_rsa` fails
#     because the path isn't there, regardless of the command policy).
#   • the harness .env (the REAL api key) is masked with /dev/null; the key is
#     injected via --setenv instead, so it never sits on a readable file.
#   • network is shared (the LLM API needs it). Network *tools* are policy-denied
#     — that is the compromise while the model call happens in-sandbox.
#
# Usage:
#   DEEPSEEK_API_KEY=... eval/sandbox-run.sh [task-filters...]
#   e.g.  eval/sandbox-run.sh p1 p8
#
set -euo pipefail

HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${EVAL_OUTPUT_DIR:-$HARNESS/eval/reports/_sandbox-out}"
NODE_BIN="$(command -v node)"
NODE_DIR="$(dirname "$(dirname "$(readlink -f "$NODE_BIN")")")" # .../node/vX

: "${DEEPSEEK_API_KEY:?set DEEPSEEK_API_KEY in the environment}"
mkdir -p "$OUTPUT/traces" "$OUTPUT/reports"

exec bwrap \
  --unshare-all --share-net \
  --die-with-parent \
  --proc /proc --dev /dev \
  --ro-bind /usr /usr \
  --ro-bind /bin /bin \
  --ro-bind /lib /lib \
  --ro-bind-try /lib64 /lib64 \
  --ro-bind /etc/ssl /etc/ssl \
  --ro-bind-try /etc/resolv.conf /etc/resolv.conf \
  --ro-bind-try /etc/ca-certificates /etc/ca-certificates \
  --ro-bind "$NODE_DIR" "$NODE_DIR" \
  --ro-bind "$HARNESS" "$HARNESS" \
  --ro-bind /dev/null "$HARNESS/.env" \
  --bind "$OUTPUT" "$OUTPUT" \
  --tmpfs /tmp \
  --setenv DEEPSEEK_API_KEY "$DEEPSEEK_API_KEY" \
  --setenv AGENTLOOP_TRACE_DIR "$OUTPUT/traces" \
  --setenv EVAL_REPORT_DIR "$OUTPUT/reports" \
  --setenv PATH "$NODE_DIR/bin:/usr/bin:/bin" \
  --setenv HOME /tmp \
  --chdir "$HARNESS" \
  "$NODE_BIN" eval/run-eval.js "$@"
