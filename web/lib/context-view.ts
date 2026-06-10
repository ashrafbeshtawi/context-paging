import type { ModelMessage } from "ai";

export interface MessageView {
  index: number;
  role: string;
  kind: "text" | "paged-out-ref" | "tool-call" | "tool-result";
  preview: string;
  chars: number;
  pageRef?: { id: number; title: string; summary: string };
}

export interface ContextView {
  messages: MessageView[];
  totals: {
    messages: number;
    chars: number;
    pageRefs: number;
  };
}

const PAGED_OUT_RE = /^\[Paged out → Page (\d+): "([^"]*)" — (.*)\]$/;

export function buildContextView(messages: ModelMessage[]): ContextView {
  const views: MessageView[] = messages.map((msg, i) => classify(msg, i));
  const chars = views.reduce((sum, m) => sum + m.chars, 0);
  const pageRefs = views.filter((m) => m.kind === "paged-out-ref").length;
  return {
    messages: views,
    totals: { messages: messages.length, chars, pageRefs },
  };
}

function classify(msg: ModelMessage, index: number): MessageView {
  const text = extractText(msg);
  const role = msg.role;

  if (role === "assistant" && typeof msg.content === "string") {
    const match = msg.content.match(PAGED_OUT_RE);
    if (match) {
      return {
        index,
        role,
        kind: "paged-out-ref",
        preview: msg.content,
        chars: msg.content.length,
        pageRef: {
          id: parseInt(match[1], 10),
          title: match[2],
          summary: match[3],
        },
      };
    }
  }

  if (Array.isArray(msg.content)) {
    const hasToolCall = msg.content.some((p: { type?: string }) => p.type === "tool-call");
    const hasToolResult = msg.content.some((p: { type?: string }) => p.type === "tool-result");
    if (hasToolCall) return { index, role, kind: "tool-call", preview: text, chars: text.length };
    if (hasToolResult) return { index, role, kind: "tool-result", preview: text, chars: text.length };
  }

  if (role === "tool") {
    return { index, role, kind: "tool-result", preview: text, chars: text.length };
  }

  return { index, role, kind: "text", preview: text, chars: text.length };
}

function extractText(msg: ModelMessage): string {
  if (typeof msg.content === "string") return msg.content;
  if (!Array.isArray(msg.content)) return "";
  const parts: string[] = [];
  for (const part of msg.content as Array<Record<string, unknown>>) {
    if (typeof part.text === "string") parts.push(part.text);
    else if (part.type === "tool-call" && typeof part.toolName === "string") {
      parts.push(`[tool-call: ${part.toolName}]`);
    } else if (part.type === "tool-result" && typeof part.toolName === "string") {
      parts.push(`[tool-result: ${part.toolName}]`);
    }
  }
  return parts.join(" ");
}
