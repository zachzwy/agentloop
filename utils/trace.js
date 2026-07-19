import { writeFile } from "node:fs/promises";

export async function saveTrace(messages, iterationStats, outcome) {
  const redacted = JSON.stringify(
    { outcome, iterationStats, messages },
    null,
    2,
  ).replace(/sk-[A-Za-z0-9]{20,}/g, "sk-***REDACTED***");
  const file = `traces/${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  await writeFile(file, redacted, "utf8");
  console.log(`\ntrace saved: ${file}`);
}
