import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import {
  handlePageOut,
  handlePageTable,
  handlePageIn,
  handlePageUpdate,
  handlePageFree,
  handlePageMove,
  handlePageMerge,
  swapOut,
  swapIn,
} from "../src/context-manager.js";
import { withSession, getPageByNo, getChildren } from "../src/storage.js";
import { closePool } from "../src/db.js";
import { resetDb, makeTestSession } from "./helpers/db.js";

let sid: string;

beforeEach(async () => {
  await resetDb();
  sid = await makeTestSession();
});

afterAll(async () => {
  await closePool();
});

// --- Page operations ---

describe("handlePageOut", () => {
  it("creates a page and returns confirmation", async () => {
    await withSession(sid, async () => {
      const result = await handlePageOut({
        title: "Auth Debug",
        content: "Found the bug in token validation",
        summary: "Token validation fix",
      });
      expect(result).toContain("Paged out");
      expect(result).toContain("Page 1");
      expect(result).toContain("Auth Debug");
    });
  });

  it("stores content in the DB", async () => {
    await withSession(sid, async () => {
      await handlePageOut({
        title: "Test",
        content: "My content",
        summary: "Summary",
      });
      const row = await getPageByNo(1);
      expect(row?.content).toBe("My content");
      expect(row?.title).toBe("Test");
      expect(row?.summary).toBe("Summary");
    });
  });

  it("assigns sequential page numbers within a session", async () => {
    await withSession(sid, async () => {
      const r1 = await handlePageOut({ title: "First", content: "", summary: "" });
      const r2 = await handlePageOut({ title: "Second", content: "", summary: "" });
      expect(r1).toContain("Page 1");
      expect(r2).toContain("Page 2");
    });
  });

  it("nests pages under parent_id", async () => {
    await withSession(sid, async () => {
      await handlePageOut({ title: "Parent", content: "", summary: "" });
      const result = await handlePageOut({
        title: "Child",
        content: "",
        summary: "",
        parent_id: 1,
      });
      expect(result).toContain("under page 1");
      const child = await getPageByNo(2);
      const parent = await getPageByNo(1);
      expect(child?.parent_id).toBe(parent?.id);
    });
  });

  it("defaults is_resident to false", async () => {
    await withSession(sid, async () => {
      await handlePageOut({ title: "X", content: "", summary: "" });
      const row = await getPageByNo(1);
      expect(row?.is_resident).toBe(false);
    });
  });
});

describe("handlePageTable", () => {
  it("returns empty-string message when no pages exist", async () => {
    await withSession(sid, async () => {
      const result = await handlePageTable({});
      expect(result).toContain("empty");
    });
  });

  it("lists existing pages", async () => {
    await withSession(sid, async () => {
      await handlePageOut({ title: "A", content: "", summary: "" });
      await handlePageOut({ title: "B", content: "", summary: "" });
      const result = await handlePageTable({});
      expect(result).toContain('Page 1: "A"');
      expect(result).toContain('Page 2: "B"');
    });
  });

  it("scopes to a parent page when parent_id is given", async () => {
    await withSession(sid, async () => {
      await handlePageOut({ title: "Parent", content: "", summary: "" });
      await handlePageOut({ title: "Child", content: "", summary: "", parent_id: 1 });
      await handlePageOut({ title: "Sibling", content: "", summary: "" });
      const result = await handlePageTable({ parent_id: 1 });
      expect(result).toContain("Child");
      expect(result).not.toContain("Sibling");
    });
  });

  it("reports missing parent", async () => {
    await withSession(sid, async () => {
      const result = await handlePageTable({ parent_id: 99 });
      expect(result).toContain("not found");
    });
  });
});

describe("handlePageIn", () => {
  it("returns the full page content with header", async () => {
    await withSession(sid, async () => {
      await handlePageOut({
        title: "Notes",
        content: "Body of notes",
        summary: "Some notes",
      });
      const result = await handlePageIn({ id: 1 });
      expect(result).toContain("# Page 1: Notes");
      expect(result).toContain("Body of notes");
      expect(result).toContain("Some notes");
    });
  });

  it("flips is_resident to true", async () => {
    await withSession(sid, async () => {
      await handlePageOut({ title: "X", content: "", summary: "" });
      await handlePageIn({ id: 1 });
      const row = await getPageByNo(1);
      expect(row?.is_resident).toBe(true);
    });
  });

  it("returns 'not found' for unknown page", async () => {
    await withSession(sid, async () => {
      const result = await handlePageIn({ id: 99 });
      expect(result).toContain("not found");
    });
  });
});

describe("handlePageUpdate", () => {
  it("updates title and summary", async () => {
    await withSession(sid, async () => {
      await handlePageOut({ title: "Old", content: "", summary: "old" });
      await handlePageUpdate({ id: 1, title: "New", summary: "new" });
      const row = await getPageByNo(1);
      expect(row?.title).toBe("New");
      expect(row?.summary).toBe("new");
    });
  });

  it("toggles is_resident", async () => {
    await withSession(sid, async () => {
      await handlePageOut({ title: "X", content: "", summary: "" });
      await handlePageUpdate({ id: 1, is_resident: true });
      expect((await getPageByNo(1))?.is_resident).toBe(true);
      await handlePageUpdate({ id: 1, is_resident: false });
      expect((await getPageByNo(1))?.is_resident).toBe(false);
    });
  });

  it("reports missing page", async () => {
    await withSession(sid, async () => {
      const result = await handlePageUpdate({ id: 99, title: "Nope" });
      expect(result).toContain("not found");
    });
  });
});

describe("handlePageFree", () => {
  it("deletes a leaf page", async () => {
    await withSession(sid, async () => {
      await handlePageOut({ title: "X", content: "", summary: "" });
      const result = await handlePageFree({ id: 1 });
      expect(result).toContain("Freed");
      expect(await getPageByNo(1)).toBeNull();
    });
  });

  it("with recursive=true cascades children", async () => {
    await withSession(sid, async () => {
      await handlePageOut({ title: "P", content: "", summary: "" });
      await handlePageOut({ title: "C", content: "", summary: "", parent_id: 1 });
      await handlePageFree({ id: 1, recursive: true });
      expect(await getPageByNo(1)).toBeNull();
      expect(await getPageByNo(2)).toBeNull();
    });
  });

  it("with recursive=false refuses when children exist", async () => {
    await withSession(sid, async () => {
      await handlePageOut({ title: "P", content: "", summary: "" });
      await handlePageOut({ title: "C", content: "", summary: "", parent_id: 1 });
      const result = await handlePageFree({ id: 1, recursive: false });
      expect(result).toContain("children");
      expect(await getPageByNo(1)).not.toBeNull();
    });
  });
});

describe("handlePageMove", () => {
  it("moves a page under a new parent", async () => {
    await withSession(sid, async () => {
      await handlePageOut({ title: "A", content: "", summary: "" });
      await handlePageOut({ title: "B", content: "", summary: "" });
      await handlePageMove({ id: 2, new_parent_id: 1 });
      const child = await getPageByNo(2);
      const parent = await getPageByNo(1);
      expect(child?.parent_id).toBe(parent?.id);
    });
  });

  it("moves a page to root with no new_parent_id", async () => {
    await withSession(sid, async () => {
      await handlePageOut({ title: "P", content: "", summary: "" });
      await handlePageOut({ title: "C", content: "", summary: "", parent_id: 1 });
      await handlePageMove({ id: 2 });
      expect((await getPageByNo(2))?.parent_id).toBeNull();
    });
  });

  it("rejects circular nesting", async () => {
    await withSession(sid, async () => {
      await handlePageOut({ title: "A", content: "", summary: "" });
      await handlePageOut({ title: "B", content: "", summary: "", parent_id: 1 });
      const result = await handlePageMove({ id: 1, new_parent_id: 2 });
      expect(result).toContain("circular");
    });
  });

  it("rejects moving a page under itself", async () => {
    await withSession(sid, async () => {
      await handlePageOut({ title: "X", content: "", summary: "" });
      const result = await handlePageMove({ id: 1, new_parent_id: 1 });
      expect(result).toContain("itself");
    });
  });
});

describe("handlePageMerge", () => {
  it("concatenates source pages into the target", async () => {
    await withSession(sid, async () => {
      await handlePageOut({ title: "T", content: "target body", summary: "" });
      await handlePageOut({ title: "S1", content: "s1 body", summary: "" });
      await handlePageOut({ title: "S2", content: "s2 body", summary: "" });
      const result = await handlePageMerge({ source_ids: [2, 3], target_id: 1 });
      expect(result).toContain("Merged pages");

      const target = await getPageByNo(1);
      expect(target?.content).toContain("target body");
      expect(target?.content).toContain("s1 body");
      expect(target?.content).toContain("s2 body");

      // Sources freed (we deleted by their DB id, so getPageByNo for their
      // old page_no's should also return null).
      expect(await getPageByNo(2)).toBeNull();
      expect(await getPageByNo(3)).toBeNull();
    });
  });

  it("uses provided strategy when given", async () => {
    await withSession(sid, async () => {
      await handlePageOut({ title: "T", content: "old", summary: "" });
      await handlePageOut({ title: "S", content: "src", summary: "" });
      await handlePageMerge({
        source_ids: [2],
        target_id: 1,
        strategy: "provided",
        merged_content: "explicit body",
        merged_summary: "merged summary",
      });
      const target = await getPageByNo(1);
      expect(target?.content).toBe("explicit body");
      expect(target?.summary).toBe("merged summary");
    });
  });

  it("errors when no sources are given", async () => {
    await withSession(sid, async () => {
      await handlePageOut({ title: "T", content: "", summary: "" });
      const result = await handlePageMerge({ source_ids: [1], target_id: 1 });
      expect(result).toContain("No source");
    });
  });

  it("errors when target is missing", async () => {
    await withSession(sid, async () => {
      const result = await handlePageMerge({ source_ids: [1], target_id: 99 });
      expect(result).toContain("Target page");
    });
  });

  it("errors when 'provided' strategy is missing merged_content", async () => {
    await withSession(sid, async () => {
      await handlePageOut({ title: "T", content: "", summary: "" });
      await handlePageOut({ title: "S", content: "", summary: "" });
      const result = await handlePageMerge({
        source_ids: [2],
        target_id: 1,
        strategy: "provided",
      });
      expect(result).toContain("merged_content");
    });
  });
});

describe("swapOut", () => {
  it("removes the last N messages and replaces them with one reference", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
      { role: "user", content: "more" },
      { role: "assistant", content: "ok" },
    ];
    const result = swapOut(messages, 7, "Auth notes", "some notes", 2);
    expect(result).toHaveLength(3);
    expect(result[2].role).toBe("assistant");
    expect(result[2].content).toContain('[Paged out → Page 7: "Auth notes" — some notes]');
  });

  it("returns unchanged messages when swapCount is 0 or undefined", () => {
    const messages: ModelMessage[] = [{ role: "user", content: "x" }];
    expect(swapOut(messages, 1, "X", "", 0)).toEqual(messages);
    expect(swapOut(messages, 1, "X", "")).toEqual(messages);
  });

  it("clamps to the array length when swapCount > messages.length", () => {
    const messages: ModelMessage[] = [{ role: "user", content: "x" }];
    const result = swapOut(messages, 1, "X", "", 99);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("assistant");
    expect(result[0].content).toContain("Paged out");
  });
});

describe("swapIn", () => {
  it("appends a paged-in reference with the content", () => {
    const messages: ModelMessage[] = [{ role: "user", content: "hi" }];
    const result = swapIn(messages, 5, "Title", "Body");
    expect(result).toHaveLength(2);
    expect(result[1].content).toContain("[Paged in ← Page 5");
    expect(result[1].content).toContain("Body");
    expect(result[1].content).toContain("[End of Page 5]");
  });
});

describe("integration: storage scoped by session_id", () => {
  it("pages created in one session are invisible to another", async () => {
    const sid2 = await makeTestSession("session-two");
    await withSession(sid, () => handlePageOut({ title: "A", content: "", summary: "" }));
    const result = await withSession(sid2, () => handlePageTable({}));
    expect(result).toContain("empty");
  });

  it("page_in within session 1 returns nothing for the same page_no in session 2", async () => {
    const sid2 = await makeTestSession("session-two");
    await withSession(sid, () => handlePageOut({ title: "A", content: "x", summary: "" }));
    await withSession(sid2, () => handlePageOut({ title: "B", content: "y", summary: "" }));
    const fromA = await withSession(sid, () => handlePageIn({ id: 1 }));
    const fromB = await withSession(sid2, () => handlePageIn({ id: 1 }));
    expect(fromA).toContain("x");
    expect(fromB).toContain("y");
  });
});
