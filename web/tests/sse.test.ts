import { describe, expect, it } from "vitest";
import { parseEvent, parseSseStream } from "@/lib/sse";

describe("parseEvent", () => {
  it("parses event + data", () => {
    expect(parseEvent("event: text\ndata: {\"chunk\":\"hi\"}")).toEqual({
      event: "text",
      data: { chunk: "hi" },
    });
  });

  it("defaults to 'message' when no event line", () => {
    expect(parseEvent('data: {"x":1}')).toEqual({ event: "message", data: { x: 1 } });
  });

  it("returns null for invalid JSON", () => {
    expect(parseEvent("event: x\ndata: not-json")).toBeNull();
  });

  it("returns null when no data line is present", () => {
    expect(parseEvent("event: x")).toBeNull();
  });
});

describe("parseSseStream", () => {
  it("yields events from a chunked stream", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      "event: text\ndata: {\"chunk\":\"he",
      "llo\"}\n\nevent: done\ndata: {\"ok\":true}\n\n",
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(encoder.encode(ch));
        c.close();
      },
    });
    const events: Array<{ event: string; data: unknown }> = [];
    for await (const e of parseSseStream(stream.getReader())) events.push(e);
    expect(events).toEqual([
      { event: "text", data: { chunk: "hello" } },
      { event: "done", data: { ok: true } },
    ]);
  });
});
