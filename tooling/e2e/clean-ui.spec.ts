import { test, expect } from "@playwright/test";

// UI chat clean: headline manusiawi, detail tertutup default, status antrean,
// tanpa dump mentah — dengan API di-stub dan SSE live dipalsukan.
// Dijalankan via: bunx playwright test tooling/e2e/clean-ui.spec.ts
// (webServer preview dikelola playwright.config.ts)
test("clean tool UI: headline manusiawi, detail tertutup, tanpa dump mentah", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));

  const conversationId = "00000000-0000-4000-8000-000000000011";
  const runId = "00000000-0000-4000-8000-000000000012";
  await page.addInitScript(() => {
    class TestEventSource extends EventTarget {
      static instances: TestEventSource[] = [];
      readyState = 1;
      onmessage: unknown = null;
      onerror: unknown = null;
      constructor(public url: string) { super(); TestEventSource.instances.push(this); }
      close() { this.readyState = 2; }
    }
    Object.assign(window, { EventSource: TestEventSource, testSources: TestEventSource.instances });
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body: unknown = {};
    if (path === "/api/auth/me") body = { profile: { username: "e2e" } };
    else if (path === "/api/connectors") body = { connectors: [] };
    else if (path === "/api/ai-provider") body = { providers: [] };
    else if (path === "/api/conversations" && request.method() === "POST") body = { conversation: { id: conversationId, title: "E2E", activeConnectionId: null } };
    else if (path === "/api/conversations") body = { conversations: [] };
    else if (path.endsWith("/messages")) body = { messages: [] };
    else if (path.endsWith("/activities")) body = { events: [], nextCursor: null };
    else if (path.endsWith("/compaction")) body = { summary: null, jobs: [] };
    else if (path.endsWith("/context")) body = { usage: null };
    else if (path.endsWith("/runs")) body = { runId, status: "queued" };
    else if (path === `/api/conversations/${conversationId}`) body = { conversation: { id: conversationId, title: "E2E", activeConnectionId: null } };
    await route.fulfill({ status: request.method() === "POST" ? 201 : 200, json: body });
  });

  await page.goto("/");
  await page.locator("textarea").fill("cek interface dan ip address");
  await page.getByRole("button", { name: "Kirim pesan", exact: true }).click();
  await page.waitForFunction(() => (window as unknown as { testSources: { readyState: number }[] }).testSources.some((es) => es.readyState === 1));

  // Simulasi run live bertahap: antrean provider dulu, lalu 6 tool baca + jawaban.
  const sendEvents = (events: { type: string; seq: number; payload: unknown }[]) => page.evaluate(({ runId, events }) => {
    const es = (window as unknown as { testSources: { dispatchEvent: (e: Event) => void }[] }).testSources.findLast(() => true);
    for (const event of events) {
      es.dispatchEvent(new MessageEvent(event.type, { data: JSON.stringify({ runId, seq: event.seq, payload: event.payload }) }));
    }
  }, { runId, events });
  await sendEvents([
    { type: "run.started", seq: 1, payload: {} },
    { type: "provider.waiting", seq: 2, payload: { waitedMs: 2000 } },
  ]);

  // Status antrean tampil sebagai teks, bukan log internal.
  await expect(page.getByText(/Menunggu giliran provider/)).toBeVisible();

  const tools = ["mt:list_interfaces", "mt:list_ip_addresses", "mt:list_routes", "mt:get_dhcp_clients", "mt:list_firewall_nat", "mt:list_firewall_rules"];
  const rest: { type: string; seq: number; payload: unknown }[] = [];
  let seq = 3;
  for (const name of tools) {
    rest.push({ type: "tool.started", seq: seq++, payload: { name, callId: `c-${name}` } });
    rest.push({ type: "tool.completed", seq: seq++, payload: { name, callId: `c-${name}`, summary: "ok", durationMs: 12 } });
  }
  rest.push({ type: "message.delta", seq: seq++, payload: { text: "Ada 4 interface, semua running." } });
  await sendEvents(rest);
  // Headline fase manusiawi + hitungan selesai.
  await expect(page.getByText(/Memeriksa konfigurasi router/)).toBeVisible();
  await expect(page.getByText(/6 dari 6|6 selesai/)).toBeVisible();
  // Detail teknis tertutup di balik disclosure — buka untuk verifikasi isi.
  await expect(page.getByText("Lihat detail").first()).toBeVisible();
  await page.getByText("Lihat detail").first().click();
  // Nama tool manusiawi, bukan mt:invoke_tool.
  await expect(page.getByText("Membaca IP address")).toBeVisible();
  await expect(page.getByText("Membaca NAT")).toBeVisible();
  await expect(page.getByText("mt:invoke_tool")).toHaveCount(0);
  await expect(page.getByText(/jawaban gagal/)).toHaveCount(0);
  // Jawaban AI tampil sebagai pesan normal.
  await expect(page.getByText("Ada 4 interface, semua running.")).toBeVisible();
  expect(errors).toEqual([]);
});

for (const width of [320, 360, 768, 1024, 1440]) {
  test(`layout chat tanpa overflow pada ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/auth/me") {
        await route.fulfill({ status: 200, json: { profile: { username: "e2e" } } });
        return;
      }
      if (path === "/api/ai-provider") {
        await route.fulfill({ status: 200, json: { providers: [] } });
        return;
      }
      if (path === "/api/connectors") {
        await route.fulfill({ status: 200, json: { connectors: [] } });
        return;
      }
      await route.fulfill({ status: 200, json: { conversations: [], messages: [], events: [], jobs: [], summary: null, usage: null } });
    });
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await page.waitForTimeout(800);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
    await page.screenshot({ path: `test-results/chat-${width}.png` });
  });
}
