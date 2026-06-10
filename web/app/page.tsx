"use client";

import { useCallback, useEffect, useState } from "react";
import SessionsSidebar from "@/components/SessionsSidebar";
import ChatPanel, { type ChatTurn, type ToolEvent } from "@/components/ChatPanel";
import ContextSidebar from "@/components/ContextSidebar";
import type { SessionSummary } from "@/lib/sessions";
import type { ContextView } from "@/lib/context-view";
import type { PageTableEntry } from "@/lib/page-table";
import { parseSseStream } from "@/lib/sse";

export default function Home() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [context, setContext] = useState<ContextView | null>(null);
  const [pageTable, setPageTable] = useState<PageTableEntry[]>([]);
  const [busy, setBusy] = useState(false);

  const refreshSessions = useCallback(async () => {
    const r = await fetch("/api/sessions");
    const data = (await r.json()) as { sessions: SessionSummary[] };
    setSessions(data.sessions);
  }, []);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  const loadSession = useCallback(async (id: string) => {
    setActiveId(id);
    setTurns([]);
    setContext(null);
    setPageTable([]);
    const r = await fetch(`/api/sessions/${id}`);
    if (!r.ok) return;
    const data = (await r.json()) as { context: ContextView; pageTable: PageTableEntry[] };
    setContext(data.context);
    setPageTable(data.pageTable);
  }, []);

  const createSession = useCallback(async () => {
    const r = await fetch("/api/sessions", { method: "POST" });
    const data = (await r.json()) as { session: SessionSummary };
    await refreshSessions();
    await loadSession(data.session.id);
  }, [refreshSessions, loadSession]);

  const send = useCallback(
    async (msg: string) => {
      if (!activeId) return;
      setBusy(true);
      const turnId = `t-${Date.now()}`;
      const newTurn: ChatTurn = { id: turnId, user: msg, assistant: "", events: [], pending: true };
      setTurns((prev) => [...prev, newTurn]);

      const updateTurn = (patch: (t: ChatTurn) => ChatTurn) =>
        setTurns((prev) => prev.map((t) => (t.id === turnId ? patch(t) : t)));

      try {
        const resp = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: activeId, message: msg }),
        });
        if (!resp.ok || !resp.body) {
          const err = await resp.text();
          updateTurn((t) => ({ ...t, assistant: `[error] ${err}`, pending: false }));
          return;
        }

        const reader = resp.body.getReader();
        for await (const ev of parseSseStream(reader)) {
          if (ev.event === "text") {
            const { chunk } = ev.data as { chunk: string };
            updateTurn((t) => ({ ...t, assistant: t.assistant + chunk }));
          } else if (ev.event === "tool-call") {
            const e = ev.data as { toolName: string; args: unknown };
            updateTurn((t) => ({
              ...t,
              events: [...t.events, { kind: "call", name: e.toolName, payload: e.args }],
            }));
          } else if (ev.event === "tool-result") {
            const e = ev.data as { toolName: string; output: unknown };
            updateTurn((t) => ({
              ...t,
              events: [...t.events, { kind: "result", name: e.toolName, payload: e.output }],
            }));
          } else if (ev.event === "context") {
            const e = ev.data as { context: ContextView; pageTable: PageTableEntry[] };
            setContext(e.context);
            setPageTable(e.pageTable);
          } else if (ev.event === "error") {
            const e = ev.data as { message: string };
            updateTurn((t) => ({ ...t, assistant: `[error] ${e.message}`, pending: false }));
          } else if (ev.event === "done") {
            updateTurn((t) => ({ ...t, pending: false }));
          }
        }
      } catch (err) {
        updateTurn((t) => ({ ...t, assistant: `[error] ${(err as Error).message}`, pending: false }));
      } finally {
        updateTurn((t) => ({ ...t, pending: false }));
        setBusy(false);
        refreshSessions();
      }
    },
    [activeId, refreshSessions]
  );

  return (
    <main className="layout">
      <SessionsSidebar
        sessions={sessions}
        activeId={activeId}
        onSelect={loadSession}
        onCreate={createSession}
      />
      <ChatPanel turns={turns} onSend={send} disabled={busy || !activeId} />
      <ContextSidebar context={context} pageTable={pageTable} />
    </main>
  );
}
