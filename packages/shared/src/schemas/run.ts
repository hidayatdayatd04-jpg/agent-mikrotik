import { z } from "zod";

/** Structured Deep Research payload for the chat canvas (web: tool results). */
export interface ResearchSource {
  title: string;
  url: string;
  snippet: string;
}

export interface ResearchResult {
  query: string;
  answer: string | null;
  sources: ResearchSource[];
}

export const RunEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run.started"), seq: z.number().int() }),
  z.object({ type: z.literal("message.delta"), seq: z.number().int(), text: z.string() }),
  z.object({ type: z.literal("tool.started"), seq: z.number().int(), tool: z.string() }),
  z.object({
    type: z.literal("tool.completed"),
    seq: z.number().int(),
    tool: z.string(),
    summary: z.string(),
  }),
  z.object({
    type: z.literal("tool.failed"),
    seq: z.number().int(),
    tool: z.string(),
    summary: z.string(),
  }),
  z.object({
    type: z.literal("transaction.updated"),
    seq: z.number().int(),
    state: z.string(),
    detail: z.string(),
  }),
  z.object({ type: z.literal("run.completed"), seq: z.number().int() }),
  z.object({ type: z.literal("run.failed"), seq: z.number().int(), summary: z.string() }),
  z.object({ type: z.literal("run.cancelled"), seq: z.number().int() }),
  z.object({ type: z.literal("heartbeat"), seq: z.number().int() }),
]);

export type RunEvent = z.infer<typeof RunEventSchema>;

export const AttachmentDTOSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string(),
  sizeBytes: z.number().int(),
  contentType: z.string(),
  status: z.enum(["uploading", "ready", "failed"]),
  createdAt: z.string().datetime(),
});

export type AttachmentDTO = z.infer<typeof AttachmentDTOSchema>;
export interface ModelLimitStatus {
  status: "available" | "limited" | "error";
  observedAt: string;
  retryAt: string | null;
  requestsLimit: number | null;
  requestsRemaining: number | null;
  tokensLimit: number | null;
  tokensRemaining: number | null;
  /** Status RPD harian — hanya bila provider menyediakannya; null bila tak ada. */
  dailyLimit?: number | null;
  dailyRemaining?: number | null;
  dailyResetAt?: string | null;
  /** True bila observasi terakhir mengindikasikan kuota harian habis. */
  isDailyQuotaExhausted?: boolean;
}
