"use client";

import { useState, useRef, useEffect, KeyboardEvent } from "react";

export interface ChatTurn {
  id: string;
  user: string;
  assistant: string;
  events: ToolEvent[];
  pending?: boolean;
}

export interface ToolEvent {
  kind: "call" | "result";
  name: string;
  payload: unknown;
}

interface Props {
  turns: ChatTurn[];
  onSend: (msg: string) => void;
  disabled: boolean;
}

export default function ChatPanel({ turns, onSend, disabled }: Props) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight });
    }
  }, [turns]);

  function submit() {
    const text = input.trim();
    if (!text || disabled) return;
    onSend(text);
    setInput("");
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <section className="chat">
      <div className="messages" ref={scrollRef} data-testid="messages">
        {turns.length === 0 && (
          <div className="chat-empty">
            <div>Start a conversation.</div>
            <div style={{ fontSize: 11 }}>
              Ask the agent to page out context, then bring it back later.
            </div>
          </div>
        )}
        {turns.map((t) => (
          <div key={t.id}>
            <div className="msg user">
              <div className="role">You</div>
              <div>{t.user}</div>
            </div>
            {t.events.map((ev, i) => (
              <div key={i} className={`tool-event ${ev.kind === "result" ? "result" : ""}`}>
                <span className="name">
                  {ev.kind === "call" ? "→ tool call" : "← tool result"}: {ev.name}
                </span>
                <pre style={{ margin: "4px 0 0", whiteSpace: "pre-wrap", color: "#888" }}>
                  {truncate(JSON.stringify(ev.payload, null, 2))}
                </pre>
              </div>
            ))}
            {(t.assistant || t.pending) && (
              <div className="msg assistant">
                <div className="role">Assistant {t.pending && "·typing..."}</div>
                <div>{t.assistant}</div>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="input">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder="Ask the agent... (Enter to send, Shift+Enter for newline)"
          disabled={disabled}
          data-testid="chat-input"
        />
        <button onClick={submit} disabled={disabled || !input.trim()} data-testid="send">
          {disabled ? "..." : "Send"}
        </button>
      </div>
    </section>
  );
}

function truncate(s: string, max = 400) {
  return s.length > max ? s.slice(0, max) + "…" : s;
}
