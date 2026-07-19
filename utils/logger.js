export const preview = (s, n = 200) =>
  s.length <= n ? s : s.slice(0, n) + `... [${s.length} chars total]`;

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
