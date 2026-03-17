#!/usr/bin/env node

import * as readline from "node:readline";
import type { CoreMessage } from "ai";
import { runAgent } from "./agent.js";
import { ensureRoot } from "./storage.js";

async function main() {
  await ensureRoot();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let messages: CoreMessage[] = [];

  console.log("Context Paging Agent");
  console.log("Virtual memory for AI context. The agent pages context in and out on demand.");
  console.log('Type "quit" to exit.\n');

  const prompt = () => {
    rl.question("You: ", async (input) => {
      const trimmed = input.trim();
      if (trimmed.toLowerCase() === "quit") {
        console.log("Goodbye.");
        rl.close();
        return;
      }

      if (!trimmed) {
        prompt();
        return;
      }

      messages.push({ role: "user", content: trimmed });

      try {
        const result = await runAgent(messages);
        messages = result.messages;
        console.log(`\nAssistant: ${result.response}\n`);
        console.log(`  [Context: ${messages.length} messages resident]\n`);
      } catch (err) {
        console.error(`\nError: ${(err as Error).message}\n`);
      }

      prompt();
    });
  };

  prompt();
}

main();
