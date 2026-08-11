import { defineConfig, devices } from "@playwright/test";

// Minimal Playwright setup. The suite is intentionally small — we only ship
// tests where a broken behaviour has previously reached production. The
// floating player regression (PR #103) is the first such case.
//
// BASE_URL override lets you point the same tests at a Vercel preview URL:
//   BASE_URL=https://melori-next-git-<branch>-melori.vercel.app pnpm test:e2e
// Without it we spin up `next dev` locally.
// `||` rather than `??`: CI exports BASE_URL as an empty string on the
// build-and-serve path, and an empty base URL is not a base URL.
const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3000";

// Reuse is OFF by default, including locally. A server left running from an
// earlier branch or an earlier build silently serves the wrong code, and the
// suite then reports green (or red) for something other than the working tree.
// Opt in explicitly with PW_REUSE_SERVER=1 when you know the running server is
// the current build. CI never reused a server, so its behaviour is unchanged.
const REUSE_SERVER = process.env.PW_REUSE_SERVER === "1";

// Locally `next dev` is the convenient default, but a production build is the
// only faithful target for hydration-dependent tests. PW_SERVER_COMMAND lets a
// local run mirror CI exactly:
//   npm run build && PW_SERVER_COMMAND="npm run start" npx playwright test
const SERVER_COMMAND =
  process.env.PW_SERVER_COMMAND ||
  (process.env.CI ? "npm run start" : "npm run dev");

// When pointed at an SSO-protected Vercel preview, send the automation bypass
// token (Vercel: "Protection Bypass for Automation") so requests aren't
// redirected to the vercel.com login gate. Absent the token this is a no-op.
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const extraHTTPHeaders = BYPASS
  ? {
      "x-vercel-protection-bypass": BYPASS,
      "x-vercel-set-bypass-cookie": "true",
    }
  : undefined;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // One retry. The generous retry budget existed for cold Vercel serverless
  // starts; CI now serves a local build, so a failure here is a real failure
  // and re-running it just burns the job's time budget.
  retries: 1,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  // A genuinely missing element costs one timeout per attempt, so an across-
  // the-board breakage used to grind through every test and get killed at the
  // job deadline with no summary. Bailing after three bounds the worst case to
  // ~4.5 min and guarantees the failures actually get reported.
  maxFailures: process.env.CI ? 3 : undefined,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    extraHTTPHeaders,
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
  // Only start a server when we're pointing at localhost; against a deployed
  // URL we skip webServer entirely. CI builds first and serves the production
  // output, so the suite exercises the same code path a user gets — and, more
  // importantly, the commit under test rather than whatever is deployed.
  webServer: BASE_URL.startsWith("http://127.0.0.1")
    ? {
        command: SERVER_COMMAND,
        url: BASE_URL,
        reuseExistingServer: REUSE_SERVER,
        timeout: 120_000,
      }
    : undefined,
});
