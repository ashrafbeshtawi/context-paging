import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPageTable } from "@/lib/page-table";
import { withPagesRoot } from "@agent/storage";
import { handlePageOut } from "@agent/context-manager";

describe("getPageTable", () => {
  let tmpDir: string;

  beforeEach(async () => {
    const os = await import("node:os");
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ctx-paging-pt-"));
  });

  afterEach(async () => {
    const fs = await import("node:fs/promises");
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns [] for an empty root", async () => {
    const result = await withPagesRoot(tmpDir, () => getPageTable());
    expect(result).toEqual([]);
  });

  it("returns entries that reflect on-disk pages", async () => {
    await withPagesRoot(tmpDir, async () => {
      await handlePageOut({ title: "First", content: "body", summary: "s1" });
      await handlePageOut({ title: "Second", content: "more", summary: "s2" });
    });
    const result = await withPagesRoot(tmpDir, () => getPageTable());
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.title)).toEqual(["First", "Second"]);
    expect(result.every((p) => p.isResident === false)).toBe(true);
    expect(result.every((p) => p.depth === 0)).toBe(true);
  });

  it("nests children under parent with incremented depth", async () => {
    let parentId = 0;
    await withPagesRoot(tmpDir, async () => {
      const res = await handlePageOut({ title: "Parent", summary: "p" });
      parentId = parseInt(res.match(/Page (\d+)/)![1], 10);
      await handlePageOut({ title: "Child", summary: "c", parent_id: parentId });
    });
    const result = await withPagesRoot(tmpDir, () => getPageTable());
    expect(result).toHaveLength(1);
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children[0].depth).toBe(1);
    expect(result[0].children[0].title).toBe("Child");
  });

  it("scopes results to the passed root (isolation between sessions)", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const other = await fs.mkdtemp(path.join(os.tmpdir(), "ctx-paging-pt-other-"));
    try {
      await withPagesRoot(tmpDir, () => handlePageOut({ title: "A", summary: "x" }));
      await withPagesRoot(other, () => handlePageOut({ title: "B", summary: "y" }));
      const inA = await withPagesRoot(tmpDir, () => getPageTable());
      const inB = await withPagesRoot(other, () => getPageTable());
      expect(inA.map((p) => p.title)).toEqual(["A"]);
      expect(inB.map((p) => p.title)).toEqual(["B"]);
    } finally {
      await fs.rm(other, { recursive: true, force: true });
    }
  });
});
