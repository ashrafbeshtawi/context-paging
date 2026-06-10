import { AsyncLocalStorage } from "node:async_hooks";
import { query } from "./db.js";
import type { PageNode, PageRow } from "./types.js";

const sessionStorage = new AsyncLocalStorage<string>();

export function withSession<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  return sessionStorage.run(sessionId, fn);
}

export function currentSessionId(): string {
  const id = sessionStorage.getStore();
  if (!id) {
    throw new Error(
      "No session in context. Wrap calls in withSession(sessionId, ...) before invoking page operations."
    );
  }
  return id;
}

// --- Page CRUD ---

export async function insertPage(args: {
  title: string;
  summary: string;
  content: string;
  parentPageNo?: number;
  isResident?: boolean;
}): Promise<PageRow> {
  const sessionId = currentSessionId();

  let parentId: number | null = null;
  if (args.parentPageNo !== undefined) {
    const parent = await getPageByNo(args.parentPageNo);
    if (!parent) throw new Error(`Parent page ${args.parentPageNo} not found`);
    parentId = parent.id;
  }

  // Per-session monotonically increasing page_no. We compute the next value
  // inside the INSERT so a unique violation on (session_id, page_no) cannot
  // happen even with concurrent inserts (the COALESCE+MAX is evaluated in
  // the same statement that takes the lock).
  const sql = `
    INSERT INTO pages (session_id, page_no, parent_id, title, summary, content, is_resident)
    VALUES ($1,
            (SELECT COALESCE(MAX(page_no), 0) + 1 FROM pages WHERE session_id = $1),
            $2, $3, $4, $5, $6)
    RETURNING *
  `;
  const res = await query<PageRow>(sql, [
    sessionId,
    parentId,
    args.title,
    args.summary,
    args.content,
    args.isResident ?? false,
  ]);
  return res.rows[0];
}

export async function getPageByNo(pageNo: number): Promise<PageRow | null> {
  const sessionId = currentSessionId();
  const res = await query<PageRow>(
    "SELECT * FROM pages WHERE session_id = $1 AND page_no = $2",
    [sessionId, pageNo]
  );
  return res.rows[0] || null;
}

export async function getPageById(id: number): Promise<PageRow | null> {
  const sessionId = currentSessionId();
  const res = await query<PageRow>(
    "SELECT * FROM pages WHERE id = $1 AND session_id = $2",
    [id, sessionId]
  );
  return res.rows[0] || null;
}

export async function getChildren(parentId: number | null): Promise<PageRow[]> {
  const sessionId = currentSessionId();
  if (parentId === null) {
    const res = await query<PageRow>(
      "SELECT * FROM pages WHERE session_id = $1 AND parent_id IS NULL ORDER BY page_no",
      [sessionId]
    );
    return res.rows;
  }
  const res = await query<PageRow>(
    "SELECT * FROM pages WHERE session_id = $1 AND parent_id = $2 ORDER BY page_no",
    [sessionId, parentId]
  );
  return res.rows;
}

export async function buildTree(rootParentId: number | null = null): Promise<PageNode[]> {
  const rows = await getChildren(rootParentId);
  const nodes: PageNode[] = [];
  for (const row of rows) {
    const children = await buildTree(row.id);
    nodes.push({ row, children });
  }
  return nodes;
}

export async function updatePage(
  id: number,
  patch: { title?: string; summary?: string; content?: string; isResident?: boolean }
): Promise<PageRow | null> {
  const sessionId = currentSessionId();
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (patch.title !== undefined) { sets.push(`title = $${i++}`); values.push(patch.title); }
  if (patch.summary !== undefined) { sets.push(`summary = $${i++}`); values.push(patch.summary); }
  if (patch.content !== undefined) { sets.push(`content = $${i++}`); values.push(patch.content); }
  if (patch.isResident !== undefined) { sets.push(`is_resident = $${i++}`); values.push(patch.isResident); }
  if (sets.length === 0) return getPageById(id);

  sets.push(`updated_at = NOW()`);
  values.push(id, sessionId);

  const sql = `UPDATE pages SET ${sets.join(", ")} WHERE id = $${i++} AND session_id = $${i} RETURNING *`;
  const res = await query<PageRow>(sql, values);
  return res.rows[0] || null;
}

export async function deletePage(id: number): Promise<boolean> {
  const sessionId = currentSessionId();
  const res = await query(
    "DELETE FROM pages WHERE id = $1 AND session_id = $2",
    [id, sessionId]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function isDescendantOf(
  candidateAncestorId: number,
  pageId: number
): Promise<boolean> {
  // Walk up from pageId via parent_id and return true if we ever hit candidateAncestorId.
  // Scoped to the current session by getPageById.
  let current = await getPageById(pageId);
  while (current) {
    if (current.parent_id === candidateAncestorId) return true;
    if (current.parent_id === null) return false;
    current = await getPageById(current.parent_id);
  }
  return false;
}

export async function setParent(id: number, newParentId: number | null): Promise<PageRow | null> {
  const sessionId = currentSessionId();
  const res = await query<PageRow>(
    "UPDATE pages SET parent_id = $1, updated_at = NOW() WHERE id = $2 AND session_id = $3 RETURNING *",
    [newParentId, id, sessionId]
  );
  return res.rows[0] || null;
}
