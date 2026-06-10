"use client";

import type { ContextView } from "@/lib/context-view";
import type { PageTableEntry } from "@/lib/page-table";

interface Props {
  context: ContextView | null;
  pageTable: PageTableEntry[];
}

export default function ContextSidebar({ context, pageTable }: Props) {
  return (
    <aside className="context" data-testid="context-sidebar">
      <h2>Context window</h2>
      {context ? (
        <>
          <div className="stats">
            <div className="stat">
              <div className="label">Resident</div>
              <div className="value">{context.totals.messages}</div>
            </div>
            <div className="stat">
              <div className="label">Chars</div>
              <div className="value">{context.totals.chars}</div>
            </div>
            <div className="stat">
              <div className="label">Refs</div>
              <div className="value">{context.totals.pageRefs}</div>
            </div>
          </div>
          {context.messages.map((m) => (
            <div key={m.index} className={`ctx-msg ${m.kind} ${m.role}`}>
              <div className="role">
                #{m.index} · {m.role} · {m.kind}
              </div>
              <div className="preview">{m.preview}</div>
            </div>
          ))}
        </>
      ) : (
        <div className="empty-state">No active session</div>
      )}

      <h2>Page table</h2>
      {pageTable.length === 0 ? (
        <div className="empty-state">No pages stored</div>
      ) : (
        flattenPages(pageTable).map((p) => (
          <div
            key={p.id}
            className={`page ${p.isResident ? "resident" : "swapped"}`}
            style={{ marginLeft: `${p.depth * 10}px` }}
            data-testid={`page-${p.id}`}
          >
            <div className="title">
              <span>Page {p.id}: {p.title}</span>
              <span className="badge">{p.isResident ? "resident" : "swapped"}</span>
            </div>
            {p.summary && <div className="summary">{p.summary}</div>}
          </div>
        ))
      )}
    </aside>
  );
}

function flattenPages(entries: PageTableEntry[]): PageTableEntry[] {
  const out: PageTableEntry[] = [];
  const walk = (list: PageTableEntry[]) => {
    for (const e of list) {
      out.push(e);
      if (e.children.length) walk(e.children);
    }
  };
  walk(entries);
  return out;
}
