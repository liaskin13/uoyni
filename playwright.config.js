import { defineConfig, devices } from "@playwright/test";

// Minimal Playwright setup — one smoke test proves the harness works
// (rides alongside the Quantize feature per /plan-eng-review D12b).
//
// !! SAFETY: this repo's .env points VITE_UPLOAD_WORKER_URL at the REAL
// production Cloudflare Worker (psc-upload-worker.psoulc.workers.dev), not
// a local/mock backend. There is no isolated test environment — every test
// here runs against D's real production data. Read-only flows (login,
// navigation, reading track state) and client-local-only state (Quantize
// toggle — session React state; hot cues — localStorage only) are safe.
// NEVER write a test that triggers a PATCH /tracks/:id (octave-correct,
// beatgrid anchor drag/insert, any inline-edit save) — CI runs this suite
// on every push/PR, and a write-triggering test would corrupt real track
// metadata on a schedule, not just once. See TODOS.md for the isolated
// test-backend gap this constraint is standing in for.
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
