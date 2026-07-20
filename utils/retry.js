import { setTimeout } from "node:timers/promises";
import OpenAI from "openai";

const MAX_RETRIES = 4;

/** Node/undici error codes that mean "the network hiccuped", not "your code is wrong". */
const RETRYABLE_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

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
 * Honour the server's own guidance on a 429/503 when it sends it.
 * `Retry-After` is either seconds or an HTTP date. Returns ms, or null.
 */
function retryAfterMs(error) {
  const raw =
    error?.headers?.["retry-after"] ?? error?.headers?.get?.("retry-after");
  if (!raw) return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds * 1000;

  const date = Date.parse(raw);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());

  return null;
}

/**
 * Determines whether the error is transient and worth retrying.
 *
 * Deliberately conservative: only rate limits, server errors, and
 * connection-level failures. Everything else — including our own TypeErrors and
 * 4xx schema mistakes — fails fast, because retrying a bug just wastes the
 * backoff budget and hides the stack trace behind four sleeps.
 */
function isRetryable(error) {
  if (error instanceof OpenAI.APIConnectionError) return true;
  if (error instanceof OpenAI.APIError) {
    const status = error.status;
    return status === 429 || (status >= 500 && status < 600);
  }
  if (error?.code && RETRYABLE_CODES.has(error.code)) return true;
  if (error?.cause?.code && RETRYABLE_CODES.has(error.cause.code)) return true;
  return false;
}

/**
 * Wraps a chat completion call with automatic retries.
 * Throws the last error if all retries are exhausted or the error is fatal.
 *
 * @param {object} createParams - Params passed to chat.completions.create.
 * @param {object} client - The OpenAI client (construct it with maxRetries: 0).
 */
async function callWithRetry(createParams, client) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await client.chat.completions.create(createParams);
    } catch (error) {
      if (!isRetryable(error) || attempt === MAX_RETRIES) {
        throw error;
      }

      // Prefer the server's instruction over our guess.
      const delay = retryAfterMs(error) ?? retryDelay(attempt);
      console.warn(
        `[retry] API call failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ` +
          `${error.message}. Retrying in ${Math.round(delay)} ms...`,
      );
      await setTimeout(delay);
    }
  }
}

export { MAX_RETRIES, retryDelay, retryAfterMs, isRetryable, callWithRetry };
