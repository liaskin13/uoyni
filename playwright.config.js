import { defineConfig, devices } from "@playwright/test";

// Minimal Playwright setup — one smoke test proves the harness works
// (rides alongside the Quantize feature per /plan-eng-review D12b).
// Full E2E spec set (Quantize/detector/beatgrid flows) lands after the
// beatgrid editor UI is stable — see TODOS.md / plan T9.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
