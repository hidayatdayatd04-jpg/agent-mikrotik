import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildRunTimeline } from "./run-timeline";
import { ChatPanel } from "./ChatPanel";
import { resolveProviderSelection } from "./provider-selection";
import { ModelLimitIndicator, modelLimitLabel } from "./ModelLimitIndicator";
import type { AiProviderDTO, RunEventDTO } from "./chat-hooks";

const events: RunEventDTO[] = [
  { runId: "r", seq: 1, type: "message.delta", payload: { text: "Saya akan memeriksa." } },
  { runId: "r", seq: 2, type: "tool.started", payload: { name: "system:check_connection", callId: "c1" } },
  { runId: "r", seq: 3, type: "tool.completed", payload: { callId: "c1", summary: "Terhubung" } },
  { runId: "r", seq: 4, type: "message.delta", payload: { text: "Router terhubung." } },
];

test("same model name on two providers preserves selected provider", () => {
  const providers = ["a", "b"].map((id) => ({ id, enabled: true, models: ["shared", "other"], activeModel: "other" })) as AiProviderDTO[];
  expect(resolveProviderSelection(providers, { providerId: "b", model: "shared" })).toEqual({ providerId: "b", model: "shared" });
  expect(resolveProviderSelection(providers, null)).toEqual({ providerId: "a", model: "other" });
});

test("live and persisted timelines keep text/tool/text order and deduplicate replay", () => {
  expect(buildRunTimeline([...events, events[1]!]).map((b) => b.kind)).toEqual(["text", "tool", "text"]);
  const running = buildRunTimeline(events.slice(0, 2), true)[1]!;
  expect(running.kind === "tool" && running.step.status).toBe("running");
  const completed = buildRunTimeline(events)[1]!;
  expect(completed.kind === "tool" && completed.step.status).toBe("completed");
  for (const live of [false, true]) {
    const html = renderToStaticMarkup(createElement(ChatPanel, {
      messages: live ? [] : [{ id: "m", role: "assistant", status: "complete", seq: 2, createdAt: "", content: { timeline: events, text: "Saya akan memeriksa. Router terhubung." } }],
      streamText: live ? "Saya akan memeriksa. Router terhubung." : "", toolActivity: [], runLive: live, liveEvents: live ? events : undefined,
    }));
    expect(html.indexOf("Saya akan memeriksa.")).toBeLessThan(html.indexOf("Memeriksa status koneksi"));
    expect(html.indexOf("Memeriksa status koneksi")).toBeLessThan(html.indexOf("Router terhubung."));
  }
});

test("failed greeting and empty transaction do not show a zero-step tool panel", () => {
  const html = renderToStaticMarkup(createElement(ChatPanel, { messages: [{ id: "m", role: "assistant", status: "failed", seq: 2, createdAt: "", content: { text: "Limit", runId: "r" } }], streamText: "", toolActivity: [], runLive: false, persistedActivities: [{ id: "t", activityId: "t", parentId: null, conversationId: "c", runId: "r", seq: 1, type: "transaction.updated", actor: "system", createdAt: "", payload: { state: "rolled_back", actions: 0 } }] }));
  expect(html).not.toContain("Proses");
});

test("quota progress is only rendered for known numeric limits and expires honestly", () => {
  expect(renderToStaticMarkup(createElement(ModelLimitIndicator, {}))).not.toContain("<progress");
  const data = { status: "limited" as const, observedAt: new Date().toISOString(), retryAt: null, requestsLimit: 20, requestsRemaining: 0, tokensLimit: null, tokensRemaining: null };
  expect(renderToStaticMarkup(createElement(ModelLimitIndicator, { data }))).toContain("100%");
  expect(modelLimitLabel({ ...data, retryAt: new Date(0).toISOString() })).toContain("coba ulang");
});
