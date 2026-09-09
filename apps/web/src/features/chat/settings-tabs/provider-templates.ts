export type SettingsTab = "provider" | "safemode" | "about";

export const DEFAULT_PROVIDER_TEMPLATES = [
  {
    id: "gemini",
    kind: "gemini" as const,
    name: "Google Gemini",
    desc: "Endpoint OpenAI-compatible resmi Google. Cepat & cerdas.",
    tag: "Rekomendasi",
    defaultUrl: "https://generativelanguage.googleapis.com/v1beta/openai/v1",
    models: ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"],
    activeModel: "gemini-2.0-flash",
  },
  {
    id: "openrouter",
    kind: "openrouter" as const,
    name: "OpenRouter",
    desc: "Akses ratusan model AI (Claude, GPT, Llama, DeepSeek) dalam satu API key.",
    tag: "Multi-Model",
    defaultUrl: "https://openrouter.ai/api/v1",
    models: ["anthropic/claude-3.5-sonnet", "deepseek/deepseek-chat", "meta-llama/llama-3.3-70b-instruct"],
    activeModel: "anthropic/claude-3.5-sonnet",
  },
];
