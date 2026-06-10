"use client";

import type { SessionSummary } from "@/lib/sessions";

interface Props {
  sessions: SessionSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

export default function SessionsSidebar({ sessions, activeId, onSelect, onCreate }: Props) {
  return (
    <aside className="sessions" data-testid="sessions-sidebar">
      <h2>Sessions</h2>
      <button className="new" onClick={onCreate} data-testid="new-session">
        + New chat
      </button>
      <ul>
        {sessions.length === 0 && <li style={{ color: "#555", fontStyle: "italic" }}>No sessions yet</li>}
        {sessions.map((s) => (
          <li
            key={s.id}
            className={s.id === activeId ? "active" : ""}
            onClick={() => onSelect(s.id)}
            data-testid={`session-${s.id}`}
          >
            {s.title}
            <span className="count">{s.messageCount}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
