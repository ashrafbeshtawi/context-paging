import { describe, expect, it } from "vitest";
import { resolveModel, type ProviderName } from "@agent/providers.js";
import { PROVIDER_OPTIONS } from "@/lib/llm-config";

// Every provider the settings dialog offers must load; a missing SDK package
// would only show up when a user picks it.
describe("providers offered in the web UI", () => {
  const offered = PROVIDER_OPTIONS.map((option) => option.value).filter(Boolean) as ProviderName[];

  it.each(offered)("%s resolves a model", async (provider) => {
    const model = await resolveModel({ provider, apiKey: "test-key" });

    expect(model).toBeTruthy();
  });
});
