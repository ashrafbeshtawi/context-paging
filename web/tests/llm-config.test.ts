import { beforeEach, describe, expect, it } from "vitest";
import {
  EMPTY_CONFIG,
  loadConfig,
  saveConfig,
  clearConfig,
  toRequestBody,
} from "@/lib/llm-config";

describe("llm-config (localStorage helpers)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("loadConfig returns EMPTY_CONFIG when nothing is stored", () => {
    expect(loadConfig()).toEqual(EMPTY_CONFIG);
  });

  it("save then load round-trips", () => {
    saveConfig({ apiKey: "k", provider: "openai", model: "gpt-4o" });
    expect(loadConfig()).toEqual({ apiKey: "k", provider: "openai", model: "gpt-4o" });
  });

  it("clearConfig removes the entry", () => {
    saveConfig({ apiKey: "k", provider: "openai", model: "" });
    clearConfig();
    expect(loadConfig()).toEqual(EMPTY_CONFIG);
  });

  it("loadConfig handles malformed JSON gracefully", () => {
    window.localStorage.setItem("context-paging.llm-config", "{not json");
    expect(loadConfig()).toEqual(EMPTY_CONFIG);
  });

  it("toRequestBody omits empty fields so the server falls back to env", () => {
    expect(toRequestBody({ apiKey: "k", provider: "", model: "" })).toEqual({ apiKey: "k" });
    expect(toRequestBody({ apiKey: "", provider: "openai", model: "" })).toEqual({ provider: "openai" });
    expect(toRequestBody(EMPTY_CONFIG)).toEqual({});
  });
});
