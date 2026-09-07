import { defineConfig } from "@playwright/test";

// E2E melawan production build (dist/web) via `vite preview` yang dikelola
// Playwright sendiri (webServer), dengan seluruh /api/** di-stub — tanpa
// provider AI, router, atau kredensial nyata.
export default defineConfig({
  testDir: "tooling/e2e",
  timeout: 60_000,
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" },
  webServer: {
    command: "bun run --cwd apps/web preview -- --port 3100 --strictPort",
    url: "http://localhost:3100",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
