import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSession, resetForTests } from "@/lib/sessions";
import { parseSseStream } from "@/lib/sse";

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

describe("/api/chat route", () => {
  let tmpDir: string;

  beforeEach(async () => {
    resetForTests();
    const os = await import("node:os");
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ctx-paging-chat-"));
    process.env.WEB_PAGES_ROOT = tmpDir;
  });

  afterEach(async () => {
    const fs = await import("node:fs/promises");
    await fs.rm(tmpDir, { recursive: true, force: true });
    delete process.env.WEB_PAGES_ROOT;
  });

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

  it("streams text, tool events, context and done", async () => {
    const s = createSession();
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
});
