"use client";

import type { SessionSummary } from "@/lib/sessions";

interface Props {
  sessions: SessionSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onOpenSettings?: () => void;
  settingsBadge?: string;
}

export default function SessionsSidebar({
  sessions,
  activeId,
  onSelect,
  onCreate,
  onOpenSettings,
  settingsBadge,
}: Props) {
  return (
    <aside className="sessions" data-testid="sessions-sidebar">
      <h2>Sessions</h2>
      <button className="new" onClick={onCreate} data-testid="new-session">
        + New chat
      </button>
      {onOpenSettings && (
        <button className="settings-btn" onClick={onOpenSettings} data-testid="open-settings">
          ⚙ LLM settings{settingsBadge && <span className="badge">{settingsBadge}</span>}
        </button>
      )}
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
