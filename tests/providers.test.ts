import { describe, it, expect, afterEach } from "vitest";
import { resolveModel } from "../src/providers.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("resolveModel", () => {
  it("resolves anthropic provider via positional opts", async () => {
    const model = await resolveModel({ provider: "anthropic", model: "claude-sonnet-4-20250514" });
    expect(model).toBeDefined();
    expect(model.modelId).toBe("claude-sonnet-4-20250514");
  });

  it("uses AI_PROVIDER/AI_MODEL env vars when no args given", async () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.AI_MODEL = "claude-haiku-4-5-20251001";
    const model = await resolveModel();
    expect(model.modelId).toBe("claude-haiku-4-5-20251001");
  });

  it("defaults to anthropic when nothing is set", async () => {
    delete process.env.AI_PROVIDER;
    delete process.env.AI_MODEL;
    const model = await resolveModel();
    expect(model.modelId).toBe("claude-sonnet-4-20250514");
  });

  it("throws for unknown provider", async () => {
    await expect(resolveModel({ provider: "nonexistent" })).rejects.toThrow("Unknown provider");
  });

  it("throws with helpful message for uninstalled provider", async () => {
    await expect(resolveModel({ provider: "xai", model: "grok-3" })).rejects.toThrow(
      /requires package.*@ai-sdk\/xai.*npm install/s
    );
  });

  it("explicit args override env vars", async () => {
    process.env.AI_PROVIDER = "xai";
    process.env.AI_MODEL = "grok-3";
    const model = await resolveModel({ provider: "anthropic", model: "claude-sonnet-4-20250514" });
    expect(model.modelId).toBe("claude-sonnet-4-20250514");
  });

  it("resolves openrouter provider", async () => {
    const model = await resolveModel({ provider: "openrouter", model: "anthropic/claude-sonnet-4" });
    expect(model).toBeDefined();
    expect(model.modelId).toBe("anthropic/claude-sonnet-4");
  });

  it("openrouter defaults to the auto-router model", async () => {
    delete process.env.AI_MODEL;
    const model = await resolveModel({ provider: "openrouter" });
    expect(model.modelId).toBe("openrouter/auto");
  });

  it("openrouter apiKey override uses the createOpenRouter factory", async () => {
    const model = await resolveModel({
      provider: "openrouter",
      model: "openrouter/auto",
      apiKey: "test-key-not-real",
    });
    expect(model).toBeDefined();
    expect(model.modelId).toBe("openrouter/auto");
  });

  it("apiKey override uses the create-factory when SDK provides one", async () => {
    // Anthropic SDK exposes createAnthropic. Passing apiKey should succeed
    // without reading from env. We can't validate the actual key without
    // a real call, but we can verify the model object is constructed.
    const model = await resolveModel({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      apiKey: "test-key-not-real",
    });
    expect(model).toBeDefined();
    expect(model.modelId).toBe("claude-sonnet-4-20250514");
  });
});
