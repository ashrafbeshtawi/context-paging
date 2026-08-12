import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import {
  createSession,
  getSession,
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

  it("deleteSession returns false for unknown id", async () => {
    expect(await deleteSession("missing")).toBe(false);
  });
});
