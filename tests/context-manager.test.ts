import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
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
import { ensureRoot, findPageDir, readMeta, readContent } from "../src/storage.js";

const TEST_ROOT = path.join(os.tmpdir(), "context-paging-test-context-manager");
process.env.PAGES_ROOT = TEST_ROOT;

beforeEach(async () => {
  await fs.rm(TEST_ROOT, { recursive: true, force: true });
  await ensureRoot();
});

afterEach(async () => {
  await fs.rm(TEST_ROOT, { recursive: true, force: true });
});

// --- Page operations ---

describe("handlePageOut", () => {
  it("creates a page and returns confirmation", async () => {
    const result = await handlePageOut({
      title: "Auth Debug",
      content: "Found the bug in token validation",
      summary: "Token validation fix",
    });
    expect(result).toContain("Paged out");
    expect(result).toContain("Page 1");
    expect(result).toContain("Auth Debug");
  });

  it("stores content on disk", async () => {
    await handlePageOut({
      title: "Test",
      content: "My content",
      summary: "Summary",
    });
    const dir = await findPageDir(1);
    expect(dir).not.toBeNull();
    const content = await readContent(dir!);
    expect(content).toBe("My content");
  });

  it("creates nested pages", async () => {
    await handlePageOut({ title: "Parent", content: "P", summary: "P" });
    const result = await handlePageOut({
      title: "Child",
      content: "C",
      summary: "C",
      parent_id: 1,
    });
    expect(result).toContain("under page 1");
  });

  it("sets is_resident to false", async () => {
    await handlePageOut({ title: "Test", content: "C", summary: "S" });
    const dir = await findPageDir(1);
    const meta = await readMeta(dir!);
    expect(meta.is_resident).toBe(false);
  });
});

describe("handlePageTable", () => {
  it("returns empty message when no pages", async () => {
    const result = await handlePageTable({});
    expect(result).toContain("empty");
  });

  it("lists all pages", async () => {
    await handlePageOut({ title: "First", content: "A", summary: "S1" });
    await handlePageOut({ title: "Second", content: "B", summary: "S2" });
    const result = await handlePageTable({});
    expect(result).toContain("Page 1");
    expect(result).toContain("Page 2");
    expect(result).toContain("First");
    expect(result).toContain("Second");
  });

  it("filters by parent_id", async () => {
    await handlePageOut({ title: "Parent", content: "P", summary: "P" });
    await handlePageOut({ title: "Child", content: "C", summary: "C", parent_id: 1 });
    await handlePageOut({ title: "Other", content: "O", summary: "O" });

    const result = await handlePageTable({ parent_id: 1 });
    expect(result).toContain("Child");
    expect(result).not.toContain("Other");
  });

  it("returns error for non-existent parent", async () => {
    const result = await handlePageTable({ parent_id: 999 });
    expect(result).toContain("not found");
  });
});

describe("handlePageIn", () => {
  it("returns page content with header", async () => {
    await handlePageOut({ title: "My Page", content: "The content", summary: "Sum" });
    const result = await handlePageIn({ id: 1 });
    expect(result).toContain("# Page 1: My Page");
    expect(result).toContain("The content");
    expect(result).toContain("Sum");
  });

  it("marks page as resident", async () => {
    await handlePageOut({ title: "Test", content: "C", summary: "S" });
    await handlePageIn({ id: 1 });
    const dir = await findPageDir(1);
    const meta = await readMeta(dir!);
    expect(meta.is_resident).toBe(true);
  });

  it("returns error for non-existent page", async () => {
    const result = await handlePageIn({ id: 999 });
    expect(result).toContain("not found");
  });
});

describe("handlePageUpdate", () => {
  it("updates title", async () => {
    await handlePageOut({ title: "Old", content: "C", summary: "S" });
    const result = await handlePageUpdate({ id: 1, title: "New" });
    expect(result).toContain("title");

    const dir = await findPageDir(1);
    const meta = await readMeta(dir!);
    expect(meta.title).toBe("New");
  });

  it("updates summary", async () => {
    await handlePageOut({ title: "T", content: "C", summary: "Old" });
    await handlePageUpdate({ id: 1, summary: "New summary" });

    const dir = await findPageDir(1);
    const meta = await readMeta(dir!);
    expect(meta.summary).toBe("New summary");
  });

  it("updates content", async () => {
    await handlePageOut({ title: "T", content: "Old content", summary: "S" });
    await handlePageUpdate({ id: 1, content: "New content" });

    const dir = await findPageDir(1);
    const content = await readContent(dir!);
    expect(content).toBe("New content");
  });

  it("updates resident status", async () => {
    await handlePageOut({ title: "T", content: "C", summary: "S" });
    const result = await handlePageUpdate({ id: 1, is_resident: true });
    expect(result).toContain("paged in");

    const dir = await findPageDir(1);
    const meta = await readMeta(dir!);
    expect(meta.is_resident).toBe(true);
  });

  it("updates multiple fields at once", async () => {
    await handlePageOut({ title: "T", content: "C", summary: "S" });
    const result = await handlePageUpdate({ id: 1, title: "New", summary: "New S" });
    expect(result).toContain("title");
    expect(result).toContain("summary");
  });

  it("returns error for non-existent page", async () => {
    const result = await handlePageUpdate({ id: 999, title: "X" });
    expect(result).toContain("not found");
  });
});

describe("handlePageFree", () => {
  it("deletes a page", async () => {
    await handlePageOut({ title: "Doomed", content: "C", summary: "S" });
    const result = await handlePageFree({ id: 1 });
    expect(result).toContain("Freed");
    expect(result).toContain("Doomed");

    const dir = await findPageDir(1);
    expect(dir).toBeNull();
  });

  it("recursively deletes children by default", async () => {
    await handlePageOut({ title: "Parent", content: "P", summary: "P" });
    await handlePageOut({ title: "Child", content: "C", summary: "C", parent_id: 1 });

    const result = await handlePageFree({ id: 1 });
    expect(result).toContain("1 children");
    expect(await findPageDir(1)).toBeNull();
    expect(await findPageDir(2)).toBeNull();
  });

  it("errors on non-recursive delete with children", async () => {
    await handlePageOut({ title: "Parent", content: "P", summary: "P" });
    await handlePageOut({ title: "Child", content: "C", summary: "C", parent_id: 1 });

    const result = await handlePageFree({ id: 1, recursive: false });
    expect(result).toContain("has children");
    expect(result).toContain("Child");

    // Page should still exist
    expect(await findPageDir(1)).not.toBeNull();
  });

  it("returns error for non-existent page", async () => {
    const result = await handlePageFree({ id: 999 });
    expect(result).toContain("not found");
  });
});

describe("handlePageMove", () => {
  it("moves a page under another", async () => {
    await handlePageOut({ title: "Target", content: "T", summary: "T" });
    await handlePageOut({ title: "Movable", content: "M", summary: "M" });

    const result = await handlePageMove({ id: 2, new_parent_id: 1 });
    expect(result).toContain("Moved page 2");
    expect(result).toContain("under page 1");

    // Should now be nested
    const table = await handlePageTable({});
    expect(table).toContain("Target");
    expect(table).toContain("Movable");
  });

  it("moves a page to root", async () => {
    await handlePageOut({ title: "Parent", content: "P", summary: "P" });
    await handlePageOut({ title: "Child", content: "C", summary: "C", parent_id: 1 });

    const result = await handlePageMove({ id: 2 });
    expect(result).toContain("to root");
  });

  it("prevents moving under itself", async () => {
    await handlePageOut({ title: "Page", content: "P", summary: "P" });
    const result = await handlePageMove({ id: 1, new_parent_id: 1 });
    expect(result).toContain("Cannot move");
  });

  it("prevents circular nesting", async () => {
    await handlePageOut({ title: "Parent", content: "P", summary: "P" });
    await handlePageOut({ title: "Child", content: "C", summary: "C", parent_id: 1 });

    const result = await handlePageMove({ id: 1, new_parent_id: 2 });
    expect(result).toContain("circular");
  });

  it("returns error for non-existent page", async () => {
    const result = await handlePageMove({ id: 999, new_parent_id: 1 });
    expect(result).toContain("not found");
  });
});

describe("handlePageMerge", () => {
  it("concatenates sources into target", async () => {
    await handlePageOut({ title: "Target", content: "Base content", summary: "T" });
    await handlePageOut({ title: "Source", content: "Extra content", summary: "S" });

    const result = await handlePageMerge({
      source_ids: [2],
      target_id: 1,
      strategy: "concatenate",
    });
    expect(result).toContain("Merged pages [2] into page 1");

    const dir = await findPageDir(1);
    const content = await readContent(dir!);
    expect(content).toContain("Base content");
    expect(content).toContain("Extra content");

    // Source should be deleted
    expect(await findPageDir(2)).toBeNull();
  });

  it("uses provided content when strategy is 'provided'", async () => {
    await handlePageOut({ title: "Target", content: "Old", summary: "T" });
    await handlePageOut({ title: "Source", content: "Also old", summary: "S" });

    await handlePageMerge({
      source_ids: [2],
      target_id: 1,
      strategy: "provided",
      merged_content: "Brand new merged content",
      merged_summary: "Merged",
    });

    const dir = await findPageDir(1);
    const content = await readContent(dir!);
    expect(content).toBe("Brand new merged content");

    const meta = await readMeta(dir!);
    expect(meta.summary).toBe("Merged");
  });

  it("errors when provided strategy has no content", async () => {
    await handlePageOut({ title: "Target", content: "T", summary: "T" });
    await handlePageOut({ title: "Source", content: "S", summary: "S" });

    const result = await handlePageMerge({
      source_ids: [2],
      target_id: 1,
      strategy: "provided",
    });
    expect(result).toContain("requires merged_content");
  });

  it("merges multiple sources", async () => {
    await handlePageOut({ title: "Target", content: "Base", summary: "T" });
    await handlePageOut({ title: "Source A", content: "AA", summary: "A" });
    await handlePageOut({ title: "Source B", content: "BB", summary: "B" });

    const result = await handlePageMerge({
      source_ids: [2, 3],
      target_id: 1,
    });
    expect(result).toContain("Merged pages [2, 3]");

    const dir = await findPageDir(1);
    const content = await readContent(dir!);
    expect(content).toContain("AA");
    expect(content).toContain("BB");
  });

  it("skips source that matches target", async () => {
    await handlePageOut({ title: "Only", content: "C", summary: "S" });
    const result = await handlePageMerge({
      source_ids: [1],
      target_id: 1,
    });
    expect(result).toContain("No source pages to merge");
  });

  it("returns error for non-existent target", async () => {
    const result = await handlePageMerge({ source_ids: [1], target_id: 999 });
    expect(result).toContain("not found");
  });
});

// --- Swap operations ---

describe("swapOut", () => {
  it("returns original messages when swapCount is 0", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ];
    const result = swapOut(messages, 1, "Test", "Summary", 0);
    expect(result).toEqual(messages);
  });

  it("returns original messages when swapCount is undefined", () => {
    const messages: ModelMessage[] = [{ role: "user", content: "hello" }];
    const result = swapOut(messages, 1, "Test", "Summary");
    expect(result).toEqual(messages);
  });

  it("removes messages and adds reference", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "first" },
      { role: "assistant", content: "response" },
      { role: "user", content: "second" },
      { role: "assistant", content: "another response" },
    ];

    const result = swapOut(messages, 5, "Debug Session", "Found the bug", 2);
    expect(result).toHaveLength(3); // 2 kept + 1 reference
    expect(result[0]).toEqual({ role: "user", content: "first" });
    expect(result[1]).toEqual({ role: "assistant", content: "response" });
    expect(result[2].role).toBe("assistant");
    expect(result[2].content).toContain("Paged out");
    expect(result[2].content).toContain("Page 5");
    expect(result[2].content).toContain("Debug Session");
    expect(result[2].content).toContain("Found the bug");
  });

  it("handles swapCount larger than message count", () => {
    const messages: ModelMessage[] = [{ role: "user", content: "only one" }];
    const result = swapOut(messages, 1, "Test", "S", 10);
    expect(result).toHaveLength(1); // just the reference
    expect(result[0].content).toContain("Paged out");
  });
});

describe("swapIn", () => {
  it("appends page content as an assistant message", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "tell me about auth" },
    ];

    const result = swapIn(messages, 3, "Auth Debug", "Token was expired");
    expect(result).toHaveLength(2);
    expect(result[1].role).toBe("assistant");
    expect(result[1].content).toContain("Paged in");
    expect(result[1].content).toContain("Page 3");
    expect(result[1].content).toContain("Auth Debug");
    expect(result[1].content).toContain("Token was expired");
    expect(result[1].content).toContain("End of Page 3");
  });

  it("preserves original messages", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ];

    const result = swapIn(messages, 1, "T", "C");
    expect(result[0]).toEqual(messages[0]);
    expect(result[1]).toEqual(messages[1]);
  });
});
