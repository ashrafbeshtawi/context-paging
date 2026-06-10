// Client-side LLM credential storage. Lives in localStorage only;
// the server never persists these values. Sent on each chat request.

export interface LlmConfig {
  apiKey: string;
  provider: string;
  model: string;
}

const STORAGE_KEY = "context-paging.llm-config";

export const EMPTY_CONFIG: LlmConfig = { apiKey: "", provider: "", model: "" };

export const PROVIDER_OPTIONS = [
  { value: "", label: "(use server .env)" },
  { value: "anthropic", label: "Anthropic" },
  { value: "openai", label: "OpenAI" },
  { value: "google", label: "Google" },
  { value: "mistral", label: "Mistral" },
  { value: "xai", label: "xAI" },
];

export function loadConfig(): LlmConfig {
  if (typeof window === "undefined") return EMPTY_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_CONFIG;
    const parsed = JSON.parse(raw) as Partial<LlmConfig>;
    return {
      apiKey: parsed.apiKey || "",
      provider: parsed.provider || "",
      model: parsed.model || "",
    };
  } catch {
    return EMPTY_CONFIG;
  }
}

export function saveConfig(config: LlmConfig): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function clearConfig(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

// Filter out empty fields so the server falls back to env per-field.
export function toRequestBody(config: LlmConfig): Partial<LlmConfig> {
  const body: Partial<LlmConfig> = {};
  if (config.apiKey) body.apiKey = config.apiKey;
  if (config.provider) body.provider = config.provider;
  if (config.model) body.model = config.model;
  return body;
}
