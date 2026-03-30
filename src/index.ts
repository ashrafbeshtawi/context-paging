#!/usr/bin/env node

import "dotenv/config";
import * as readline from "node:readline";
import type { ModelMessage } from "ai";
import { runAgent } from "./agent.js";
import { ensureRoot } from "./storage.js";
import { resolveModel } from "./providers.js";

const DEBUG = process.env.DEBUG === "true" || process.env.DEBUG === "1";

function debug(msg: string) {
  if (!DEBUG) return;
  process.stdout.write(`\x1b[90m[DEBUG] ${msg}\x1b[0m\n`);
}

function debugContextStats(messages: ModelMessage[]) {
  if (!DEBUG) return;

  const totalMessages = messages.length;
  const roles: Record<string, number> = {};
  let totalChars = 0;

  for (const msg of messages) {
    roles[msg.role] = (roles[msg.role] || 0) + 1;
    if (typeof msg.content === "string") {
      totalChars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if ("text" in part && typeof part.text === "string") {
          totalChars += part.text.length;
        }
      }
    }
  }

  const pagedOutCount = messages.filter(
    (m) => typeof m.content === "string" && m.content.startsWith("[Paged out")
  ).length;

  console.log("");
  console.log("\x1b[36m╔══════════════════════════════════════╗\x1b[0m");
  console.log("\x1b[36m║       CONTEXT WINDOW STATUS          ║\x1b[0m");
  console.log("\x1b[36m╠══════════════════════════════════════╣\x1b[0m");
  console.log(`\x1b[36m║\x1b[0m  MESSAGES RESIDENT: \x1b[1m${String(totalMessages).padEnd(16)}\x1b[0m \x1b[36m║\x1b[0m`);
  console.log(`\x1b[36m║\x1b[0m  TOTAL CHARS:       \x1b[1m${String(totalChars).padEnd(16)}\x1b[0m \x1b[36m║\x1b[0m`);
  console.log(`\x1b[36m║\x1b[0m  PAGE REFERENCES:   \x1b[1m${String(pagedOutCount).padEnd(16)}\x1b[0m \x1b[36m║\x1b[0m`);
  console.log(`\x1b[36m║\x1b[0m  USER MESSAGES:     \x1b[1m${String(roles["user"] || 0).padEnd(16)}\x1b[0m \x1b[36m║\x1b[0m`);
  console.log(`\x1b[36m║\x1b[0m  ASSISTANT MESSAGES: \x1b[1m${String(roles["assistant"] || 0).padEnd(15)}\x1b[0m \x1b[36m║\x1b[0m`);
  console.log(`\x1b[36m║\x1b[0m  TOOL MESSAGES:     \x1b[1m${String(roles["tool"] || 0).padEnd(16)}\x1b[0m \x1b[36m║\x1b[0m`);
  console.log("\x1b[36m╚══════════════════════════════════════╝\x1b[0m");
}

async function main() {
  await ensureRoot();

  const model = await resolveModel();
  const provider = process.env.AI_PROVIDER || "anthropic";
  const modelId = process.env.AI_MODEL || "(default)";

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let messages: ModelMessage[] = [];

  console.log("Context Paging Agent");
  console.log("Virtual memory for AI context. The agent pages context in and out on demand.");
  console.log(`Provider: ${provider} | Model: ${modelId}`);
  if (DEBUG) console.log("\x1b[33m[DEBUG MODE ENABLED]\x1b[0m");
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
        process.stdout.write("\nAssistant: ");

        const result = await runAgent(messages, {
          model,
          debug: DEBUG,
          onText(chunk) {
            process.stdout.write(chunk);
          },
          onToolCall(toolName, args) {
            if (DEBUG) {
              console.log(`\n\x1b[33m[TOOL CALL] ${toolName}\x1b[0m`);
              console.log(`\x1b[90m  args: ${JSON.stringify(args, null, 2).split("\n").join("\n  ")}\x1b[0m`);
            }
          },
          onToolResult(toolName, output) {
            if (DEBUG) {
              const preview = JSON.stringify(output);
              const truncated = preview.length > 200 ? preview.slice(0, 200) + "..." : preview;
              console.log(`\x1b[32m[TOOL RESULT] ${toolName} → ${truncated}\x1b[0m`);
            }
          },
        });

        messages = result.messages;
        console.log("\n");

        debugContextStats(messages);

        if (!DEBUG) {
          console.log(`  [Context: ${messages.length} messages resident]\n`);
        }
      } catch (err) {
        console.error(`\nError: ${(err as Error).message}\n`);
      }

      prompt();
    });
  };

  prompt();
}

main();
