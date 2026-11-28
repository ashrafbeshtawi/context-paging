import type { ModelMessage } from "ai";
import type { ChatTurn, ToolEvent } from "@/components/ChatPanel";

/**
 * Rebuilds the chat panel's turns from a session's stored messages, so an
 * opened session shows its history. Each user message starts a turn; the
 * assistant text, tool calls and tool results that follow belong to it.
 * Paged-out references stay in the assistant text as their marker line.
 */
export function buildChatTurns(messages: ModelMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let current: ChatTurn | null = null;

  const turn = (): ChatTurn => {
    if (!current) {
      current = { id: `h-${turns.length}`, user: "", assistant: "", events: [] };
      turns.push(current);
    }
    return current;
  };

  for (const msg of messages) {
    if (msg.role === "system") continue;

    if (msg.role === "user") {
      current = { id: `h-${turns.length}`, user: textOf(msg.content), assistant: "", events: [] };
      turns.push(current);
      continue;
    }

    const t = turn();
    if (typeof msg.content === "string") {
      appendText(t, msg.content);
      continue;
    }
    if (!Array.isArray(msg.content)) continue;

    for (const part of msg.content as Array<Record<string, unknown>>) {
      if (part.type === "text" && typeof part.text === "string") {
        appendText(t, part.text);
      } else if (part.type === "tool-call") {
        t.events.push(event("call", part, part.input ?? part.args));
      } else if (part.type === "tool-result") {
        t.events.push(event("result", part, part.output ?? part.result));
      }
    }
  }

  return turns;
}

function event(kind: ToolEvent["kind"], part: Record<string, unknown>, payload: unknown): ToolEvent {
  return { kind, name: typeof part.toolName === "string" ? part.toolName : "unknown", payload };
}

function appendText(t: ChatTurn, text: string) {
  if (!text) return;
  t.assistant = t.assistant ? `${t.assistant}\n\n${text}` : text;
}

function textOf(content: ModelMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as Array<Record<string, unknown>>)
    .map((p) => (p.type === "text" && typeof p.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join("\n");
}
