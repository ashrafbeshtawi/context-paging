import { beforeEach, describe, expect, it } from "vitest";
import {
  createSession,
  deleteSession,
  getSession,
  listSessions,
  pagesRootFor,
  resetForTests,
  updateMessages,
} from "@/lib/sessions";

describe("session store", () => {
  beforeEach(() => resetForTests());

  it("creates a session with a default title", () => {
    const s = createSession();
    expect(s.id).toMatch(/^s-/);
    expect(s.title).toBe("New chat");
    expect(s.messages).toEqual([]);
  });

  it("uses the provided title when given", () => {
    const s = createSession("Debugging auth");
    expect(s.title).toBe("Debugging auth");
  });

  it("lists sessions newest-first by updatedAt", async () => {
    const a = createSession("A");
    await new Promise((r) => setTimeout(r, 2));
    const b = createSession("B");
    const list = listSessions();
    expect(list.map((s) => s.id)).toEqual([b.id, a.id]);
  });

  it("derives the title from the first user message when still default", () => {
    const s = createSession();
    updateMessages(s.id, [{ role: "user", content: "Help me debug this thing" }]);
    expect(getSession(s.id)?.title).toBe("Help me debug this thing");
  });

  it("does not overwrite a custom title", () => {
    const s = createSession("Custom");
    updateMessages(s.id, [{ role: "user", content: "anything" }]);
    expect(getSession(s.id)?.title).toBe("Custom");
  });

  it("deleteSession removes it", () => {
    const s = createSession();
    expect(deleteSession(s.id)).toBe(true);
    expect(getSession(s.id)).toBeUndefined();
  });

  it("pagesRootFor scopes per session under the base dir", () => {
    const root = pagesRootFor("abc", "/tmp/base");
    expect(root).toBe("/tmp/base/abc");
  });

  it("updateMessages returns undefined for unknown id", () => {
    expect(updateMessages("missing", [])).toBeUndefined();
  });
});
