// Coerce first: a tool that returns a non-string (or undefined) must not crash
// the loop at the log line, after the API call has already been paid for.
export const preview = (s, n = 200) => {
  const str = String(s ?? "");
  return str.length <= n
    ? str
    : str.slice(0, n) + `... [${str.length} chars total]`;
};

export function printRunMetrics(iterationStats) {
  console.log("\n=== Run Metrics ===");
  let sumPrompt = 0;
  let sumCompletion = 0;
  let sumTotal = 0;
  for (const usage of iterationStats) {
    console.log(
      `Iteration ${usage.iteration}: ${usage.apiMs}ms, ${usage.finishReason}, Prompt: ${usage.promptTokens}, Completion: ${usage.completionTokens}, Total: ${usage.totalTokens}`,
    );
    sumPrompt += usage.promptTokens;
    sumCompletion += usage.completionTokens;
    sumTotal += usage.totalTokens;
  }
  console.log("---------------------------");
  console.log(
    `Total:       Prompt: ${sumPrompt}, Completion: ${sumCompletion}, Total: ${sumTotal}`,
  );
  console.log("===========================");
}
