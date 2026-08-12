import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getPageTable } from "@/lib/page-table";
import { withSession } from "@agent/storage";
import { handlePageOut } from "@agent/context-manager";
import { closePool } from "@agent/db";
import { resetDb, makeTestSession } from "../../tests/helpers/db";

let sid: string;

beforeEach(async () => {
  await resetDb();
  sid = await makeTestSession();
});

afterAll(async () => {
  await closePool();
});

describe("getPageTable", () => {
  it("returns [] for an empty session", async () => {
    expect(await withSession(sid, () => getPageTable())).toEqual([]);
  });

  it("returns entries that reflect stored pages with page_no as id", async () => {
    await withSession(sid, async () => {
      await handlePageOut({ title: "First", content: "body", summary: "s1" });
      await handlePageOut({ title: "Second", content: "more", summary: "s2" });
    });
    const result = await withSession(sid, () => getPageTable());
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.title)).toEqual(["First", "Second"]);
    expect(result.map((p) => p.id)).toEqual([1, 2]);
    expect(result.every((p) => p.isResident === false)).toBe(true);
  });

  it("nests children with incremented depth", async () => {
    await withSession(sid, async () => {
      await handlePageOut({ title: "Parent", summary: "p" });
      await handlePageOut({ title: "Child", summary: "c", parent_id: 1 });
    });
    const result = await withSession(sid, () => getPageTable());
    expect(result).toHaveLength(1);
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children[0].depth).toBe(1);
    expect(result[0].children[0].title).toBe("Child");
  });

  it("isolates results to the current session", async () => {
    const sid2 = await makeTestSession("page-table-other");
    await withSession(sid, () => handlePageOut({ title: "A", summary: "" }));
    await withSession(sid2, () => handlePageOut({ title: "B", summary: "" }));
    expect((await withSession(sid, () => getPageTable())).map((p) => p.title)).toEqual(["A"]);
    expect((await withSession(sid2, () => getPageTable())).map((p) => p.title)).toEqual(["B"]);
  });
});
