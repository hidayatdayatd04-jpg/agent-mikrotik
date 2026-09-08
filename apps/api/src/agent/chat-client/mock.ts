import type { ChatClient } from "./types";

/** Explicit demo response when no provider has been configured. No tool calls. */
export function createMockClient(): ChatClient {
  return {
    modelLabel: "mock:local",
    async *stream(input) {
      const lastUser = [...input.messages].reverse().find((m) => m.role === "user");
      const text = `[MOCK PROVIDER] Provider AI belum dikonfigurasi. Pertanyaan Anda: "${lastUser?.content ?? ""}". Isi Gemini/OpenRouter/Custom melalui Provider AI untuk jawaban nyata.`;
      for (const word of text.split(" ")) yield { type: "text", text: word + " " };
      yield { type: "done", finishReason: "stop" };
    },
  };
}
