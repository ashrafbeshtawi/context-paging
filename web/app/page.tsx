"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SessionsSidebar from "@/components/SessionsSidebar";
import ChatPanel, { type ChatTurn } from "@/components/ChatPanel";
import ContextSidebar from "@/components/ContextSidebar";
import SettingsModal from "@/components/SettingsModal";
import type { SessionSummary } from "@/lib/sessions";
import type { ContextView } from "@/lib/context-view";
import type { PageTableEntry } from "@/lib/page-table";
import { parseSseStream } from "@/lib/sse";
import { EMPTY_CONFIG, type LlmConfig, loadConfig, toRequestBody } from "@/lib/llm-config";

export default function Home() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [context, setContext] = useState<ContextView | null>(null);
  const [pageTable, setPageTable] = useState<PageTableEntry[]>([]);
  // Sessions with a turn still streaming. Tracked per session so switching
  // away from a running turn doesn't lock the newly opened session's input.
  const [busySessions, setBusySessions] = useState<ReadonlySet<string>>(() => new Set());
  // Mirrors activeId synchronously so a stream (or a session load) that
  // outlives a session switch can tell its events are no longer wanted.
  const activeIdRef = useRef<string | null>(null);
  const [llmConfig, setLlmConfig] = useState<LlmConfig>(EMPTY_CONFIG);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    setLlmConfig(loadConfig());
  }, []);

  const refreshSessions = useCallback(async () => {
    const r = await fetch("/api/sessions");
    const data = (await r.json()) as { sessions: SessionSummary[] };
    setSessions(data.sessions);
  }, []);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  const loadSession = useCallback(async (id: string) => {
    activeIdRef.current = id;
    setActiveId(id);
    setTurns([]);
    setContext(null);
    setPageTable([]);
    const r = await fetch(`/api/sessions/${id}`);
    if (!r.ok) return;
    const data = (await r.json()) as { context: ContextView; pageTable: PageTableEntry[] };
    // The user may have opened another session while this request was in flight.
    if (activeIdRef.current !== id) return;
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
      const sessionId = activeId;
      setBusySessions((prev) => new Set(prev).add(sessionId));
      const turnId = `t-${Date.now()}`;
      const newTurn: ChatTurn = { id: turnId, user: msg, assistant: "", events: [], pending: true };
      setTurns((prev) => [...prev, newTurn]);

      // Once the user opens another session, this turn's events belong to a
      // session that is no longer on screen: drop them. The stream itself is
      // still read to the end (not aborted) so the server finishes the turn
      // and saves it; reopening the session loads the saved state.
      const isCurrent = () => activeIdRef.current === sessionId;
      const updateTurn = (patch: (t: ChatTurn) => ChatTurn) => {
        if (!isCurrent()) return;
        setTurns((prev) => prev.map((t) => (t.id === turnId ? patch(t) : t)));
      };

      try {
        const resp = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            message: msg,
            ...toRequestBody(llmConfig),
          }),
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
            if (!isCurrent()) continue;
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
        setBusySessions((prev) => {
          const next = new Set(prev);
          next.delete(sessionId);
          return next;
        });
        refreshSessions();
      }
    },
    [activeId, llmConfig, refreshSessions]
  );

  const busy = activeId !== null && busySessions.has(activeId);

  const customConfigured =
    Boolean(llmConfig.apiKey) || Boolean(llmConfig.provider) || Boolean(llmConfig.model);

  return (
    <main className="layout">
      <SessionsSidebar
        sessions={sessions}
        activeId={activeId}
        onSelect={loadSession}
        onCreate={createSession}
        onOpenSettings={() => setSettingsOpen(true)}
        settingsBadge={customConfigured ? "custom" : "env"}
      />
      <ChatPanel turns={turns} onSend={send} disabled={busy || !activeId} />
      <ContextSidebar context={context} pageTable={pageTable} />
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onChange={setLlmConfig}
      />
    </main>
  );
}
