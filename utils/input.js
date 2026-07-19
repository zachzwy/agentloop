import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export async function getUserInput() {
  const rl = readline.createInterface({ input, output });
  const userInput = await rl.question("Enter your question: ");
  rl.close();

  return userInput;
}
