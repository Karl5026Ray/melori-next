import { defineConfig, devices } from "@playwright/test";

// Minimal Playwright setup. The suite is intentionally small — we only ship
// tests where a broken behaviour has previously reached production. The
// floating player regression (PR #103) is the first such case.
//
// BASE_URL override lets you point the same tests at a Vercel preview URL:
//   BASE_URL=https://melori-next-git-<branch>-melori.vercel.app pnpm test:e2e
// Without it we spin up `next dev` locally.
const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Two local retries (and three on CI) because the /music catalog is
  // force-dynamic and can be slow to render on cold Vercel serverless
  // starts — the tests themselves are deterministic once the page loads.
  retries: process.env.CI ? 3 : 2,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "mobile-chromium",
      // iPhone-ish 390x844 — matches the viewport in the original bug report.
      // Force chromium: the iPhone descriptor otherwise pins WebKit, which
      // pulls in extra browser binaries we don't need for a UI regression
      // that only cares about pointer-event semantics and z-index.
      use: {
        ...devices["iPhone 13"],
        defaultBrowserType: "chromium",
        browserName: "chromium",
      },
    },
  ],
  // Only start the dev server when we're pointing at localhost; against a
  // preview URL we skip webServer entirely.
  webServer: BASE_URL.startsWith("http://127.0.0.1")
    ? {
        command: "npm run dev",
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
});
