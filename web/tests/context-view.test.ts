import { describe, expect, it } from "vitest";
import { buildContextView } from "@/lib/context-view";
import type { ModelMessage } from "ai";

describe("buildContextView", () => {
  it("classifies a plain user message as text", () => {
    const msgs: ModelMessage[] = [{ role: "user", content: "hello world" }];
    const view = buildContextView(msgs);
    expect(view.messages).toHaveLength(1);
    expect(view.messages[0].kind).toBe("text");
    expect(view.messages[0].preview).toBe("hello world");
    expect(view.messages[0].chars).toBe("hello world".length);
    expect(view.totals.messages).toBe(1);
    expect(view.totals.pageRefs).toBe(0);
  });

  it("detects a paged-out reference and extracts page metadata", () => {
    const msgs: ModelMessage[] = [
      {
        role: "assistant",
        content: '[Paged out → Page 7: "Auth debugging" — Found JWT bug]',
      },
    ];
    const view = buildContextView(msgs);
    expect(view.messages[0].kind).toBe("paged-out-ref");
    expect(view.messages[0].pageRef).toEqual({
      id: 7,
      title: "Auth debugging",
      summary: "Found JWT bug",
    });
    expect(view.totals.pageRefs).toBe(1);
  });

  it("classifies assistant array content with tool-call as tool-call kind", () => {
    const msgs: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "let me check" },
          { type: "tool-call", toolCallId: "x", toolName: "page_out", input: {} },
        ],
      } as ModelMessage,
    ];
    const view = buildContextView(msgs);
    expect(view.messages[0].kind).toBe("tool-call");
    expect(view.messages[0].preview).toContain("[tool-call: page_out]");
  });

  it("classifies tool-role messages as tool-result", () => {
    const msgs: ModelMessage[] = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "x",
            toolName: "page_table",
            output: { type: "text", value: "Page table empty" },
          },
        ],
      } as ModelMessage,
    ];
    const view = buildContextView(msgs);
    expect(view.messages[0].kind).toBe("tool-result");
  });

  it("sums chars across all messages", () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: "abc" },
      { role: "assistant", content: "defgh" },
    ];
    const view = buildContextView(msgs);
    expect(view.totals.chars).toBe(8);
  });
});
