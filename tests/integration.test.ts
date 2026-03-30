import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  ensureRoot,
  findPageDir,
  readMeta,
  readContent,
  buildTree,
} from "../src/storage.js";
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
import { formatPageTable } from "../src/toc.js";
import type { PageMeta } from "../src/types.js";
import type { ModelMessage } from "ai";

const TEST_ROOT = path.join(os.tmpdir(), "context-paging-test-integration");
process.env.PAGES_ROOT = TEST_ROOT;

beforeEach(async () => {
  await fs.rm(TEST_ROOT, { recursive: true, force: true });
  await ensureRoot();
});

afterEach(async () => {
  await fs.rm(TEST_ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. Full page lifecycle
// ---------------------------------------------------------------------------
describe("Full page lifecycle", () => {
  it("creates, reads, updates, and deletes a page", async () => {
    // Create
    const createResult = await handlePageOut({
      title: "Lifecycle Page",
      content: "Initial content for lifecycle test.",
      summary: "A lifecycle test page",
    });
    expect(createResult).toContain("Page 1");
    expect(createResult).toContain("Lifecycle Page");

    const dir = await findPageDir(1);
    expect(dir).not.toBeNull();
    const metaOnDisk = await readMeta(dir!);
    expect(metaOnDisk.title).toBe("Lifecycle Page");
    expect(metaOnDisk.is_resident).toBe(false);

    // Read (page in)
    const readResult = await handlePageIn({ id: 1 });
    expect(readResult).toContain("Lifecycle Page");
    expect(readResult).toContain("Initial content for lifecycle test.");

    const metaAfterIn = await readMeta(dir!);
    expect(metaAfterIn.is_resident).toBe(true);

    // Update
    const updateResult = await handlePageUpdate({
      id: 1,
      title: "Updated Lifecycle Page",
      content: "Updated content.",
    });
    expect(updateResult).toContain("title");
    expect(updateResult).toContain("content");

    const metaAfterUpdate = await readMeta(dir!);
    expect(metaAfterUpdate.title).toBe("Updated Lifecycle Page");
    const contentAfterUpdate = await readContent(dir!);
    expect(contentAfterUpdate).toBe("Updated content.");

    // Delete
    const deleteResult = await handlePageFree({ id: 1 });
    expect(deleteResult).toContain("Freed page 1");
    const dirAfterDelete = await findPageDir(1);
    expect(dirAfterDelete).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Nested page hierarchy
// ---------------------------------------------------------------------------
describe("Nested page hierarchy", () => {
  it("creates a hierarchy, verifies tree, moves, and deletes recursively", async () => {
    // Create parent (ID 1)
    await handlePageOut({ title: "Parent", content: "Parent content", summary: "The parent" });
    // Create child 1 (ID 2) under parent
    await handlePageOut({ title: "Child A", content: "Child A content", summary: "First child", parent_id: 1 });
    // Create child 2 (ID 3) under parent
    await handlePageOut({ title: "Child B", content: "Child B content", summary: "Second child", parent_id: 1 });
    // Create grandchild (ID 4) under child A
    await handlePageOut({ title: "Grandchild", content: "Grandchild content", summary: "A grandchild", parent_id: 2 });

    // Verify tree structure
    const tree = await buildTree();
    expect(tree).toHaveLength(1); // only parent at root
    expect(tree[0].meta.title).toBe("Parent");
    expect(tree[0].children).toHaveLength(2); // Child A, Child B

    const childA = tree[0].children.find((c) => c.meta.title === "Child A");
    expect(childA).toBeDefined();
    expect(childA!.children).toHaveLength(1);
    expect(childA!.children[0].meta.title).toBe("Grandchild");

    // Verify formatPageTable indentation
    const tableOutput = formatPageTable(tree);
    expect(tableOutput).toContain('Page 1: "Parent"');
    expect(tableOutput).toContain('  Page 2: "Child A"'); // indented once
    expect(tableOutput).toContain('    Page 4: "Grandchild"'); // indented twice

    // Move grandchild to root
    const moveResult = await handlePageMove({ id: 4 });
    expect(moveResult).toContain("to root");

    // Verify tree restructured
    const treeAfterMove = await buildTree();
    expect(treeAfterMove).toHaveLength(2); // Parent + Grandchild at root
    const grandchildAtRoot = treeAfterMove.find((n) => n.meta.title === "Grandchild");
    expect(grandchildAtRoot).toBeDefined();

    // Verify child A no longer has grandchild
    const parentNode = treeAfterMove.find((n) => n.meta.title === "Parent")!;
    const childAAfterMove = parentNode.children.find((c) => c.meta.title === "Child A");
    expect(childAAfterMove!.children).toHaveLength(0);

    // Delete parent recursively — should delete parent, Child A, Child B
    const deleteResult = await handlePageFree({ id: 1, recursive: true });
    expect(deleteResult).toContain("Freed page 1");

    // Verify parent and children are gone
    expect(await findPageDir(1)).toBeNull();
    expect(await findPageDir(2)).toBeNull();
    expect(await findPageDir(3)).toBeNull();

    // Grandchild (moved to root) survives
    expect(await findPageDir(4)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Merge workflow
// ---------------------------------------------------------------------------
describe("Merge workflow", () => {
  it("merges multiple pages into one with concatenate strategy", async () => {
    // Create 3 pages with distinct content
    await handlePageOut({ title: "Base", content: "Base content here.", summary: "Base page" });
    await handlePageOut({ title: "Extra A", content: "Extra A content.", summary: "Extra A" });
    await handlePageOut({ title: "Extra B", content: "Extra B content.", summary: "Extra B" });

    // Merge pages 2 and 3 into page 1
    const mergeResult = await handlePageMerge({
      source_ids: [2, 3],
      target_id: 1,
      strategy: "concatenate",
      merged_summary: "All merged together",
    });
    expect(mergeResult).toContain("Merged pages [2, 3] into page 1");
    expect(mergeResult).toContain("Sources freed");

    // Verify merged content contains all three pieces
    const targetDir = await findPageDir(1);
    expect(targetDir).not.toBeNull();
    const mergedContent = await readContent(targetDir!);
    expect(mergedContent).toContain("Base content here.");
    expect(mergedContent).toContain("Extra A content.");
    expect(mergedContent).toContain("Extra B content.");

    // Verify merged summary updated
    const mergedMeta = await readMeta(targetDir!);
    expect(mergedMeta.summary).toBe("All merged together");

    // Verify source pages (2, 3) are deleted
    expect(await findPageDir(2)).toBeNull();
    expect(await findPageDir(3)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Context swap round-trip
// ---------------------------------------------------------------------------
describe("Context swap round-trip", () => {
  it("swaps out messages and swaps them back in", async () => {
    // Build a message array with 6 messages (3 user + 3 assistant alternating)
    const messages: ModelMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
      { role: "user", content: "Tell me about cats" },
      { role: "assistant", content: "Cats are wonderful." },
      { role: "user", content: "What about dogs?" },
      { role: "assistant", content: "Dogs are great too." },
    ];

    // Create a page to hold the swapped content
    await handlePageOut({
      title: "Conversation Chunk",
      content: "Cats are wonderful.\nWhat about dogs?\nDogs are great too.",
      summary: "Discussion about pets",
    });

    // swapOut with swapCount=4 — removes last 4 messages, adds reference
    const afterSwap = swapOut(messages, 1, "Conversation Chunk", "Discussion about pets", 4);

    // Only 2 original messages remain + 1 reference = 3 total
    expect(afterSwap).toHaveLength(3);
    expect(afterSwap[0]).toEqual({ role: "user", content: "Hello" });
    expect(afterSwap[1]).toEqual({ role: "assistant", content: "Hi there!" });

    // The reference message
    const refMsg = afterSwap[2];
    expect(refMsg.role).toBe("assistant");
    expect((refMsg as { content: string }).content).toContain("Conversation Chunk");
    expect((refMsg as { content: string }).content).toContain("Discussion about pets");

    // swapIn — inject page content as assistant message
    const afterSwapIn = swapIn(
      afterSwap,
      1,
      "Conversation Chunk",
      "Cats are wonderful.\nWhat about dogs?\nDogs are great too."
    );

    // Should have one more message at end
    expect(afterSwapIn).toHaveLength(4);
    const injected = afterSwapIn[3];
    expect(injected.role).toBe("assistant");
    expect((injected as { content: string }).content).toContain("Cats are wonderful.");
    expect((injected as { content: string }).content).toContain("Dogs are great too.");

    // Original 2 messages still intact
    expect(afterSwapIn[0]).toEqual({ role: "user", content: "Hello" });
    expect(afterSwapIn[1]).toEqual({ role: "assistant", content: "Hi there!" });
  });
});

// ---------------------------------------------------------------------------
// 5. Page table injection
// ---------------------------------------------------------------------------
describe("Page table injection", () => {
  it("lists all pages with correct status labels", async () => {
    // Create several pages
    await handlePageOut({ title: "Page Alpha", content: "Alpha", summary: "First" });
    await handlePageOut({ title: "Page Beta", content: "Beta", summary: "Second" });
    await handlePageOut({ title: "Page Gamma", content: "Gamma", summary: "Third" });

    // Page in one page to make it resident
    await handlePageIn({ id: 2 });

    const tableOutput = await handlePageTable({});

    // All page IDs and titles present
    expect(tableOutput).toContain('Page 1: "Page Alpha"');
    expect(tableOutput).toContain('Page 2: "Page Beta"');
    expect(tableOutput).toContain('Page 3: "Page Gamma"');

    // Status labels: page 2 is resident, others swapped
    expect(tableOutput).toContain("Page 1");
    expect(tableOutput).toContain("[swapped]");
    expect(tableOutput).toContain("[resident]");

    // Specifically check page 2 is resident and 1/3 are swapped
    const lines = tableOutput.split("\n");
    const line1 = lines.find((l) => l.includes("Page 1:"));
    const line2 = lines.find((l) => l.includes("Page 2:"));
    const line3 = lines.find((l) => l.includes("Page 3:"));
    expect(line1).toContain("[swapped]");
    expect(line2).toContain("[resident]");
    expect(line3).toContain("[swapped]");
  });
});

// ---------------------------------------------------------------------------
// 6. Counter persistence across operations
// ---------------------------------------------------------------------------
describe("Counter persistence across operations", () => {
  it("never reuses IDs after deletion", async () => {
    // Create 3 pages (IDs 1, 2, 3)
    await handlePageOut({ title: "First", content: "1" });
    await handlePageOut({ title: "Second", content: "2" });
    await handlePageOut({ title: "Third", content: "3" });

    expect(await findPageDir(1)).not.toBeNull();
    expect(await findPageDir(2)).not.toBeNull();
    expect(await findPageDir(3)).not.toBeNull();

    // Delete page 2
    await handlePageFree({ id: 2 });
    expect(await findPageDir(2)).toBeNull();

    // Create another page — should get ID 4, not 2
    const result = await handlePageOut({ title: "Fourth", content: "4" });
    expect(result).toContain("Page 4");

    expect(await findPageDir(4)).not.toBeNull();
    // ID 2 is still gone
    expect(await findPageDir(2)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. Error handling across modules
// ---------------------------------------------------------------------------
describe("Error handling across modules", () => {
  it("returns error when creating child under non-existent parent", async () => {
    try {
      await handlePageOut({
        title: "Orphan",
        content: "No parent",
        parent_id: 999,
      });
      // If it doesn't throw, fail
      expect.unreachable("Should have thrown");
    } catch (err: any) {
      expect(err.message).toContain("Parent page 999 not found");
    }
  });

  it("returns error when moving page under its own descendant", async () => {
    // Create parent and child
    await handlePageOut({ title: "Parent", content: "P" });
    await handlePageOut({ title: "Child", content: "C", parent_id: 1 });

    // Try to move parent under child (circular)
    const result = await handlePageMove({ id: 1, new_parent_id: 2 });
    expect(result).toContain("circular");
  });

  it("returns error when merging with non-existent target", async () => {
    await handlePageOut({ title: "Source", content: "S" });

    const result = await handlePageMerge({
      source_ids: [1],
      target_id: 999,
    });
    expect(result).toContain("Target page 999 not found");
  });

  it("returns error when merging with non-existent source", async () => {
    await handlePageOut({ title: "Target", content: "T" });

    const result = await handlePageMerge({
      source_ids: [999],
      target_id: 1,
    });
    expect(result).toContain("Source page 999 not found");
  });

  it("returns error when paging in non-existent page", async () => {
    const result = await handlePageIn({ id: 999 });
    expect(result).toContain("Page 999 not found");
  });
});
