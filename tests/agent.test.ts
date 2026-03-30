import { describe, it, expect } from "vitest";
import { createTools } from "../src/agent.js";

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
