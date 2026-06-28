import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for Limn's UI/UX QA and agentic debugging.
 *
 * The app is a Tauri + React + Vite desktop app, but the frontend is a normal
 * web app served by Vite. The `?limnE2e` harness (src/testHarness.ts) mocks all
 * Tauri IPC in the browser, so Playwright drives the real UI against the dev
 * server without needing a Tauri window. The harness only loads in Vite DEV
 * mode, so `webServer` runs `npm run dev:vite` (not a production build).
 */
const PORT = 1420;
const HOST = "127.0.0.1";
const baseURL = `http://${HOST}:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // Each test starts from a clean harness, so order independence is expected.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { open: "never" }], ["list"]],
  outputDir: "./test-results",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command: "npm run dev:vite",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
