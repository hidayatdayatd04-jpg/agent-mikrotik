import { desc, eq } from "drizzle-orm";
import type { ChatClient } from "../../agent/chat-client";
import type { ProviderConfigWithKey } from "../../agent/provider-settings";
import { conversationSummaries } from "../../db/schema";
import type { ChatCtx, RunInput } from "./types";

/** Provider client per-run: mock bila belum dikonfigurasi, fallback kompatibel bila ada. */
export async function buildRunClient(
  ctx: ChatCtx,
  args: {
    cfg: ProviderConfigWithKey | null;
    userId: string;
    input: Pick<RunInput, "model" | "providerId" | "text">;
    runId: string;
    conversationId: string;
    policyMode: "read-only" | "write";
  },
): Promise<ChatClient> {
  const { deps } = ctx;
  if (!args.cfg) return deps.makeMockClient();
  let fallbackCandidates: { providerId: string; providerKind: string; model: string; enabled: boolean; baseUrl?: string; name?: string; apiKey?: string }[] = [];
  try {
    fallbackCandidates = (await deps.getFallbackCandidates?.(args.userId, args.input.model, args.input.providerId)) ?? [];
  } catch {
    fallbackCandidates = [];
  }
  return deps.makeClient(args.cfg, fallbackCandidates, {
    runId: args.runId,
    conversationId: args.conversationId,
    userId: args.userId,
    userText: args.input.text,
    policyMode: args.policyMode,
  });
}

/** Memory summary (data tak tepercaya, bukan otoritas): konteks compact terakhir. */
export async function loadMemorySummary(ctx: ChatCtx, conversationId: string): Promise<string | null> {
  try {
    const [sum] = await ctx.deps.db
      .select()
      .from(conversationSummaries)
      .where(eq(conversationSummaries.conversationId, conversationId))
      .orderBy(desc(conversationSummaries.version))
      .limit(1);
    if (sum) return String(sum.summary).slice(0, 6000);
  } catch {
    /* compact table may be missing in old test DBs */
  }
  return null;
}
