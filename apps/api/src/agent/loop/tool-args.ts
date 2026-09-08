import type { Database } from "../../db";
import { toolExecutions } from "../../db/schema";
import type { ChatMessage, ChatToolCall } from "../chat-client";
import type { StartRunInput } from "./types";

/** WAIT for complete arguments: parse JSON; incomplete → typed error, never executed. */
export async function parseToolArgs(
  db: Database,
  input: StartRunInput,
  call: ChatToolCall,
  chatHistory: ChatMessage[],
): Promise<{ ok: true; args: unknown } | { ok: false }> {
  let args: unknown;
  try {
    args = call.argumentsJson && call.argumentsJson.trim() ? JSON.parse(call.argumentsJson) : {};
  } catch {
    let recovered = false;
    if (typeof call.argumentsJson === "string") {
      const trimmed = call.argumentsJson.trim();
      const match = trimmed.match(/^\{[\s\S]*?\}(?=\{|$)/);
      if (match) {
        try {
          args = JSON.parse(match[0]);
          recovered = true;
        } catch {
          recovered = false;
        }
      }
    }
    if (!recovered) {
      const msg = "Argumen tool bukan JSON lengkap — tidak dieksekusi.";
      await db
        .insert(toolExecutions)
        .values({
          runId: input.runId,
          toolCallId: call.id,
          toolName: call.name,
          risk: "unknown",
          sanitizedInput: null,
          resultSummary: msg,
          status: "rejected",
          errorCode: "VALIDATION_FAILED",
        })
        .onConflictDoNothing();
      chatHistory.push({ role: "tool", content: JSON.stringify({ error: "VALIDATION_FAILED", message: msg }), toolCallId: call.id });
      return { ok: false };
    }
  }
  return { ok: true, args };
}
