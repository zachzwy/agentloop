/** Safely parse JSON tool arguments; returns the parsed object or null on failure. */
export function parseToolArgs(rawArgs) {
  try {
    return JSON.parse(rawArgs);
  } catch {
    return null;
  }
}
