import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createSession, getMessages, replaceMessages } from "@/lib/sessions";
import { parseSseStream } from "@/lib/sse";
import { closePool } from "@agent/db";
import { withSession } from "@agent/storage";
import { getPageTable } from "@/lib/page-table";
import { resetDb } from "../../tests/helpers/db";

vi.mock("@agent/providers", () => ({
  resolveModel: vi.fn(async () => ({ id: "mock-model" })),
}));

vi.mock("@agent/agent", () => ({
  runAgent: vi.fn(async (messages: unknown[], opts: {
    onText?: (s: string) => void;
    onToolCall?: (n: string, a: unknown) => void;
    onToolResult?: (n: string, o: unknown) => void;
  }) => {
    opts.onText?.("Hello ");
    opts.onToolCall?.("page_table", {});
    opts.onToolResult?.("page_table", { result: "empty" });
    opts.onText?.("world");
    return {
      messages: [
        ...(messages as object[]),
        { role: "assistant", content: "Hello world" },
      ],
      response: "Hello world",
    };
  }),
}));

async function readAllEvents(resp: Response) {
  const events: Array<{ event: string; data: unknown }> = [];
  if (!resp.body) return events;
  for await (const e of parseSseStream(resp.body.getReader())) events.push(e);
  return events;
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closePool();
});

describe("/api/chat route", () => {
  it("400s when sessionId is missing", async () => {
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({ message: "hi" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("404s for an unknown session", async () => {
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({ sessionId: "nope", message: "hi" }),
      })
    );
    expect(res.status).toBe(404);
  });

  it("streams text, tool events, context, and done", async () => {
    const s = await createSession();
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({ sessionId: s.id, message: "hello" }),
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");

    const events = await readAllEvents(res);
    const eventNames = events.map((e) => e.event);

    expect(eventNames).toContain("text");
    expect(eventNames).toContain("tool-call");
    expect(eventNames).toContain("tool-result");
    expect(eventNames).toContain("context");
    expect(eventNames).toContain("done");

    const textChunks = events
      .filter((e) => e.event === "text")
      .map((e) => (e.data as { chunk: string }).chunk);
    expect(textChunks.join("")).toBe("Hello world");
  });

  it("forwards apiKey/provider/model to resolveModel when provided", async () => {
    const { resolveModel } = await import("@agent/providers");
    const mockResolve = vi.mocked(resolveModel);
    mockResolve.mockClear();

    const s = await createSession();
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          sessionId: s.id,
          message: "hi",
          apiKey: "sk-test",
          provider: "openai",
          model: "gpt-4o-mini",
        }),
      })
    );
    // Drain the stream so the route's async work finishes.
    await readAllEvents(res);

    expect(mockResolve).toHaveBeenCalledWith({
      apiKey: "sk-test",
      provider: "openai",
      model: "gpt-4o-mini",
    });
  });

  it("409s a second POST that overlaps a running turn and keeps the first turn", async () => {
    const { runAgent } = await import("@agent/agent");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let started!: () => void;
    const agentStarted = new Promise<void>((r) => (started = r));
    vi.mocked(runAgent).mockImplementationOnce(async (messages) => {
      started();
      await gate;
      return {
        messages: [...messages, { role: "assistant", content: "first answer" }],
        response: "first answer",
      } as Awaited<ReturnType<typeof runAgent>>;
    });

    const s = await createSession();
    const { POST } = await import("@/app/api/chat/route");
    const post = (message: string) =>
      POST(
        new Request("http://localhost/api/chat", {
          method: "POST",
          body: JSON.stringify({ sessionId: s.id, message }),
        })
      );

    const first = await post("first");
    expect(first.status).toBe(200);
    const firstEvents = readAllEvents(first);
    await agentStarted;

    const second = await post("second");
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: string }).error).toMatch(/reload/i);

    release();
    const events = await firstEvents;
    expect(events.map((e) => e.event)).toContain("done");

    const msgs = await getMessages(s.id);
    expect(msgs.map((m) => m.content)).toEqual(["first", "first answer"]);

    // The lock is released once the turn ends, so the next POST goes through.
    const third = await post("third");
    expect(third.status).toBe(200);
    await readAllEvents(third);
    expect((await getMessages(s.id)).map((m) => m.content)).toEqual([
      "first",
      "first answer",
      "third",
      "Hello world",
    ]);
  });

  it("sends a 409 error event and keeps the other write when the session changed mid-turn", async () => {
    const { runAgent } = await import("@agent/agent");
    const s = await createSession();
    vi.mocked(runAgent).mockImplementationOnce(async (messages) => {
      // Another writer (e.g. a turn on a different server process) commits
      // while this turn is still running.
      await replaceMessages(s.id, [
        { role: "user", content: "other" },
        { role: "assistant", content: "other answer" },
      ]);
      return {
        messages: [...messages, { role: "assistant", content: "late answer" }],
        response: "late answer",
      } as Awaited<ReturnType<typeof runAgent>>;
    });

    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({ sessionId: s.id, message: "late" }),
      })
    );
    expect(res.status).toBe(200);
    const events = await readAllEvents(res);

    const error = events.find((e) => e.event === "error");
    expect(error?.data).toMatchObject({ status: 409 });
    expect(events.map((e) => e.event)).not.toContain("done");

    const msgs = await getMessages(s.id);
    expect(msgs.map((m) => m.content)).toEqual(["other", "other answer"]);
  });

  it("rolls back the turn's page changes when the message write is refused", async () => {
    const { runAgent } = await import("@agent/agent");
    const { insertPage, updatePage, getPageByNo } = await import("@agent/storage");
    const s = await createSession();
    await withSession(s.id, () => insertPage({ title: "kept", summary: "", content: "original" }));

    vi.mocked(runAgent).mockImplementationOnce(async (messages) => {
      // The agent pages something out and edits an existing page...
      await insertPage({ title: "from the lost turn", summary: "", content: "" });
      const kept = (await getPageByNo(1))!;
      await updatePage(kept.id, { content: "edited by the lost turn" });
      // ...while another writer commits a newer history.
      await replaceMessages(s.id, [{ role: "user", content: "other" }]);
      return {
        messages: [...messages, { role: "assistant", content: "late answer" }],
        response: "late answer",
      } as Awaited<ReturnType<typeof runAgent>>;
    });

    const { POST } = await import("@/app/api/chat/route");
    const events = await readAllEvents(
      await POST(
        new Request("http://localhost/api/chat", {
          method: "POST",
          body: JSON.stringify({ sessionId: s.id, message: "late" }),
        })
      )
    );
    expect(events.find((e) => e.event === "error")?.data).toMatchObject({ status: 409 });

    const table = await withSession(s.id, () => getPageTable());
    expect(table.map((p) => p.title)).toEqual(["kept"]);
    expect((await withSession(s.id, () => getPageByNo(1)))?.content).toBe("original");
  });

  it("keeps the turn's page changes when the turn is saved", async () => {
    const { runAgent } = await import("@agent/agent");
    const { insertPage } = await import("@agent/storage");
    vi.mocked(runAgent).mockImplementationOnce(async (messages) => {
      await insertPage({ title: "paged out", summary: "", content: "" });
      return {
        messages: [...messages, { role: "assistant", content: "ok" }],
        response: "ok",
      } as Awaited<ReturnType<typeof runAgent>>;
    });

    const s = await createSession();
    const { POST } = await import("@/app/api/chat/route");
    const events = await readAllEvents(
      await POST(
        new Request("http://localhost/api/chat", {
          method: "POST",
          body: JSON.stringify({ sessionId: s.id, message: "hi" }),
        })
      )
    );
    expect(events.map((e) => e.event)).toContain("done");
    const context = events.find((e) => e.event === "context")?.data as { pageTable: { title: string }[] };
    expect(context.pageTable.map((p) => p.title)).toEqual(["paged out"]);
    expect((await getMessages(s.id)).map((m) => m.content)).toEqual(["hi", "ok"]);
  });

  it("releases the session lock when the turn fails", async () => {
    const { runAgent } = await import("@agent/agent");
    vi.mocked(runAgent).mockImplementationOnce(async () => {
      throw new Error("boom");
    });

    const s = await createSession();
    const { POST } = await import("@/app/api/chat/route");
    const post = () =>
      POST(
        new Request("http://localhost/api/chat", {
          method: "POST",
          body: JSON.stringify({ sessionId: s.id, message: "hi" }),
        })
      );

    const failed = await readAllEvents(await post());
    expect(failed.find((e) => e.event === "error")?.data).toMatchObject({ message: "boom" });

    const next = await post();
    expect(next.status).toBe(200);
    await readAllEvents(next);
  });
});
