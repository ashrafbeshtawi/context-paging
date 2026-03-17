import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  ensureRoot,
  getNextId,
  findPageDir,
  readMeta,
  readContent,
  writeMeta,
  writeContent,
  createPageDir,
  deletePageDir,
  getChildPageDirs,
  buildTree,
  movePageDir,
  isDescendantOf,
} from "../src/storage.js";
import type { PageMeta } from "../src/types.js";

const TEST_ROOT = path.join(os.tmpdir(), "context-paging-test-storage");
process.env.PAGES_ROOT = TEST_ROOT;

function makeMeta(overrides: Partial<PageMeta> = {}): PageMeta {
  return {
    id: 1,
    title: "Test Page",
    summary: "A test",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    is_resident: false,
    ...overrides,
  };
}

beforeEach(async () => {
  await fs.rm(TEST_ROOT, { recursive: true, force: true });
  await ensureRoot();
});

afterEach(async () => {
  await fs.rm(TEST_ROOT, { recursive: true, force: true });
});

describe("ensureRoot", () => {
  it("creates the root directory", async () => {
    const stat = await fs.stat(TEST_ROOT);
    expect(stat.isDirectory()).toBe(true);
  });
});

describe("getNextId", () => {
  it("returns 1 on first call", async () => {
    const id = await getNextId();
    expect(id).toBe(1);
  });

  it("increments on successive calls", async () => {
    const id1 = await getNextId();
    const id2 = await getNextId();
    const id3 = await getNextId();
    expect(id1).toBe(1);
    expect(id2).toBe(2);
    expect(id3).toBe(3);
  });

  it("persists counter across reads", async () => {
    await getNextId();
    await getNextId();
    const raw = await fs.readFile(path.join(TEST_ROOT, "_counter.json"), "utf-8");
    const data = JSON.parse(raw);
    expect(data.next_id).toBe(3);
  });
});

describe("createPageDir", () => {
  it("creates a directory at root", async () => {
    const dir = await createPageDir(1);
    expect(dir).toBe(path.join(TEST_ROOT, "1"));
    const stat = await fs.stat(dir);
    expect(stat.isDirectory()).toBe(true);
  });

  it("creates a nested directory under a parent", async () => {
    const parentDir = await createPageDir(1);
    await writeMeta(parentDir, makeMeta({ id: 1 }));

    const childDir = await createPageDir(2, 1);
    expect(childDir).toBe(path.join(TEST_ROOT, "1", "2"));
  });

  it("throws when parent does not exist", async () => {
    await expect(createPageDir(2, 999)).rejects.toThrow("Parent page 999 not found");
  });
});

describe("readMeta / writeMeta", () => {
  it("round-trips metadata", async () => {
    const dir = await createPageDir(1);
    const meta = makeMeta({ id: 1, title: "Round Trip" });
    await writeMeta(dir, meta);

    const read = await readMeta(dir);
    expect(read).toEqual(meta);
  });
});

describe("readContent / writeContent", () => {
  it("round-trips content", async () => {
    const dir = await createPageDir(1);
    await writeContent(dir, "Hello, world!");
    const content = await readContent(dir);
    expect(content).toBe("Hello, world!");
  });

  it("returns empty string for missing content", async () => {
    const dir = await createPageDir(1);
    const content = await readContent(dir);
    expect(content).toBe("");
  });
});

describe("findPageDir", () => {
  it("finds a page at root", async () => {
    const dir = await createPageDir(1);
    await writeMeta(dir, makeMeta({ id: 1 }));

    const found = await findPageDir(1);
    expect(found).toBe(dir);
  });

  it("finds a nested page", async () => {
    const parentDir = await createPageDir(1);
    await writeMeta(parentDir, makeMeta({ id: 1 }));

    const childDir = await createPageDir(2, 1);
    await writeMeta(childDir, makeMeta({ id: 2 }));

    const found = await findPageDir(2);
    expect(found).toBe(childDir);
  });

  it("returns null for non-existent page", async () => {
    const found = await findPageDir(999);
    expect(found).toBeNull();
  });
});

describe("deletePageDir", () => {
  it("removes a page directory", async () => {
    const dir = await createPageDir(1);
    await writeMeta(dir, makeMeta({ id: 1 }));
    await deletePageDir(dir);

    const found = await findPageDir(1);
    expect(found).toBeNull();
  });
});

describe("getChildPageDirs", () => {
  it("returns empty array for no children", async () => {
    const children = await getChildPageDirs(TEST_ROOT);
    expect(children).toEqual([]);
  });

  it("returns child page directories", async () => {
    const dir1 = await createPageDir(1);
    await writeMeta(dir1, makeMeta({ id: 1 }));

    const dir2 = await createPageDir(2);
    await writeMeta(dir2, makeMeta({ id: 2 }));

    const children = await getChildPageDirs(TEST_ROOT);
    expect(children).toHaveLength(2);
    expect(children).toContain(dir1);
    expect(children).toContain(dir2);
  });

  it("ignores directories without meta.json", async () => {
    await fs.mkdir(path.join(TEST_ROOT, "not-a-page"), { recursive: true });
    const dir1 = await createPageDir(1);
    await writeMeta(dir1, makeMeta({ id: 1 }));

    const children = await getChildPageDirs(TEST_ROOT);
    expect(children).toHaveLength(1);
  });
});

describe("buildTree", () => {
  it("builds a flat tree", async () => {
    const dir1 = await createPageDir(1);
    await writeMeta(dir1, makeMeta({ id: 1, title: "First" }));

    const dir2 = await createPageDir(2);
    await writeMeta(dir2, makeMeta({ id: 2, title: "Second" }));

    const tree = await buildTree();
    expect(tree).toHaveLength(2);
    expect(tree[0].meta.id).toBe(1);
    expect(tree[1].meta.id).toBe(2);
    expect(tree[0].children).toHaveLength(0);
  });

  it("builds a nested tree", async () => {
    const dir1 = await createPageDir(1);
    await writeMeta(dir1, makeMeta({ id: 1, title: "Parent" }));

    const dir2 = await createPageDir(2, 1);
    await writeMeta(dir2, makeMeta({ id: 2, title: "Child" }));

    const tree = await buildTree();
    expect(tree).toHaveLength(1);
    expect(tree[0].meta.title).toBe("Parent");
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].meta.title).toBe("Child");
  });

  it("sorts by ID", async () => {
    const dir3 = await createPageDir(3);
    await writeMeta(dir3, makeMeta({ id: 3 }));

    const dir1 = await createPageDir(1);
    await writeMeta(dir1, makeMeta({ id: 1 }));

    const tree = await buildTree();
    expect(tree[0].meta.id).toBe(1);
    expect(tree[1].meta.id).toBe(3);
  });
});

describe("movePageDir", () => {
  it("moves a page under a new parent", async () => {
    const dir1 = await createPageDir(1);
    await writeMeta(dir1, makeMeta({ id: 1 }));

    const dir2 = await createPageDir(2);
    await writeMeta(dir2, makeMeta({ id: 2 }));

    const newDir = await movePageDir(dir2, dir1);
    expect(newDir).toBe(path.join(dir1, "2"));

    const stat = await fs.stat(newDir);
    expect(stat.isDirectory()).toBe(true);
  });
});

describe("isDescendantOf", () => {
  it("returns true for a direct child", async () => {
    const dir1 = await createPageDir(1);
    await writeMeta(dir1, makeMeta({ id: 1 }));

    const dir2 = await createPageDir(2, 1);
    await writeMeta(dir2, makeMeta({ id: 2 }));

    expect(await isDescendantOf(2, dir1)).toBe(true);
  });

  it("returns true for a deep descendant", async () => {
    const dir1 = await createPageDir(1);
    await writeMeta(dir1, makeMeta({ id: 1 }));

    const dir2 = await createPageDir(2, 1);
    await writeMeta(dir2, makeMeta({ id: 2 }));

    const dir3 = await createPageDir(3, 2);
    await writeMeta(dir3, makeMeta({ id: 3 }));

    expect(await isDescendantOf(3, dir1)).toBe(true);
  });

  it("returns false for unrelated pages", async () => {
    const dir1 = await createPageDir(1);
    await writeMeta(dir1, makeMeta({ id: 1 }));

    const dir2 = await createPageDir(2);
    await writeMeta(dir2, makeMeta({ id: 2 }));

    expect(await isDescendantOf(2, dir1)).toBe(false);
  });
});
