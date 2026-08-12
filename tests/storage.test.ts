import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import {
  withSession,
  insertPage,
  getPageByNo,
  getPageById,
  getChildren,
  buildTree,
  updatePage,
  deletePage,
  setParent,
  isDescendantOf,
  currentSessionId,
} from "../src/storage.js";
import { closePool } from "../src/db.js";
import { resetDb, makeTestSession } from "./helpers/db.js";

describe("storage (DB-backed)", () => {
  let sid: string;

  beforeAll(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await closePool();
  });

  beforeEach(async () => {
    await resetDb();
    sid = await makeTestSession();
  });

  it("currentSessionId throws when called outside withSession", () => {
    expect(() => currentSessionId()).toThrow(/withSession/);
  });

  it("insertPage assigns page_no 1, 2, 3... per session", async () => {
    await withSession(sid, async () => {
      const a = await insertPage({ title: "A", summary: "", content: "" });
      const b = await insertPage({ title: "B", summary: "", content: "" });
      const c = await insertPage({ title: "C", summary: "", content: "" });
      expect(a.page_no).toBe(1);
      expect(b.page_no).toBe(2);
      expect(c.page_no).toBe(3);
    });
  });

  it("page_no sequences are per-session (two sessions both start at 1)", async () => {
    const sid2 = await makeTestSession("session-two");
    const a = await withSession(sid, () =>
      insertPage({ title: "A", summary: "", content: "" })
    );
    const b = await withSession(sid2, () =>
      insertPage({ title: "B", summary: "", content: "" })
    );
    expect(a.page_no).toBe(1);
    expect(b.page_no).toBe(1);
    expect(a.session_id).not.toBe(b.session_id);
  });

  it("getPageByNo only finds pages in the active session", async () => {
    const sid2 = await makeTestSession("session-two");
    await withSession(sid, () => insertPage({ title: "A", summary: "", content: "" }));
    const fromOther = await withSession(sid2, () => getPageByNo(1));
    expect(fromOther).toBeNull();
  });

  it("insertPage with parentPageNo nests pages", async () => {
    await withSession(sid, async () => {
      const parent = await insertPage({ title: "Parent", summary: "", content: "" });
      const child = await insertPage({
        title: "Child",
        summary: "",
        content: "",
        parentPageNo: parent.page_no,
      });
      expect(child.parent_id).toBe(parent.id);
    });
  });

  it("insertPage throws when parentPageNo does not exist", async () => {
    await withSession(sid, async () => {
      await expect(
        insertPage({ title: "Orphan", summary: "", content: "", parentPageNo: 99 })
      ).rejects.toThrow(/not found/);
    });
  });

  it("buildTree returns a hierarchical structure ordered by page_no", async () => {
    await withSession(sid, async () => {
      const a = await insertPage({ title: "A", summary: "", content: "" });
      const b = await insertPage({ title: "B", summary: "", content: "" });
      await insertPage({ title: "A1", summary: "", content: "", parentPageNo: a.page_no });
      await insertPage({ title: "A2", summary: "", content: "", parentPageNo: a.page_no });
      void b;

      const tree = await buildTree();
      expect(tree.map((n) => n.row.title)).toEqual(["A", "B"]);
      expect(tree[0].children.map((c) => c.row.title)).toEqual(["A1", "A2"]);
      expect(tree[1].children).toEqual([]);
    });
  });

  it("updatePage mutates fields and bumps updated_at", async () => {
    await withSession(sid, async () => {
      const p = await insertPage({ title: "Orig", summary: "s", content: "c" });
      const before = p.updated_at;
      await new Promise((r) => setTimeout(r, 5));
      const after = await updatePage(p.id, { title: "New", isResident: true });
      expect(after?.title).toBe("New");
      expect(after?.is_resident).toBe(true);
      expect(after!.updated_at.getTime()).toBeGreaterThan(before.getTime());
    });
  });

  it("updatePage with no fields returns the current row", async () => {
    await withSession(sid, async () => {
      const p = await insertPage({ title: "X", summary: "", content: "" });
      const got = await updatePage(p.id, {});
      expect(got?.id).toBe(p.id);
    });
  });

  it("deletePage cascades to children", async () => {
    await withSession(sid, async () => {
      const parent = await insertPage({ title: "Parent", summary: "", content: "" });
      const child = await insertPage({
        title: "Child",
        summary: "",
        content: "",
        parentPageNo: parent.page_no,
      });
      const ok = await deletePage(parent.id);
      expect(ok).toBe(true);
      expect(await getPageById(child.id)).toBeNull();
    });
  });

  it("setParent moves a page; new_parent_id null moves to root", async () => {
    await withSession(sid, async () => {
      const p = await insertPage({ title: "P", summary: "", content: "" });
      const c = await insertPage({
        title: "C",
        summary: "",
        content: "",
        parentPageNo: p.page_no,
      });
      const detached = await setParent(c.id, null);
      expect(detached?.parent_id).toBeNull();
    });
  });

  it("isDescendantOf detects ancestry through nested chain", async () => {
    await withSession(sid, async () => {
      const a = await insertPage({ title: "A", summary: "", content: "" });
      const b = await insertPage({
        title: "B",
        summary: "",
        content: "",
        parentPageNo: a.page_no,
      });
      const c = await insertPage({
        title: "C",
        summary: "",
        content: "",
        parentPageNo: b.page_no,
      });

      expect(await isDescendantOf(a.id, c.id)).toBe(true);
      expect(await isDescendantOf(b.id, c.id)).toBe(true);
      expect(await isDescendantOf(c.id, a.id)).toBe(false);
    });
  });

  it("getChildren(null) returns root pages only", async () => {
    await withSession(sid, async () => {
      const r1 = await insertPage({ title: "R1", summary: "", content: "" });
      const r2 = await insertPage({ title: "R2", summary: "", content: "" });
      await insertPage({ title: "C1", summary: "", content: "", parentPageNo: r1.page_no });

      const roots = await getChildren(null);
      expect(roots.map((p) => p.title).sort()).toEqual(["R1", "R2"]);
      void r2;
    });
  });

  it("AsyncLocalStorage isolates concurrent withSession calls", async () => {
    const sid2 = await makeTestSession("session-concurrent");

    const [a, b] = await Promise.all([
      withSession(sid, () => insertPage({ title: "from A", summary: "", content: "" })),
      withSession(sid2, () => insertPage({ title: "from B", summary: "", content: "" })),
    ]);
    expect(a.session_id).toBe(sid);
    expect(b.session_id).toBe(sid2);
    expect(a.page_no).toBe(1);
    expect(b.page_no).toBe(1);
  });
});
