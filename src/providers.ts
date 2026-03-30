import type { LanguageModel } from "ai";

export type ProviderName = "anthropic" | "openai" | "google" | "mistral" | "amazon-bedrock" | "azure" | "xai";

interface ProviderConfig {
  package: string;
  exportName: string;
}

const PROVIDERS: Record<ProviderName, ProviderConfig> = {
  anthropic: { package: "@ai-sdk/anthropic", exportName: "anthropic" },
  openai: { package: "@ai-sdk/openai", exportName: "openai" },
  google: { package: "@ai-sdk/google", exportName: "google" },
  mistral: { package: "@ai-sdk/mistral", exportName: "mistral" },
  "amazon-bedrock": { package: "@ai-sdk/amazon-bedrock", exportName: "bedrock" },
  azure: { package: "@ai-sdk/azure", exportName: "azure" },
  xai: { package: "@ai-sdk/xai", exportName: "xai" },
};

const DEFAULT_MODELS: Partial<Record<ProviderName, string>> = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4o",
  google: "gemini-2.0-flash",
  mistral: "mistral-large-latest",
  xai: "grok-3",
};

export async function resolveModel(
  provider?: string,
  model?: string
): Promise<LanguageModel> {
  const providerName = (provider || process.env.AI_PROVIDER || "anthropic") as ProviderName;
  const modelId = model || process.env.AI_MODEL || DEFAULT_MODELS[providerName] || "";

  const config = PROVIDERS[providerName];
  if (!config) {
    const supported = Object.keys(PROVIDERS).join(", ");
    throw new Error(
      `Unknown provider "${providerName}". Supported: ${supported}`
    );
  }

  let providerModule: Record<string, unknown>;
  try {
    providerModule = await import(config.package) as Record<string, unknown>;
  } catch {
    throw new Error(
      `Provider "${providerName}" requires package "${config.package}". Install it:\n\n  npm install ${config.package}\n`
    );
  }

  const factory = providerModule[config.exportName] as (id: string) => LanguageModel;
  if (typeof factory !== "function") {
    throw new Error(
      `Could not find "${config.exportName}" export in "${config.package}".`
    );
  }

  return factory(modelId);
}
