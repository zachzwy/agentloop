import { setTimeout } from "node:timers/promises";
import OpenAI from "openai";

const MAX_RETRIES = 4;

/**
 * Returns a delay in ms for the given attempt (0-based), using exponential
 * backoff with random jitter: base * 2^attempt + random(0, 1000).
 */
function retryDelay(attempt) {
  const base = 1000; // 1 s
  const jitter = Math.random() * 1000;
  return base * 2 ** attempt + jitter;
}

/**
 * Determines whether the error is transient and worth retrying.
 * Retries on: rate limits (429), server errors (5xx), and network /
 * connection-level failures (no status code).
 */
function isRetryable(error) {
  if (error instanceof OpenAI.APIError) {
    const status = error.status;
    return status === 429 || (status >= 500 && status < 600);
  }
  // Non-API errors (network issues, timeouts, DNS failures, etc.)
  return true;
}

/**
 * Wraps an async OpenAI chat completion call with automatic retries.
 * Throws the last error if all retries are exhausted.
 *
 * @param {Function} completionFn - An async function that calls the completion API.
 * @param {...any} args - Arguments forwarded to the completion function.
 */
async function callWithRetry(createParams, client) {
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await client.chat.completions.create(createParams);
    } catch (error) {
      lastError = error;

      if (!isRetryable(error) || attempt === MAX_RETRIES) {
        throw error;
      }

      const delay = retryDelay(attempt);
      console.warn(
        `[retry] OpenAI call failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ` +
          `${error.message}. Retrying in ${Math.round(delay)} ms...`,
      );
      await setTimeout(delay);
    }
  }

  // Should never reach here, but satisfies the type-checker.
  throw lastError;
}

export { MAX_RETRIES, retryDelay, isRetryable, callWithRetry };
