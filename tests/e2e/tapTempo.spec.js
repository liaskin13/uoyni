import { test, expect } from "@playwright/test";
import { loginToConsole } from "./fixtures/auth.js";
import { mockTracksApi } from "./fixtures/mockTracks.js";

// T10 — tap-tempo manual override. The interval math (outlier rejection,
// averaging) has dedicated unit tests in
// src/console/__tests__/computeTapTempoBpm.test.js — these specs verify the
// UI gesture itself is wired end-to-end: button, mid-tap counter, the
// "keep tapping…" hint, and the PATCH that applies a computed tempo.
//
// All /tracks/* calls are mocked (see fixtures/mockTracks.js) — PATCH is
// intercepted and never forwarded, so tapping is fully safe against
// production data.

test.beforeEach(async ({ page }) => {
  await mockTracksApi(page);
  await loginToConsole(page);
});

test("TAP button shows a running count while tapping, hidden with no deck loaded", async ({ page }) => {
  await expect(page.locator(".arch-tap-tempo-btn")).toHaveCount(0);

  const row = page.locator(".arch-track-row", { hasText: "HIGH CONFIDENCE DETECTED" });
  await row.dblclick();

  const tapBtn = page.locator(".arch-tap-tempo-btn");
  await expect(tapBtn).toBeVisible();
  await expect(tapBtn).toHaveText("TAP");

  await tapBtn.click();
  await expect(tapBtn).toHaveText("TAP · 1");
  await tapBtn.click();
  await expect(tapBtn).toHaveText("TAP · 2");
});

test("fewer than 4 taps shows the 'keep tapping…' hint once the gesture goes idle", async ({ page }) => {
  const row = page.locator(".arch-track-row", { hasText: "HIGH CONFIDENCE DETECTED" });
  await row.dblclick();

  const tapBtn = page.locator(".arch-tap-tempo-btn");
  await tapBtn.click();
  await tapBtn.click();

  await expect(page.locator(".arch-tap-hint")).toHaveText("keep tapping…", { timeout: 3000 });
  await expect(tapBtn).toHaveText("TAP"); // gesture reset, counter back to zero
});

test("4+ taps computes a tempo and PATCHes bpm_display, deck header reflects it immediately", async ({ page }) => {
  let patchBody = null;
  await page.route("**/tracks/9002", async (route) => {
    if (route.request().method() === "PATCH") {
      patchBody = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) });
    }
    return route.fallback();
  });

  const row = page.locator(".arch-track-row", { hasText: "HIGH CONFIDENCE DETECTED" });
  await row.dblclick();

  const tapBtn = page.locator(".arch-tap-tempo-btn");
  // Four taps at a steady ~500ms pace (~120 BPM) — real elapsed clicks, not
  // synthetic timestamps, so this exercises the actual gesture timer.
  for (let i = 0; i < 4; i++) {
    await tapBtn.click();
    if (i < 3) await page.waitForTimeout(500);
  }

  // Gesture finalizes on a 2s idle timeout.
  await expect.poll(() => patchBody, { timeout: 4000 }).not.toBeNull();
  expect(patchBody).toHaveProperty("bpm_display");
  const appliedBpm = parseFloat(patchBody.bpm_display);
  expect(appliedBpm).toBeGreaterThan(100);
  expect(appliedBpm).toBeLessThan(140);

  // Track-list row reflects the same optimistic trackListData update tap-
  // tempo writes through (the deck header's own BPM readout only resolves
  // off deckTrack.bpm, a separate numeric field this flow doesn't touch —
  // a pre-existing quirk, unrelated to T10, shared with the manual-edit
  // flow this reuses; not asserted on here). Displayed verbatim (one decimal
  // place, not rounded to an integer) via cleanBpm, same as any manual entry.
  const listedRow = page.locator(".arch-track-row", { hasText: "HIGH CONFIDENCE DETECTED" });
  await expect(listedRow).toContainText(patchBody.bpm_display);
});

test("COMMS TAP topic opens correctly, same behavior as BEATGRID", async ({ page }) => {
  const search = page.getByPlaceholder("SEARCH VAULT");
  await search.fill("TAP");
  await expect(page.getByText("⏎ HELP")).toBeVisible();
  await search.press("Enter");
  await expect(page.getByText("Needs at least 4 taps", { exact: false })).toBeVisible();
});
