# Layer 3 sandbox for the eval batch — portable alternative to eval/sandbox-run.sh
# (which uses bubblewrap and is the tested path in this repo's dev env).
#
# The harness is baked into the image (read-only at runtime via --read-only), the
# real API key is passed at run time (never baked), and only /tmp and /output are
# writable. Mirrors the bwrap sandbox's guarantees.
#
#   docker build -t agentloop-eval .
#   docker run --rm --read-only --tmpfs /tmp \
#     -v "$PWD/eval/reports/_docker-out:/output" \
#     -e DEEPSEEK_API_KEY \
#     agentloop-eval p1        # task filters as args; omit to run all
FROM node:24-slim

WORKDIR /harness
# Install deps from lockfile first for layer caching.
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Bring in the harness source (.dockerignore excludes node_modules, .git, .env,
# reports, traces).
COPY . .
# Never bake a key into the image; it is provided via -e at run time.
RUN rm -f .env

# Non-root. /output and /tmp are mounted/tmpfs and world-writable at run time.
USER node

ENV AGENTLOOP_TRACE_DIR=/output/traces \
    EVAL_REPORT_DIR=/output/reports

ENTRYPOINT ["node", "eval/run-eval.js"]
