import type { ModelMessage } from "ai";
import { query } from "./db.js";
import type { SessionRow, SessionWithMessages } from "./types.js";

export interface MessageRow {
  id: number;
  session_id: string;
  ordinal: number;
  role: string;
  content: unknown;
  created_at: Date;
}

export interface SessionSummary {
  id: string;
  title: string;
  provider: string | null;
  model: string | null;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
}

function newSessionId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `s-${Date.now().toString(36)}-${rand}`;
}

export async function createSession(opts: { title?: string; id?: string } = {}): Promise<SessionRow> {
  const id = opts.id || newSessionId();
  const title = opts.title?.trim() || "New chat";
  const res = await query<SessionRow>(
    `INSERT INTO sessions (id, title) VALUES ($1, $2) RETURNING *`,
    [id, title]
  );
  return res.rows[0];
}

export async function getOrCreateSession(opts: { id: string; title?: string }): Promise<SessionRow> {
  const existing = await getSession(opts.id);
  if (existing) return existing;
  return createSession({ id: opts.id, title: opts.title });
}

export async function getSession(id: string): Promise<SessionRow | null> {
  const res = await query<SessionRow>("SELECT * FROM sessions WHERE id = $1", [id]);
  return res.rows[0] || null;
}

export async function listSessions(): Promise<SessionSummary[]> {
  const res = await query<SessionRow & { message_count: string }>(
    `SELECT s.*,
            (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count
     FROM sessions s
     ORDER BY s.updated_at DESC`
  );
  return res.rows.map((r) => ({
    id: r.id,
    title: r.title,
    provider: r.provider,
    model: r.model,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    messageCount: parseInt(r.message_count, 10),
  }));
}

export async function deleteSession(id: string): Promise<boolean> {
  const res = await query("DELETE FROM sessions WHERE id = $1", [id]);
  return (res.rowCount ?? 0) > 0;
}

export async function getMessages(sessionId: string): Promise<ModelMessage[]> {
  const res = await query<MessageRow>(
    "SELECT * FROM messages WHERE session_id = $1 ORDER BY ordinal",
    [sessionId]
  );
  return res.rows.map((r) => ({ role: r.role, content: r.content } as ModelMessage));
}

export async function getSessionWithMessages(id: string): Promise<SessionWithMessages | null> {
  const session = await getSession(id);
  if (!session) return null;
  const messages = await getMessages(id);
  return { ...session, messages };
}

// Replace the session's messages with the given array atomically.
// The agent treats the message array as a value: it appends new entries
// AND rewrites the tail during swapOut. So overwriting the entire row set
// is the correct model for persistence.
export async function replaceMessages(sessionId: string, messages: ModelMessage[]): Promise<void> {
  const session = await getSession(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  const newTitle = computeTitle(session.title, messages);

  const client = await (await import("./db.js")).getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM messages WHERE session_id = $1", [sessionId]);
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      await client.query(
        `INSERT INTO messages (session_id, ordinal, role, content)
         VALUES ($1, $2, $3, $4)`,
        [sessionId, i, msg.role, JSON.stringify(msg.content)]
      );
    }
    await client.query(
      "UPDATE sessions SET updated_at = NOW(), title = $1 WHERE id = $2",
      [newTitle, sessionId]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

function computeTitle(currentTitle: string, messages: ModelMessage[]): string {
  if (currentTitle !== "New chat") return currentTitle;
  const firstUser = messages.find((m) => m.role === "user");
  if (firstUser && typeof firstUser.content === "string") {
    return firstUser.content.slice(0, 60);
  }
  return currentTitle;
}
