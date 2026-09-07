import { test, expect } from "@playwright/test";

// Run against `bun run dev`: bunx playwright test tooling/e2e/chat-regressions.spec.ts
// Browser requests are stubbed, so these regressions do not contact an AI provider/router.
test("StrictMode sends the initial prompt once and SSE replay does not duplicate UI", async ({ page }) => {
  let runRequests = 0;
  const conversationId = "00000000-0000-4000-8000-000000000001";
  const runId = "00000000-0000-4000-8000-000000000002";
  await page.addInitScript(() => {
    class TestEventSource extends EventTarget {
      static instances: TestEventSource[] = [];
      readyState = 1;
      onmessage = null;
      onerror = null;
      constructor(public url: string) { super(); TestEventSource.instances.push(this); }
      close() { this.readyState = 2; }
    }
    Object.assign(window, { EventSource: TestEventSource, testSources: TestEventSource.instances });
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body: unknown = {};
    if (path === "/api/connectors") body = { connectors: [] };
    else if (path === "/api/ai-provider") body = { provider: null };
    else if (path === "/api/conversations" && request.method() === "POST") body = { conversation: { id: conversationId, title: "Regression", activeConnectionId: null } };
    else if (path === "/api/conversations") body = { conversations: [] };
    else if (path.endsWith("/messages")) body = { messages: [] };
    else if (path.endsWith("/runs")) { runRequests++; body = { runId, status: "queued" }; }
    else if (path === `/api/conversations/${conversationId}`) body = { conversation: { id: conversationId, title: "Regression", activeConnectionId: null } };
    await route.fulfill({ status: request.method() === "POST" ? 201 : 200, json: body });
  });
  await page.goto("http://localhost:3000");
  await page.locator("textarea").fill("Regression first prompt");
  await page.getByRole("button", { name: "Kirim pesan", exact: true }).click();
  await expect.poll(() => runRequests).toBe(1);
  await page.waitForFunction(() => (window as any).testSources.some((es: any) => es.readyState === 1));
  await page.evaluate(({ runId }) => {
    const es = (window as any).testSources.findLast((item: any) => item.readyState === 1);
    const events = [
      { type: "run.started", seq: 1, payload: {} },
      { type: "message.delta", seq: 2, payload: { text: "Streaming regression OK" } },
      { type: "tool.started", seq: 3, payload: { name: "regression:interfaces" } },
      { type: "tool.completed", seq: 4, payload: { name: "regression:interfaces" } },
    ];
    for (const event of [...events, ...events]) {
      // Real server wire format: type is the SSE event name, absent from JSON.
      es.dispatchEvent(new MessageEvent(event.type, { data: JSON.stringify({ runId, seq: event.seq, payload: event.payload }) }));
    }
  }, { runId });
  await expect(page.locator(".prose").filter({ hasText: "Streaming regression OK" })).toHaveText("Streaming regression OK");
  await expect(page.getByText("regression:interfaces", { exact: true })).toHaveCount(0);
  expect(runRequests).toBe(1);
});

test("useRunEvents cleanup does not finish a run, deduplicates events, and resets sequence on run switch", async ({ page }) => {
  await page.goto("http://localhost:3000");
  const result = await page.evaluate(async () => {
    // Import the real hook and the same React modules used by Vite.
    const { useRunEvents } = await import(/* @vite-ignore */ "/src/features/chat/use-run-events.ts");
    const { default: React } = await import(/* @vite-ignore */ "/node_modules/.vite/deps/react.js");
    const { default: { createRoot } } = await import(/* @vite-ignore */ "/node_modules/.vite/deps/react-dom_client.js");
    const { default: { flushSync } } = await import(/* @vite-ignore */ "/node_modules/.vite/deps/react-dom.js");
    const sources: any[] = [];
    class TestEventSource extends EventTarget {
      readyState = 1;
      constructor(public url: string) { super(); sources.push(this); }
      close() { this.readyState = 2; }
    }
    const original = window.EventSource;
    window.EventSource = TestEventSource as any;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let done = 0;
    let state: any;
    function Harness({ id }: { id: string }) { state = useRunEvents(id, () => done++); return null; }
    const render = (id: string) => flushSync(() => root.render(React.createElement(React.StrictMode, null, React.createElement(Harness, { id }))));
    const emit = (runId: string, seq: number, type: string, payload: unknown) => flushSync(() => sources.at(-1).dispatchEvent(new MessageEvent(type, { data: JSON.stringify({ runId, seq, payload }) })));
    try {
      render("first");
      const afterMount = done;
      emit("first", 1, "message.delta", { text: "hello" });
      emit("first", 1, "message.delta", { text: "hello" });
      emit("first", 2, "tool.started", { name: "interfaces" });
      emit("first", 2, "tool.started", { name: "interfaces" });
      emit("first", 3, "tool.completed", { name: "interfaces" });
      emit("first", 3, "tool.completed", { name: "interfaces" });
      const first = { text: state.streamText, count: state.events.length, tools: state.toolActivity };
      render("second");
      const afterSwitch = done;
      emit("second", 1, "message.delta", { text: "new" });
      emit("second", 2, "run.completed", {});
      const second = { text: state.streamText, count: state.events.length, live: state.live };
      flushSync(() => root.unmount());
      return { afterMount, afterSwitch, done, first, second };
    } finally { window.EventSource = original; host.remove(); }
  });
  expect(result).toEqual({ afterMount: 0, afterSwitch: 0, done: 1, first: { text: "hello", count: 3, tools: [{ name: "interfaces", status: "done" }] }, second: { text: "new", count: 2, live: false } });
});

test("composer has icon actions, a functional permission menu, logo thinking, and measured context", async ({ page }) => {
  const id = "00000000-0000-4000-8000-000000000010";
  const runId = "00000000-0000-4000-8000-000000000011";
  let mode = "read-only";
  let version = 7;
  let cancelled = false;
  let measured = false;
  let runBody: any;
  const modeRequests: any[] = [];
  await page.addInitScript(() => {
    const sources: any[] = [];
    class Source extends EventTarget {
      readyState = 1;
      constructor() { super(); sources.push(this); }
      close() { this.readyState = 2; }
    }
    Object.assign(window, { EventSource: Source, testSources: sources });
  });
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const connector = () => ({ id, label: "Lab", host: "192.0.2.1", status: "connected", mode, modeVersion: version });
    let body: any = {};
    if (path === "/api/connectors") body = { connectors: [connector()] };
    else if (path.endsWith("/mode")) { modeRequests.push(req.postDataJSON()); mode = req.postDataJSON().mode; version++; body = { connector: connector(), version }; }
    else if (path === "/api/ai-provider") body = { provider: { kind: "openrouter", model: "model-test", baseUrl: "https://provider.test/v1" } };
    else if (path === "/api/ai-provider/context") body = { context: { model: "model-test", modelLabel: "openrouter:model-test", contextWindow: 200000, contextBasis: "total" } };
    else if (path === "/api/conversations" && req.method() === "POST") body = { conversation: { id, title: "Test", activeConnectionId: id } };
    else if (path === "/api/conversations") body = { conversations: [] };
    else if (path.endsWith("/context")) body = { usage: measured ? { promptTokens: 12000, completionTokens: 1000, modelLabel: "openrouter:model-test", source: "provider" } : null };
    else if (path.endsWith("/files")) body = { attachment: { id: "00000000-0000-4000-8000-000000000012", originalName: "router.rsc", contentType: "text/plain", sizeBytes: 25, status: "ready" } };
    else if (path.endsWith("/messages")) body = { messages: [] };
    else if (path.endsWith("/cancel")) { cancelled = true; body = { ok: true }; }
    else if (path.endsWith("/runs")) { runBody = req.postDataJSON(); body = { runId, status: "queued" }; }
    else if (path === `/api/conversations/${id}`) body = { conversation: { id, title: "Test", activeConnectionId: id } };
    await route.fulfill({ json: body });
  });
  await page.goto("http://localhost:3000");
  await expect(page.getByRole("button", { name: "Kirim pesan", exact: true })).toHaveText("");
  await page.getByRole("button", { name: "Lampiran dan izin router" }).click();
  const toggle = page.getByRole("menuitemcheckbox", { name: "Izinkan perubahan" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  expect(modeRequests[0]).toEqual({ mode: "write", expectedVersion: 7 });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Tambahkan file" }).click();
  await (await chooser).setFiles({ name: "router.rsc", mimeType: "text/plain", buffer: Buffer.from("/interface print\n") });
  await expect(page.getByText("router.rsc", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Pesan untuk AI" }).fill("Periksa interface");
  await page.getByRole("button", { name: "Kirim pesan", exact: true }).click();
  await expect(page.getByRole("status", { name: "AI sedang berpikir" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hentikan jawaban" })).toHaveText("");
  expect(runBody.attachmentIds).toEqual(["00000000-0000-4000-8000-000000000012"]);
  await expect(page.getByText("Agent sedang aktif memproses", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Menganalisis pertanyaan", { exact: false })).toHaveCount(0);
  await expect(page.locator("header").getByText("Read-Only", { exact: false })).toHaveCount(0);
  measured = true;
  await expect(page.getByRole("button", { name: "Pemakaian context window" })).toContainText("6,5%", { timeout: 7000 });
  await page.getByRole("button", { name: "Pemakaian context window" }).click();
  await expect(page.getByText("200.000 token", { exact: true })).toBeVisible();
  await expect(page.getByText("12.000", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Hentikan jawaban" }).click();
  await expect.poll(() => cancelled).toBe(true);
  await page.evaluate(({ runId }) => {
    const source = (window as any).testSources.findLast((s: any) => s.readyState === 1);
    source.dispatchEvent(new MessageEvent("run.cancelled", { data: JSON.stringify({ runId, seq: 1, payload: {} }) }));
  }, { runId });
  await expect(page.getByRole("button", { name: "Kirim pesan", exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "AI sedang berpikir" })).toHaveCount(0);
});
