import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { simulateReadableStream, type ModelMessage } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { createTools, runAgent } from "../src/agent.js";
import { withSession } from "../src/storage.js";
import { closePool } from "../src/db.js";
import { resetDb, makeTestSession } from "./helpers/db.js";

describe("createTools", () => {
  it("returns all 7 tools", () => {
    const tools = createTools();
    const names = Object.keys(tools);
    expect(names).toHaveLength(7);
    expect(names).toContain("page_out");
    expect(names).toContain("page_in");
    expect(names).toContain("page_table");
    expect(names).toContain("page_update");
    expect(names).toContain("page_free");
    expect(names).toContain("page_move");
    expect(names).toContain("page_merge");
  });

  it("all tools have descriptions", () => {
    const tools = createTools();
    for (const [name, t] of Object.entries(tools)) {
      expect(t.description, `${name} should have a description`).toBeTruthy();
    }
  });

  it("all tools have input schemas", () => {
    const tools = createTools();
    for (const [name, t] of Object.entries(tools)) {
      expect(t.inputSchema, `${name} should have an inputSchema`).toBeDefined();
    }
  });

  it("all tools have execute functions", () => {
    const tools = createTools();
    for (const [name, t] of Object.entries(tools)) {
      expect(typeof t.execute, `${name} should have execute`).toBe("function");
    }
  });

  it("page_out requires title, content, and summary", () => {
    const tools = createTools();
    const schema = tools.page_out.inputSchema as any;
    const shape = schema._def?.shape?.() || schema.shape;
    expect(shape.title).toBeDefined();
    expect(shape.content).toBeDefined();
    expect(shape.summary).toBeDefined();
  });

  it("page_in requires id", () => {
    const tools = createTools();
    const schema = tools.page_in.inputSchema as any;
    const shape = schema._def?.shape?.() || schema.shape;
    expect(shape.id).toBeDefined();
  });

  it("page_merge requires source_ids and target_id", () => {
    const tools = createTools();
    const schema = tools.page_merge.inputSchema as any;
    const shape = schema._def?.shape?.() || schema.shape;
    expect(shape.source_ids).toBeDefined();
    expect(shape.target_id).toBeDefined();
  });
});

// --- runAgent with a mocked model ---

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

function toolCallStep(calls: { id: string; input: Record<string, unknown> }[]) {
  return [
    { type: "stream-start", warnings: [] },
    ...calls.map((c) => ({
      type: "tool-call",
      toolCallId: c.id,
      toolName: "page_out",
      input: JSON.stringify(c.input),
    })),
    { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage },
  ];
}

function textStep(text: string) {
  return [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t" },
    { type: "text-delta", id: "t", delta: text },
    { type: "text-end", id: "t" },
    { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
  ];
}

function mockModel(steps: unknown[][]) {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({ chunks: steps[call++] as any[] }),
    }),
  });
}

function pageOutInput(title: string, swap_count: number) {
  return { title, content: `${title} body`, summary: `${title} summary`, swap_count };
}

function orphanedToolCalls(messages: ModelMessage[]): string[] {
  const calls = new Set<string>();
  const results = new Set<string>();
  for (const m of messages) {
    if (typeof m.content === "string") continue;
    for (const part of m.content) {
      if (part.type === "tool-call") calls.add(part.toolCallId);
      if (part.type === "tool-result") results.add(part.toolCallId);
    }
  }
  return [...calls].filter((id) => !results.has(id)).concat([...results].filter((id) => !calls.has(id)));
}

const history: ModelMessage[] = [
  { role: "user", content: "explain auth" },
  { role: "assistant", content: "auth explanation" },
  { role: "user", content: "and the token bug?" },
  { role: "assistant", content: "token bug details" },
  { role: "user", content: "page that out" },
];

describe("runAgent page_out swapping", () => {
  let sid: string;

  beforeEach(async () => {
    await resetDb();
    sid = await makeTestSession();
  });

  afterAll(async () => {
    await closePool();
  });

  function stub(m: ModelMessage | undefined): string {
    return typeof m?.content === "string" ? m.content : "";
  }

  function expectTurnIntact(messages: ModelMessage[], answer: string) {
    const userIdx = messages.findIndex((m) => m.content === "page that out");
    expect(userIdx).toBeGreaterThan(-1);
    const turn = messages.slice(userIdx + 1);
    expect(turn[0].role).toBe("assistant");
    expect(turn[1].role).toBe("tool");
    expect(turn[turn.length - 1]).toMatchObject({ role: "assistant" });
    expect(JSON.stringify(turn[turn.length - 1].content)).toContain(answer);
    expect(orphanedToolCalls(messages)).toEqual([]);
  }

  it("swap_count=1 pages out the last older message and keeps the answer", async () => {
    const model = mockModel([toolCallStep([{ id: "c1", input: pageOutInput("Token", 1) }]), textStep("Saved it.")]);
    const result = await withSession(sid, () => runAgent([...history], { model }));

    expect(result.response).toBe("Saved it.");
    expect(result.messages.slice(0, 3)).toEqual(history.slice(0, 3));
    expect(stub(result.messages[3])).toContain('[Paged out → Page 1: "Token"');
    expect(result.messages[4]).toEqual(history[4]);
    expectTurnIntact(result.messages, "Saved it.");
  });

  it("swap_count=2 removes two older messages and leaves no orphaned tool call", async () => {
    const model = mockModel([toolCallStep([{ id: "c1", input: pageOutInput("Token", 2) }]), textStep("Done.")]);
    const result = await withSession(sid, () => runAgent([...history], { model }));

    expect(result.messages.slice(0, 2)).toEqual(history.slice(0, 2));
    expect(stub(result.messages[2])).toContain("Page 1");
    expect(result.messages[3]).toEqual(history[4]);
    expectTurnIntact(result.messages, "Done.");
  });

  it("two page_outs in one turn page out consecutive older blocks", async () => {
    const model = mockModel([
      toolCallStep([{ id: "c1", input: pageOutInput("Token", 2) }]),
      toolCallStep([{ id: "c2", input: pageOutInput("Auth", 2) }]),
      textStep("Both saved."),
    ]);
    const result = await withSession(sid, () => runAgent([...history], { model }));

    expect(stub(result.messages[0])).toContain('Page 2: "Auth"');
    expect(stub(result.messages[1])).toContain('Page 1: "Token"');
    expect(result.messages[2]).toEqual(history[4]);
    expectTurnIntact(result.messages, "Both saved.");
    // Both page_out call/result pairs of the turn survive.
    const turnText = JSON.stringify(result.messages.slice(3));
    expect(turnText).toContain('"toolCallId":"c1"');
    expect(turnText).toContain('"toolCallId":"c2"');
  });
});
