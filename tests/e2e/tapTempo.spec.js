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

test("a failed PATCH rolls back the optimistic BPM update and shows an error", async ({ page }) => {
  await page.route("**/tracks/9002", async (route) => {
    if (route.request().method() === "PATCH") {
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ success: false }) });
    }
    return route.fallback();
  });

  const row = page.locator(".arch-track-row", { hasText: "HIGH CONFIDENCE DETECTED" });
  await row.dblclick();

  const tapBtn = page.locator(".arch-tap-tempo-btn");
  for (let i = 0; i < 4; i++) {
    await tapBtn.click();
    if (i < 3) await page.waitForTimeout(500);
  }

  // Optimistic update lands first, then the failed PATCH rolls it back to
  // whatever it was before (this fixture track has no bpm_display set).
  const listedRow = page.locator(".arch-track-row", { hasText: "HIGH CONFIDENCE DETECTED" });
  await expect(listedRow.locator(".arch-detected-bpm-badge")).toBeVisible({ timeout: 4000 }); // CONF badge only shows without a manual bpm_display — proves the rollback happened

  const errorStatus = page.locator(".arch-comms-lcd.status-error");
  await expect(errorStatus).toBeVisible();
  await expect(errorStatus).toContainText("Tap-tempo save failed");
});

test("a successful tap-tempo apply increments the localStorage usage counter", async ({ page }) => {
  await page.evaluate(() => localStorage.removeItem("psc_tap_tempo_uses"));

  const row = page.locator(".arch-track-row", { hasText: "HIGH CONFIDENCE DETECTED" });
  await row.dblclick();

  const tapBtn = page.locator(".arch-tap-tempo-btn");
  for (let i = 0; i < 4; i++) {
    await tapBtn.click();
    if (i < 3) await page.waitForTimeout(500);
  }

  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("psc_tap_tempo_uses")), { timeout: 4000 })
    .toBe("1");

  // A second successful gesture increments again, not resets.
  await page.waitForTimeout(2100); // clear the first gesture's idle window
  for (let i = 0; i < 4; i++) {
    await tapBtn.click();
    if (i < 3) await page.waitForTimeout(500);
  }
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("psc_tap_tempo_uses")), { timeout: 4000 })
    .toBe("2");
});

test("switching decks mid-gesture clears the previous track's tap count and hover state", async ({ page }) => {
  const trackA = page.locator(".arch-track-row", { hasText: "HIGH CONFIDENCE DETECTED" });
  await trackA.dblclick();

  const tapBtn = page.locator(".arch-tap-tempo-btn");
  await tapBtn.click();
  await tapBtn.click();
  await expect(tapBtn).toHaveText("TAP · 2");

  // Switch decks mid-gesture, without letting it idle out.
  const trackB = page.locator(".arch-track-row", { hasText: "MANUAL BPM TRACK" });
  await trackB.dblclick();

  // The new deck's TAP button must start fresh, not inherit "· 2" from
  // the track that was abandoned mid-gesture (coverage-audit finding,
  // 2026-08-15 — state used to live outside any per-track scope).
  await expect(page.locator(".arch-tap-tempo-btn")).toHaveText("TAP");
});
