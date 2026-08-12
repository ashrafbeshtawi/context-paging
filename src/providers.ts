import type { LanguageModel } from "ai";

export type ProviderName = "anthropic" | "openai" | "google" | "mistral" | "amazon-bedrock" | "azure" | "xai";

interface ProviderConfig {
  package: string;
  exportName: string;
  // Factory-builder name when the SDK exposes `createX(config)` for per-call API keys.
  // If omitted, we fall back to the singleton export (which reads from env).
  createName?: string;
}

const PROVIDERS: Record<ProviderName, ProviderConfig> = {
  anthropic: { package: "@ai-sdk/anthropic", exportName: "anthropic", createName: "createAnthropic" },
  openai: { package: "@ai-sdk/openai", exportName: "openai", createName: "createOpenAI" },
  google: { package: "@ai-sdk/google", exportName: "google", createName: "createGoogleGenerativeAI" },
  mistral: { package: "@ai-sdk/mistral", exportName: "mistral", createName: "createMistral" },
  "amazon-bedrock": { package: "@ai-sdk/amazon-bedrock", exportName: "bedrock", createName: "createAmazonBedrock" },
  azure: { package: "@ai-sdk/azure", exportName: "azure", createName: "createAzure" },
  xai: { package: "@ai-sdk/xai", exportName: "xai", createName: "createXai" },
};

const DEFAULT_MODELS: Partial<Record<ProviderName, string>> = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4o",
  google: "gemini-2.0-flash",
  mistral: "mistral-large-latest",
  xai: "grok-3",
};

export interface ResolveModelOptions {
  provider?: string;
  model?: string;
  apiKey?: string;
}

export async function resolveModel(opts: ResolveModelOptions = {}): Promise<LanguageModel> {
  const providerName = (opts.provider || process.env.AI_PROVIDER || "anthropic") as ProviderName;
  const modelId = opts.model || process.env.AI_MODEL || DEFAULT_MODELS[providerName] || "";

  const config = PROVIDERS[providerName];
  if (!config) {
    const supported = Object.keys(PROVIDERS).join(", ");
    throw new Error(`Unknown provider "${providerName}". Supported: ${supported}`);
  }

  let providerModule: Record<string, unknown>;
  try {
    providerModule = (await import(config.package)) as Record<string, unknown>;
  } catch {
    throw new Error(
      `Provider "${providerName}" requires package "${config.package}". Install it:\n\n  npm install ${config.package}\n`
    );
  }

  // If the caller supplied an apiKey and the SDK has a create-factory, use it.
  // Otherwise fall back to the singleton export (which reads from env vars).
  if (opts.apiKey && config.createName) {
    const create = providerModule[config.createName] as
      | ((c: { apiKey: string }) => (id: string) => LanguageModel)
      | undefined;
    if (typeof create === "function") {
      const provider = create({ apiKey: opts.apiKey });
      return provider(modelId);
    }
  }

  const factory = providerModule[config.exportName] as (id: string) => LanguageModel;
  if (typeof factory !== "function") {
    throw new Error(`Could not find "${config.exportName}" export in "${config.package}".`);
  }
  return factory(modelId);
}
