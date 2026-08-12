import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import {
  handlePageOut,
  handlePageIn,
  handlePageUpdate,
  handlePageFree,
  handlePageMove,
  handlePageMerge,
  handlePageTable,
  swapOut,
  swapIn,
} from "../src/context-manager.js";
import { withSession, getPageByNo, buildTree } from "../src/storage.js";
import { closePool } from "../src/db.js";
import { formatPageTable } from "../src/toc.js";
import { resetDb, makeTestSession } from "./helpers/db.js";

let sid: string;

beforeEach(async () => {
  await resetDb();
  sid = await makeTestSession();
});

afterAll(async () => {
  await closePool();
});

describe("Full page lifecycle", () => {
  it("creates, reads, updates, and deletes a page", async () => {
    await withSession(sid, async () => {
      const createResult = await handlePageOut({
        title: "Lifecycle Page",
        content: "Initial content for lifecycle test.",
        summary: "A lifecycle test page",
      });
      expect(createResult).toContain("Page 1");

      let row = await getPageByNo(1);
      expect(row?.title).toBe("Lifecycle Page");
      expect(row?.is_resident).toBe(false);

      const readResult = await handlePageIn({ id: 1 });
      expect(readResult).toContain("Initial content");
      row = await getPageByNo(1);
      expect(row?.is_resident).toBe(true);

      await handlePageUpdate({ id: 1, title: "Renamed", content: "fresh body" });
      row = await getPageByNo(1);
      expect(row?.title).toBe("Renamed");
      expect(row?.content).toBe("fresh body");

      const freed = await handlePageFree({ id: 1 });
      expect(freed).toContain("Freed");
      expect(await getPageByNo(1)).toBeNull();
    });
  });
});

describe("Nested hierarchy + move + merge", () => {
  it("builds a tree, reorganizes, and merges siblings", async () => {
    await withSession(sid, async () => {
      // Create three top-level pages; nest A1 + A2 under page 1.
      await handlePageOut({ title: "A", content: "a body", summary: "first" });
      await handlePageOut({ title: "B", content: "b body", summary: "second" });
      await handlePageOut({ title: "A1", content: "a1 body", summary: "sub-1", parent_id: 1 });
      await handlePageOut({ title: "A2", content: "a2 body", summary: "sub-2", parent_id: 1 });

      // Verify the tree shape.
      const tree = await buildTree();
      expect(tree.map((n) => n.row.title)).toEqual(["A", "B"]);
      expect(tree[0].children.map((c) => c.row.title)).toEqual(["A1", "A2"]);

      // Move A2 to root.
      await handlePageMove({ id: 4 });
      const treeAfter = await buildTree();
      expect(treeAfter.map((n) => n.row.title).sort()).toEqual(["A", "A2", "B"]);

      // Merge A1 into A; the children of A should now be empty and A1 freed.
      await handlePageMerge({ source_ids: [3], target_id: 1, strategy: "concatenate" });
      const a = await getPageByNo(1);
      expect(a?.content).toContain("a body");
      expect(a?.content).toContain("a1 body");
      expect(await getPageByNo(3)).toBeNull();
    });
  });

  it("rejects circular moves and reports them clearly", async () => {
    await withSession(sid, async () => {
      await handlePageOut({ title: "P", content: "", summary: "" });
      await handlePageOut({ title: "C", content: "", summary: "", parent_id: 1 });
      const result = await handlePageMove({ id: 1, new_parent_id: 2 });
      expect(result).toContain("circular");
    });
  });
});

describe("Live page-table reflection", () => {
  it("handlePageTable output matches formatPageTable on the tree", async () => {
    await withSession(sid, async () => {
      await handlePageOut({ title: "Root", content: "", summary: "r" });
      await handlePageOut({ title: "Leaf", content: "", summary: "l", parent_id: 1 });

      const fromHandler = await handlePageTable({});
      const tree = await buildTree();
      const fromFormatter = formatPageTable(tree);
      expect(fromHandler).toBe(fromFormatter);
      expect(fromHandler).toContain("Root");
      expect(fromHandler).toContain("Leaf");
    });
  });

  it("page_in marks the page resident, which the table reflects", async () => {
    await withSession(sid, async () => {
      await handlePageOut({ title: "X", content: "body", summary: "s" });
      const before = await handlePageTable({});
      expect(before).toContain("[swapped]");

      await handlePageIn({ id: 1 });
      const after = await handlePageTable({});
      expect(after).toContain("[resident]");
    });
  });
});

describe("Context paging on the message array", () => {
  it("swapOut + page_out paired with swapIn round-trips content", async () => {
    await withSession(sid, async () => {
      const messages: ModelMessage[] = [
        { role: "user", content: "first" },
        { role: "assistant", content: "hello" },
        { role: "user", content: "more" },
        { role: "assistant", content: "stuff" },
      ];

      await handlePageOut({ title: "Saved", content: "saved body", summary: "summary" });
      const afterSwapOut = swapOut(messages, 1, "Saved", "summary", 3);
      expect(afterSwapOut).toHaveLength(2);
      expect(afterSwapOut[1].content).toContain("[Paged out");

      const pageIn = await handlePageIn({ id: 1 });
      const restored = swapIn(afterSwapOut, 1, "Saved", "saved body");
      expect(restored).toHaveLength(3);
      expect(restored[2].content).toContain("saved body");
      void pageIn;
    });
  });
});

describe("Cross-session isolation", () => {
  it("two sessions both start at page 1 and never see each other", async () => {
    const sid2 = await makeTestSession("integration-other");

    await withSession(sid, async () => {
      await handlePageOut({ title: "from A", content: "a", summary: "" });
      await handlePageOut({ title: "also A", content: "a2", summary: "" });
    });
    await withSession(sid2, async () => {
      await handlePageOut({ title: "from B", content: "b", summary: "" });
    });

    const tableA = await withSession(sid, () => handlePageTable({}));
    const tableB = await withSession(sid2, () => handlePageTable({}));

    expect(tableA).toContain("from A");
    expect(tableA).not.toContain("from B");
    expect(tableB).toContain("from B");
    expect(tableB).not.toContain("from A");
  });
});
