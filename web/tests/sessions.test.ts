import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createSession,
  deleteSession,
  getSession,
  getOrCreateSession,
  listSessions,
  replaceMessages,
  getMessages,
} from "@/lib/sessions";
import { closePool } from "@agent/db";
import { resetDb } from "../../tests/helpers/db";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closePool();
});

describe("session store (DB-backed, accessed from web)", () => {
  it("createSession uses default title", async () => {
    const s = await createSession();
    expect(s.title).toBe("New chat");
    expect(s.id).toMatch(/^s-/);
  });

  it("createSession respects a provided title", async () => {
    const s = await createSession({ title: "Debugging auth" });
    expect(s.title).toBe("Debugging auth");
  });

  it("listSessions returns newest-first by updated_at", async () => {
    const a = await createSession({ title: "A" });
    await new Promise((r) => setTimeout(r, 5));
    const b = await createSession({ title: "B" });
    const list = await listSessions();
    expect(list[0].id).toBe(b.id);
    expect(list[1].id).toBe(a.id);
  });

  it("derives the title from the first user message when still default", async () => {
    const s = await createSession();
    await replaceMessages(s.id, [{ role: "user", content: "Help me debug this" }]);
    expect((await getSession(s.id))?.title).toBe("Help me debug this");
  });

  it("does not overwrite a custom title", async () => {
    const s = await createSession({ title: "Custom" });
    await replaceMessages(s.id, [{ role: "user", content: "anything" }]);
    expect((await getSession(s.id))?.title).toBe("Custom");
  });

  it("deleteSession removes the row and its messages", async () => {
    const s = await createSession();
    await replaceMessages(s.id, [{ role: "user", content: "x" }]);
    expect(await deleteSession(s.id)).toBe(true);
    expect(await getMessages(s.id)).toEqual([]);
  });

  it("getOrCreateSession does not duplicate", async () => {
    const a = await getOrCreateSession({ id: "fixed-id", title: "First" });
    const b = await getOrCreateSession({ id: "fixed-id", title: "Second" });
    expect(a.id).toBe(b.id);
    expect(b.title).toBe("First");
  });
});
