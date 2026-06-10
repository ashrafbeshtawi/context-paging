import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetForTests, createSession } from "@/lib/sessions";

// next/server's NextResponse uses Web Response under the hood; jsdom + node provides those.

describe("/api/sessions routes", () => {
  beforeEach(() => resetForTests());

  it("GET /api/sessions returns an empty list", async () => {
    const { GET } = await import("@/app/api/sessions/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const data = (await res.json()) as { sessions: unknown[] };
    expect(data.sessions).toEqual([]);
  });

  it("POST /api/sessions creates a session", async () => {
    const { POST } = await import("@/app/api/sessions/route");
    const res = await POST(
      new Request("http://localhost/api/sessions", {
        method: "POST",
        body: JSON.stringify({ title: "Hello" }),
      })
    );
    expect(res.status).toBe(201);
    const data = (await res.json()) as { session: { id: string; title: string } };
    expect(data.session.title).toBe("Hello");
    expect(data.session.id).toMatch(/^s-/);
  });

  it("POST tolerates a missing body", async () => {
    const { POST } = await import("@/app/api/sessions/route");
    const res = await POST(new Request("http://localhost/api/sessions", { method: "POST" }));
    expect(res.status).toBe(201);
    const data = (await res.json()) as { session: { title: string } };
    expect(data.session.title).toBe("New chat");
  });
});

describe("/api/sessions/[id] routes", () => {
  let tmpDir: string;

  beforeEach(async () => {
    resetForTests();
    const os = await import("node:os");
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ctx-paging-web-"));
    process.env.WEB_PAGES_ROOT = tmpDir;
  });

  afterEach(async () => {
    const fs = await import("node:fs/promises");
    await fs.rm(tmpDir, { recursive: true, force: true });
    delete process.env.WEB_PAGES_ROOT;
  });

  it("GET returns 404 for an unknown session", async () => {
    const { GET } = await import("@/app/api/sessions/[id]/route");
    const res = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(res.status).toBe(404);
  });

  it("GET returns session + context + empty page table", async () => {
    const s = createSession("My chat");
    const { GET } = await import("@/app/api/sessions/[id]/route");
    const res = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: s.id }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      session: { id: string };
      context: { totals: { messages: number } };
      pageTable: unknown[];
    };
    expect(data.session.id).toBe(s.id);
    expect(data.context.totals.messages).toBe(0);
    expect(data.pageTable).toEqual([]);
  });

  it("DELETE returns 404 for unknown id and 200 otherwise", async () => {
    const { DELETE } = await import("@/app/api/sessions/[id]/route");
    const a = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(a.status).toBe(404);

    const s = createSession();
    const b = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), {
      params: Promise.resolve({ id: s.id }),
    });
    expect(b.status).toBe(200);
  });
});
