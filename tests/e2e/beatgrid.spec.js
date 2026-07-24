import { test, expect } from "@playwright/test";
import { loginToConsole } from "./fixtures/auth.js";
import { mockTracksApi } from "./fixtures/mockTracks.js";

// All /tracks/* calls are mocked (see fixtures/mockTracks.js) — this repo's
// .env points at the REAL production worker, so these specs must never
// depend on or risk touching real data. PATCH is intercepted and never
// forwarded, so even the octave-correction click below is fully safe.
//
// Canvas-based drag/insert interactions (the anchor editor itself) are
// deliberately NOT simulated here via pixel-coordinate clicks — that would
// be a brittle test tightly coupled to xToTime's internal math, and the
// underlying logic (clampAnchorTime, hitTestAnchor, snapToGridBeat,
// buildGridSegments) already has 22 dedicated unit tests in
// src/lib/__tests__/beatGrid.test.js. These specs cover what's genuinely
// E2E-shaped: the DOM-visible confidence badge / octave-button conditional
// rendering, which unit tests can't exercise (they live in the rendered
// track-list row, driven by real component state).

test.beforeEach(async ({ page }) => {
  await mockTracksApi(page);
  await loginToConsole(page);
});

test("confidence badge is hidden for a track with manual BPM entered", async ({ page }) => {
  const row = page.locator(".arch-track-row", { hasText: "MANUAL BPM TRACK" });
  await expect(row.locator(".arch-detected-bpm-badge")).toHaveCount(0);
  await expect(row).toContainText("128");
});

test("confidence badge is hidden when no detection has run yet", async ({ page }) => {
  const row = page.locator(".arch-track-row", { hasText: "NO DETECTION YET" });
  await expect(row.locator(".arch-detected-bpm-badge")).toHaveCount(0);
});

test("confidence badge shows for a high-confidence detection, octave buttons stay hidden", async ({ page }) => {
  const row = page.locator(".arch-track-row", { hasText: "HIGH CONFIDENCE DETECTED" });
  const badge = row.locator(".arch-detected-bpm-badge");
  await expect(badge).toBeVisible();
  await expect(badge).toContainText("85%");
  await expect(row.locator(".arch-octave-controls")).toHaveCount(0);
});

test("confidence badge AND octave buttons both show for a low-confidence detection", async ({ page }) => {
  const row = page.locator(".arch-track-row", { hasText: "LOW CONFIDENCE DETECTED" });
  const badge = row.locator(".arch-detected-bpm-badge");
  await expect(badge).toBeVisible();
  await expect(badge).toContainText("32%");

  const octaveControls = row.locator(".arch-octave-controls");
  await expect(octaveControls).toBeVisible();
  await expect(octaveControls.getByRole("button", { name: /halve/i })).toBeVisible();
  await expect(octaveControls.getByRole("button", { name: /double/i })).toBeVisible();
});

test("clicking the double-BPM octave button updates the displayed confidence badge (PATCH intercepted, never reaches production)", async ({ page }) => {
  let patchBody = null;
  await page.route("**/tracks/9003", async (route) => {
    if (route.request().method() === "PATCH") {
      patchBody = route.request().postDataJSON();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    }
    return route.fallback();
  });

  const row = page.locator(".arch-track-row", { hasText: "LOW CONFIDENCE DETECTED" });

  // Below the confidence threshold the raw guess still renders (marked
  // unverified, italic/dimmed) rather than "—" — otherwise the correction
  // buttons would have no visible feedback to correct.
  const bpmCell = row.locator(".arch-track-bpm .arch-bpm-unverified");
  await expect(bpmCell).toHaveText("176");

  await row.locator(".arch-octave-controls").getByRole("button", { name: /double/i }).click();

  // Optimistic UI update — the row's raw BPM cell reflects the correction immediately.
  await expect(bpmCell).toHaveText("352"); // 176 * 2, matching the fixture's detected_bpm

  await expect.poll(() => patchBody).toEqual({ detected_bpm: 352 });
});
