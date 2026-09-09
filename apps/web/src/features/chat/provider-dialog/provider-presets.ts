export interface DialogProviderConfig {
  id?: string;
  kind: "gemini" | "openrouter" | "custom";
  name: string;
  baseUrl?: string;
  models?: string[];
  activeModel?: string;
  hasKey?: boolean;
  enabled?: boolean;
}

export const PRESET_RECOMMENDATIONS: Record<string, string[]> = {
  gemini: ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.5-flash"],
  openrouter: [
    "anthropic/claude-3.5-sonnet",
    "deepseek/deepseek-chat",
    "meta-llama/llama-3.3-70b-instruct",
    "google/gemini-2.0-flash-001",
    "openai/gpt-4o-mini",
  ],
  custom: ["llama3.2:latest", "mistral:latest", "qwen2.5:latest"],
};
