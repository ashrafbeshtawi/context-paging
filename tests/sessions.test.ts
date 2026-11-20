import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelMessage } from "ai";
import {
  createSession,
  getSession,
  getSessionWithMessages,
  sessionVersion,
  SessionConflictError,
  getOrCreateSession,
  listSessions,
  deleteSession,
  getMessages,
  replaceMessages,
} from "../src/sessions.js";
import { closePool } from "../src/db.js";
import { resetDb } from "./helpers/db.js";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closePool();
});

describe("sessions store", () => {
  it("createSession persists with default title 'New chat'", async () => {
    const s = await createSession();
    expect(s.title).toBe("New chat");
    expect(s.id).toMatch(/^s-/);
    const fetched = await getSession(s.id);
    expect(fetched?.id).toBe(s.id);
  });

  it("custom title is preserved", async () => {
    const s = await createSession({ title: "  Hello  " });
    expect(s.title).toBe("Hello");
  });

  it("getOrCreateSession is idempotent", async () => {
    const a = await getOrCreateSession({ id: "fixed", title: "First" });
    const b = await getOrCreateSession({ id: "fixed", title: "Second (ignored)" });
    expect(a.id).toBe(b.id);
    expect(b.title).toBe("First");
  });

  it("listSessions returns sessions newest-first by updated_at, with message counts", async () => {
    const a = await createSession({ title: "A" });
    await new Promise((r) => setTimeout(r, 5));
    const b = await createSession({ title: "B" });

    await replaceMessages(b.id, [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);

    const list = await listSessions();
    expect(list[0].id).toBe(b.id);
    expect(list[0].messageCount).toBe(2);
    expect(list.find((s) => s.id === a.id)?.messageCount).toBe(0);
  });

  it("replaceMessages overwrites the entire list", async () => {
    const s = await createSession();
    await replaceMessages(s.id, [
      { role: "user", content: "one" },
      { role: "assistant", content: "two" },
    ]);
    await replaceMessages(s.id, [{ role: "user", content: "only" }]);
    const msgs = await getMessages(s.id);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe("only");
  });

  it("replaceMessages preserves complex content shapes via JSONB", async () => {
    const s = await createSession();
    const arrayContent: ModelMessage = {
      role: "assistant",
      content: [
        { type: "text", text: "hi" },
        { type: "tool-call", toolCallId: "x", toolName: "page_out", input: { title: "a" } },
      ] as ModelMessage["content"],
    };
    await replaceMessages(s.id, [arrayContent]);
    const msgs = await getMessages(s.id);
    expect(Array.isArray(msgs[0].content)).toBe(true);
  });

  it("auto-titles when the first user message arrives and title is default", async () => {
    const s = await createSession();
    expect(s.title).toBe("New chat");
    await replaceMessages(s.id, [
      { role: "user", content: "Help me debug the auth module" },
    ]);
    const fetched = await getSession(s.id);
    expect(fetched?.title).toBe("Help me debug the auth module");
  });

  it("does not overwrite a custom title with the first user message", async () => {
    const s = await createSession({ title: "Custom" });
    await replaceMessages(s.id, [{ role: "user", content: "anything" }]);
    expect((await getSession(s.id))?.title).toBe("Custom");
  });

  it("deleteSession removes the row and cascades to messages", async () => {
    const s = await createSession();
    await replaceMessages(s.id, [{ role: "user", content: "x" }]);
    expect(await deleteSession(s.id)).toBe(true);
    expect(await getSession(s.id)).toBeNull();
    expect(await getMessages(s.id)).toEqual([]);
  });

  it("replaceMessages writes a long history in order with one batch insert", async () => {
    const s = await createSession();
    const history: ModelMessage[] = Array.from({ length: 250 }, (_, i) =>
      i % 2 === 0
        ? { role: "user", content: `q${i} with "quotes", \\backslash and {braces}` }
        : { role: "assistant", content: [{ type: "text", text: `a${i}` }] as ModelMessage["content"] }
    );

    const { getPool } = await import("../src/db.js");
    const pool = getPool();
    const realConnect = pool.connect.bind(pool);
    let inserts = 0;
    const spy = vi.spyOn(pool, "connect").mockImplementation((async () => {
      const client = await realConnect();
      const realQuery = client.query.bind(client);
      client.query = ((text: unknown, ...rest: unknown[]) => {
        if (typeof text === "string" && /INSERT INTO messages/.test(text)) inserts++;
        return (realQuery as (...a: unknown[]) => unknown)(text, ...rest);
      }) as typeof client.query;
      return client;
    }) as typeof pool.connect);

    try {
      await replaceMessages(s.id, history);
    } finally {
      spy.mockRestore();
    }

    expect(inserts).toBe(1);
    const msgs = await getMessages(s.id);
    expect(msgs).toEqual(history);
  });

  it("replaceMessages with an empty array clears the history", async () => {
    const s = await createSession();
    await replaceMessages(s.id, [{ role: "user", content: "x" }]);
    await replaceMessages(s.id, []);
    expect(await getMessages(s.id)).toEqual([]);
  });

  it("replaceMessages accepts a write whose expected version is current", async () => {
    const s = await createSession();
    await replaceMessages(s.id, [{ role: "user", content: "one" }]);
    const before = await getSessionWithMessages(s.id);
    await replaceMessages(
      s.id,
      [...before!.messages, { role: "assistant", content: "two" }],
      { expected: sessionVersion(before!) }
    );
    expect(await getMessages(s.id)).toHaveLength(2);
  });

  it("replaceMessages rejects a stale write and keeps the newer history", async () => {
    const s = await createSession();
    const start = await getSessionWithMessages(s.id);
    const expected = sessionVersion(start!);

    // Turn A finishes first.
    await replaceMessages(s.id, [
      { role: "user", content: "A" },
      { role: "assistant", content: "answer A" },
    ], { expected });

    // Turn B started from the same state and finishes later.
    await expect(
      replaceMessages(s.id, [
        { role: "user", content: "B" },
        { role: "assistant", content: "answer B" },
      ], { expected })
    ).rejects.toBeInstanceOf(SessionConflictError);

    const msgs = await getMessages(s.id);
    expect(msgs.map((m) => m.content)).toEqual(["A", "answer A"]);
  });

  it("replaceMessages throws for an unknown session", async () => {
    await expect(replaceMessages("missing", [])).rejects.toThrow(/not found/);
  });

  it("deleteSession returns false for unknown id", async () => {
    expect(await deleteSession("missing")).toBe(false);
  });
});
