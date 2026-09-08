import { AppError } from "../lib/errors";
import { estimateTokens } from "./context";
import type { CompactionDeps } from "./compaction-types";
import { SUMMARY_SYSTEM, buildTranscript, buildTranscriptItems, type MessageRow } from "./compaction-prompt";

/** Assembly prompt + pemanggilan provider untuk satu batch ringkasan. */
export async function summarizeWithProvider(
  deps: Pick<CompactionDeps, "getProvider">,
  input: {
    userId: string;
    prev: { version: number; summary: string } | null;
    toSummarize: MessageRow[];
    throughSeq: number;
  },
): Promise<{
  summaryText: string;
  tokenBefore: number;
  tokenAfter: number;
  sourceHash: string;
  model: string;
  provider: string;
}> {
  const { items, sourceHash, tokenBefore } = buildTranscriptItems(input.toSummarize, input.throughSeq);
  const resolved = await deps.getProvider(input.userId);
  if (!resolved) {
    throw new AppError("PROVIDER_NOT_CONFIGURED", "Provider AI belum dikonfigurasi; compact dibatalkan.", 400);
  }
  const transcript = buildTranscript(input.prev, items);

  let summaryText = "";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    for await (const ev of resolved.client.stream({
      messages: [
        { role: "system", content: SUMMARY_SYSTEM },
        { role: "user", content: transcript },
      ],
      tools: [],
      maxTokens: 1500,
      signal: controller.signal,
    })) {
      if (ev.type === "text" && ev.text) summaryText += ev.text;
      if (ev.type === "done") break;
    }
  } finally {
    clearTimeout(timeout);
  }
  summaryText = summaryText.trim();
  if (!summaryText) throw new Error("model mengembalikan ringkasan kosong");

  const tokenAfter = estimateTokens(summaryText.length);
  return { summaryText, tokenBefore, tokenAfter, sourceHash, model: resolved.model, provider: resolved.provider };
}
