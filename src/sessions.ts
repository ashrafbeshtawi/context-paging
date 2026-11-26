import type { ModelMessage } from "ai";
import type pg from "pg";
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

// What a turn saw of the session when it started. Passed back to
// replaceMessages so a write based on stale history is rejected.
export interface SessionVersion {
  updatedAt: Date;
  messageCount: number;
}

// Thrown by replaceMessages when the session changed after `expected` was read.
export class SessionConflictError extends Error {
  readonly sessionId: string;
  constructor(sessionId: string) {
    super(`Session ${sessionId} was changed by another turn; reload to see the latest messages`);
    this.name = "SessionConflictError";
    this.sessionId = sessionId;
  }
}

export function sessionVersion(session: SessionWithMessages): SessionVersion {
  return { updatedAt: session.updated_at, messageCount: session.messages.length };
}

// Replace the session's messages with the given array atomically.
// The agent treats the message array as a value: it appends new entries
// AND rewrites the tail during swapOut. So overwriting the entire row set
// is the correct model for persistence.
//
// The sessions row is locked (SELECT ... FOR NO KEY UPDATE) for the whole
// write, so concurrent writers are serialized. NO KEY UPDATE rather than
// UPDATE so it does not wait on the KEY SHARE lock a page insert in a still
// running turn holds on the same row. When `expected` is given, the write is
// refused with SessionConflictError if the session's updated_at or message
// count no longer match what the caller read at the start of its turn.
//
// With `client`, the write joins the caller's open transaction (see
// withSessionTransaction) and the caller commits or rolls back; without it,
// the write runs in its own transaction.
export async function replaceMessages(
  sessionId: string,
  messages: ModelMessage[],
  opts: { expected?: SessionVersion; client?: pg.PoolClient } = {}
): Promise<void> {
  if (opts.client) return writeMessages(opts.client, sessionId, messages, opts.expected);

  const client = await (await import("./db.js")).getPool().connect();
  try {
    await client.query("BEGIN");
    await writeMessages(client, sessionId, messages, opts.expected);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function writeMessages(
  client: pg.PoolClient,
  sessionId: string,
  messages: ModelMessage[],
  expected: SessionVersion | undefined
): Promise<void> {
  const locked = await client.query<{ title: string; updated_at_ms: string; message_count: string }>(
    `SELECT s.title,
            FLOOR(EXTRACT(EPOCH FROM s.updated_at) * 1000)::bigint AS updated_at_ms,
            (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count
     FROM sessions s
     WHERE s.id = $1
     FOR NO KEY UPDATE`,
    [sessionId]
  );
  const session = locked.rows[0];
  if (!session) throw new Error(`Session ${sessionId} not found`);

  if (expected) {
    // Postgres keeps microseconds, a JS Date only milliseconds (and node-pg's
    // parse can round the last digit), so allow 1 ms of slack.
    const sameTime = Math.abs(Number(session.updated_at_ms) - expected.updatedAt.getTime()) <= 1;
    const sameCount = Number(session.message_count) === expected.messageCount;
    if (!sameTime || !sameCount) throw new SessionConflictError(sessionId);
  }

  const newTitle = computeTitle(session.title, messages);

  await client.query("DELETE FROM messages WHERE session_id = $1", [sessionId]);
  if (messages.length > 0) {
    // One statement for the whole history instead of one INSERT per message.
    await client.query(
      `INSERT INTO messages (session_id, ordinal, role, content)
       SELECT $1, t.ordinal, t.role, t.content
       FROM unnest($2::int[], $3::text[], $4::jsonb[]) AS t(ordinal, role, content)`,
      [
        sessionId,
        messages.map((_, i) => i),
        messages.map((m) => m.role),
        messages.map((m) => JSON.stringify(m.content)),
      ]
    );
  }
  await client.query(
    "UPDATE sessions SET updated_at = NOW(), title = $1 WHERE id = $2",
    [newTitle, sessionId]
  );
}

function computeTitle(currentTitle: string, messages: ModelMessage[]): string {
  if (currentTitle !== "New chat") return currentTitle;
  const firstUser = messages.find((m) => m.role === "user");
  if (firstUser && typeof firstUser.content === "string") {
    return firstUser.content.slice(0, 60);
  }
  return currentTitle;
}
