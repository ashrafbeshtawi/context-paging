import { describe, it, expect } from "vitest";
import { formatPageTable } from "../src/toc.js";
import type { PageNode, PageRow } from "../src/types.js";

function row(overrides: Partial<PageRow> = {}): PageRow {
  return {
    id: 100,
    session_id: "s",
    page_no: 1,
    parent_id: null,
    title: "Test",
    summary: "",
    content: "",
    is_resident: false,
    created_at: new Date(0),
    updated_at: new Date(0),
    ...overrides,
  };
}

function node(rowOverrides: Partial<PageRow> = {}, children: PageNode[] = []): PageNode {
  return { row: row(rowOverrides), children };
}

describe("formatPageTable", () => {
  it("formats a single swapped page", () => {
    const result = formatPageTable([node({ page_no: 1, title: "Auth", is_resident: false })]);
    expect(result).toBe('Page 1: "Auth" [swapped]');
  });

  it("formats a single resident page", () => {
    const result = formatPageTable([node({ page_no: 1, title: "Auth", is_resident: true })]);
    expect(result).toBe('Page 1: "Auth" [resident]');
  });

  it("includes summary when present", () => {
    const result = formatPageTable([node({ page_no: 1, title: "Auth", summary: "Login flow" })]);
    expect(result).toBe('Page 1: "Auth" [swapped] — Login flow');
  });

  it("formats multiple pages", () => {
    const result = formatPageTable([
      node({ page_no: 1, title: "First" }),
      node({ page_no: 2, title: "Second" }),
    ]);
    const lines = result.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Page 1");
    expect(lines[1]).toContain("Page 2");
  });

  it("indents nested children", () => {
    const child = node({ page_no: 2, title: "Child" });
    const parent = node({ page_no: 1, title: "Parent" }, [child]);
    const lines = formatPageTable([parent]).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('Page 1: "Parent" [swapped]');
    expect(lines[1]).toBe('  Page 2: "Child" [swapped]');
  });

  it("handles deeply nested pages", () => {
    const grandchild = node({ page_no: 3, title: "Grandchild" });
    const child = node({ page_no: 2, title: "Child" }, [grandchild]);
    const parent = node({ page_no: 1, title: "Parent" }, [child]);
    const lines = formatPageTable([parent]).split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe('    Page 3: "Grandchild" [swapped]');
  });

  it("returns empty string for empty array", () => {
    expect(formatPageTable([])).toBe("");
  });
});
