import { streamText, tool, stepCountIs, type ModelMessage, type LanguageModel } from "ai";
import { z } from "zod";
import {
  handlePageOut,
  handlePageTable,
  handlePageIn,
  handlePageUpdate,
  handlePageFree,
  handlePageMove,
  handlePageMerge,
  swapOut,
} from "./context-manager.js";

const SYSTEM_PROMPT = `You are an AI assistant powered by Context Paging — virtual memory for your context window.

You have the following tools available for managing your context:
- page_out: Save context to disk and remove it from your active window
- page_in: Load a page back into your active context
- page_table: View the index of all stored pages
- page_update: Modify a page's metadata or content
- page_free: Permanently delete a page
- page_move: Reorganize page nesting
- page_merge: Consolidate multiple pages into one

## How Context Paging works
- Your context window is like RAM: finite. Context Paging lets you swap content to disk and page it back in on demand.
- When you call page_out, the messages containing that context are SWAPPED OUT (removed from your active context and replaced with a short reference). This frees up space.
- When you need that context again, call page_in to swap it back into your active context.
- Use page_table to see your page table — a lightweight index of everything you've stored.

## When to page out
- After completing a significant piece of work (debugging session, implementation, research)
- When the conversation is getting long and you have accumulated knowledge worth preserving
- Before switching to a different topic or subtask
- When the user asks you to save/checkpoint context

## When to page in
- When you need information you previously paged out
- When the user references something from earlier in the conversation
- When your page table shows a relevant page for the current task

## Guidelines
- Always include a good summary when paging out — this is what you see in the page table
- Keep the content comprehensive — include decisions made, code written, problems found
- Mark pages as not resident (is_resident: false) when you're done referencing them
- You can nest pages under parent pages to organize related work`;

export function createTools() {
  return {
    page_out: tool({
      description:
        "Swap context out to disk. Saves content into a new page and removes the corresponding messages from your active context.",
      inputSchema: z.object({
        title: z.string().describe("Page title"),
        content: z.string().describe("The context/content to page out"),
        summary: z.string().describe("Brief summary for the page table"),
        parent_id: z.number().int().positive().optional().describe("Parent page ID for nesting"),
        swap_count: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Number of recent messages to swap out of context (default: 0)"),
      }),
      execute: async (args) => {
        const result = await handlePageOut(args);
        return { result, _swap: args.swap_count, _title: args.title, _summary: args.summary };
      },
    }),

    page_table: tool({
      description: "Show the page table — a lightweight index of all stored pages with their status.",
      inputSchema: z.object({
        parent_id: z.number().int().positive().optional().describe("List children of this page only"),
      }),
      execute: async (args) => {
        const result = await handlePageTable(args);
        return { result };
      },
    }),

    page_in: tool({
      description: "Swap a page back into your active context. Loads the full content and marks it as resident.",
      inputSchema: z.object({
        id: z.number().int().positive().describe("Page ID to swap in"),
      }),
      execute: async (args) => {
        const result = await handlePageIn(args);
        return { result };
      },
    }),

    page_update: tool({
      description: "Update a page's title, summary, content, or resident status.",
      inputSchema: z.object({
        id: z.number().int().positive().describe("Page ID"),
        title: z.string().optional().describe("New title"),
        summary: z.string().optional().describe("New summary"),
        content: z.string().optional().describe("New content"),
        is_resident: z.boolean().optional().describe("Set resident status"),
      }),
      execute: async (args) => {
        const result = await handlePageUpdate(args);
        return { result };
      },
    }),

    page_free: tool({
      description: "Free a page — permanently delete it from disk.",
      inputSchema: z.object({
        id: z.number().int().positive().describe("Page ID"),
        recursive: z.boolean().default(true).describe("Free children too"),
      }),
      execute: async (args) => {
        const result = await handlePageFree(args);
        return { result };
      },
    }),

    page_move: tool({
      description: "Move a page under a new parent or to root.",
      inputSchema: z.object({
        id: z.number().int().positive().describe("Page ID"),
        new_parent_id: z.number().int().positive().optional().describe("New parent ID, omit for root"),
      }),
      execute: async (args) => {
        const result = await handlePageMove(args);
        return { result };
      },
    }),

    page_merge: tool({
      description: "Merge source pages into a target page, then free the sources.",
      inputSchema: z.object({
        source_ids: z.array(z.number().int().positive()).min(1).describe("Source page IDs"),
        target_id: z.number().int().positive().describe("Target page ID"),
        strategy: z.enum(["concatenate", "provided"]).default("concatenate"),
        merged_content: z.string().optional(),
        merged_summary: z.string().optional(),
      }),
      execute: async (args) => {
        const result = await handlePageMerge(args);
        return { result };
      },
    }),
  };
}

export interface AgentOptions {
  model: LanguageModel;
  maxSteps?: number;
  debug?: boolean;
  onText?: (text: string) => void;
  onToolCall?: (toolName: string, args: unknown) => void;
  onToolResult?: (toolName: string, result: unknown) => void;
}

export async function runAgent(
  messages: ModelMessage[],
  options: AgentOptions
): Promise<{ messages: ModelMessage[]; response: string }> {
  const maxSteps = options.maxSteps || 10;

  // Inject live page table into system prompt so the agent always knows page IDs + titles
  const pageTable = await handlePageTable({});
  const systemWithPageTable = `${SYSTEM_PROMPT}

## Current Page Table
${pageTable}`;

  const result = streamText({
    model: options.model,
    system: systemWithPageTable,
    messages,
    tools: createTools(),
    stopWhen: stepCountIs(maxSteps),
    experimental_onToolCallStart({ toolCall }) {
      options.onToolCall?.(toolCall.toolName, toolCall.input);
    },
    experimental_onToolCallFinish(event) {
      options.onToolResult?.(event.toolCall.toolName, "output" in event ? event.output : undefined);
    },
  });

  // Stream text chunks to the callback
  for await (const chunk of result.textStream) {
    options.onText?.(chunk);
  }

  // Wait for the full result
  const finalResult = await result;
  const responseText = await finalResult.text;

  const response = await finalResult.response;
  let updatedMessages: ModelMessage[] = [...messages, ...response.messages];

  for (const step of (await finalResult.steps)) {
    for (const toolResult of step.toolResults) {
      if (
        toolResult.toolName === "page_out" &&
        typeof toolResult.output === "object" &&
        toolResult.output !== null
      ) {
        const res = toolResult.output as {
          result: string;
          _swap?: number;
          _title?: string;
          _summary?: string;
        };
        if (res._swap && res._swap > 0) {
          const idMatch = res.result.match(/Page (\d+)/);
          const pageId = idMatch ? parseInt(idMatch[1], 10) : 0;
          updatedMessages = swapOut(
            updatedMessages,
            pageId,
            res._title || "Untitled",
            res._summary || "",
            res._swap
          );
        }
      }
    }
  }

  return {
    messages: updatedMessages,
    response: responseText,
  };
}
