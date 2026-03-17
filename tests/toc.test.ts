import { describe, it, expect } from "vitest";
import { formatPageTable } from "../src/toc.js";
import type { PageNode } from "../src/types.js";

function makeNode(overrides: Partial<PageNode["meta"]> & { children?: PageNode[] } = {}): PageNode {
  const { children = [], ...metaOverrides } = overrides;
  return {
    meta: {
      id: 1,
      title: "Test",
      summary: "",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      is_resident: false,
      ...metaOverrides,
    },
    children,
    path: "/tmp/test/1",
  };
}

describe("formatPageTable", () => {
  it("formats a single swapped page", () => {
    const nodes = [makeNode({ id: 1, title: "Auth", is_resident: false })];
    const result = formatPageTable(nodes);
    expect(result).toBe('Page 1: "Auth" [swapped]');
  });

  it("formats a single resident page", () => {
    const nodes = [makeNode({ id: 1, title: "Auth", is_resident: true })];
    const result = formatPageTable(nodes);
    expect(result).toBe('Page 1: "Auth" [resident]');
  });

  it("includes summary when present", () => {
    const nodes = [makeNode({ id: 1, title: "Auth", summary: "Login flow" })];
    const result = formatPageTable(nodes);
    expect(result).toBe('Page 1: "Auth" [swapped] — Login flow');
  });

  it("formats multiple pages", () => {
    const nodes = [
      makeNode({ id: 1, title: "First" }),
      makeNode({ id: 2, title: "Second" }),
    ];
    const result = formatPageTable(nodes);
    const lines = result.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Page 1");
    expect(lines[1]).toContain("Page 2");
  });

  it("indents nested children", () => {
    const child = makeNode({ id: 2, title: "Child" });
    const parent = makeNode({ id: 1, title: "Parent", children: [child] });
    const result = formatPageTable([parent]);
    const lines = result.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('Page 1: "Parent" [swapped]');
    expect(lines[1]).toBe('  Page 2: "Child" [swapped]');
  });

  it("handles deeply nested pages", () => {
    const grandchild = makeNode({ id: 3, title: "Grandchild" });
    const child = makeNode({ id: 2, title: "Child", children: [grandchild] });
    const parent = makeNode({ id: 1, title: "Parent", children: [child] });
    const result = formatPageTable([parent]);
    const lines = result.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe('    Page 3: "Grandchild" [swapped]');
  });

  it("returns empty string for empty array", () => {
    expect(formatPageTable([])).toBe("");
  });
});
