#!/usr/bin/env node

import "dotenv/config";
import * as readline from "node:readline";
import type { CoreMessage } from "ai";
import { runAgent } from "./agent.js";
import { ensureRoot } from "./storage.js";
import { resolveModel } from "./providers.js";

async function main() {
  await ensureRoot();

  const model = await resolveModel();
  const provider = process.env.AI_PROVIDER || "anthropic";
  const modelId = process.env.AI_MODEL || "(default)";

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let messages: CoreMessage[] = [];

  console.log("Context Paging Agent");
  console.log("Virtual memory for AI context. The agent pages context in and out on demand.");
  console.log(`Provider: ${provider} | Model: ${modelId}`);
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
        const result = await runAgent(messages, { model });
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
