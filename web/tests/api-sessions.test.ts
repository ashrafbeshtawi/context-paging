import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSession } from "@/lib/sessions";
import { closePool } from "@agent/db";
import { resetDb } from "../../tests/helpers/db";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closePool();
});

describe("/api/sessions routes", () => {
  it("GET /api/sessions returns an empty list initially", async () => {
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
  it("GET returns 404 for an unknown session", async () => {
    const { GET } = await import("@/app/api/sessions/[id]/route");
    const res = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(res.status).toBe(404);
  });

  it("GET returns session + context + empty page table", async () => {
    const s = await createSession({ title: "My chat" });
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

    const s = await createSession();
    const b = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), {
      params: Promise.resolve({ id: s.id }),
    });
    expect(b.status).toBe(200);
  });
});
