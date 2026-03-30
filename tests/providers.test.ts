import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveModel } from "../src/providers.js";

const originalEnv = { ...process.env };

afterEach(() => {
  // Restore original env
  process.env = { ...originalEnv };
});

describe("resolveModel", () => {
  it("resolves anthropic provider (installed as dev dep)", async () => {
    const model = await resolveModel("anthropic", "claude-sonnet-4-20250514");
    expect(model).toBeDefined();
    expect(model.modelId).toBe("claude-sonnet-4-20250514");
  });

  it("uses AI_PROVIDER env var when no args given", async () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.AI_MODEL = "claude-haiku-4-5-20251001";
    const model = await resolveModel();
    expect(model).toBeDefined();
    expect(model.modelId).toBe("claude-haiku-4-5-20251001");
  });

  it("defaults to anthropic when no provider specified", async () => {
    delete process.env.AI_PROVIDER;
    delete process.env.AI_MODEL;
    const model = await resolveModel();
    expect(model).toBeDefined();
    expect(model.modelId).toBe("claude-sonnet-4-20250514");
  });

  it("throws for unknown provider", async () => {
    await expect(resolveModel("nonexistent")).rejects.toThrow("Unknown provider");
  });

  it("throws with helpful message for uninstalled provider", async () => {
    await expect(resolveModel("xai", "grok-3")).rejects.toThrow(
      /requires package.*@ai-sdk\/xai.*npm install/s
    );
  });

  it("function args override env vars", async () => {
    process.env.AI_PROVIDER = "xai";
    process.env.AI_MODEL = "grok-3";
    // anthropic is installed, so this should work despite env saying xai
    const model = await resolveModel("anthropic", "claude-sonnet-4-20250514");
    expect(model.modelId).toBe("claude-sonnet-4-20250514");
  });
});
