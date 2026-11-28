import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSession, replaceMessages } from "@/lib/sessions";
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

  it("GET returns the saved chat history as turns", async () => {
    const s = await createSession({ title: "History" });
    await replaceMessages(s.id, [
      { role: "assistant", content: '[Paged out → Page 1: "Intro" — greetings]' },
      { role: "user", content: "What is 2+2?" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me check." },
          { type: "tool-call", toolCallId: "c1", toolName: "page_table", input: {} },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "page_table",
            output: { type: "text", value: "Page 1" },
          },
        ],
      },
      { role: "assistant", content: "It is 4." },
    ]);

    const { GET } = await import("@/app/api/sessions/[id]/route");
    const res = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: s.id }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      turns: Array<{ user: string; assistant: string; events: Array<{ kind: string; name: string }> }>;
    };
    expect(data.turns).toHaveLength(2);
    expect(data.turns[0].user).toBe("");
    expect(data.turns[0].assistant).toContain("Paged out → Page 1");
    expect(data.turns[1].user).toBe("What is 2+2?");
    expect(data.turns[1].assistant).toBe("Let me check.\n\nIt is 4.");
    expect(data.turns[1].events.map((e) => `${e.kind}:${e.name}`)).toEqual([
      "call:page_table",
      "result:page_table",
    ]);
  });

  it("GET returns no turns for an empty session", async () => {
    const s = await createSession();
    const { GET } = await import("@/app/api/sessions/[id]/route");
    const res = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: s.id }),
    });
    const data = (await res.json()) as { turns: unknown[] };
    expect(data.turns).toEqual([]);
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
