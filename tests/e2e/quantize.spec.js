import { test, expect } from "@playwright/test";
import { loginToConsole } from "./fixtures/auth.js";
import { mockTracksApi } from "./fixtures/mockTracks.js";

// The underlying snap math (quantizeToBeat, resolveTrackBpm) has 36+ unit
// tests already — these E2E specs verify the UI control itself is wired
// end-to-end, not re-prove the arithmetic. See src/console/__tests__/
// quantizeToBeat.test.js for the math coverage.

test.beforeEach(async ({ page }) => {
  await mockTracksApi(page);
});

test("Quantize toggle is OFF by default and flips ON when clicked", async ({ page }) => {
  await loginToConsole(page);
  await page.getByRole("button", { name: "Open architect rail" }).click();
  await page.getByRole("button", { name: /system settings/i }).click();

  const toggle = page
    .locator(".arch-settings-row", { hasText: "Quantize" })
    .getByRole("button");
  await expect(toggle).toHaveText("OFF");

  await toggle.click();
  await expect(toggle).toHaveText("ON");

  await toggle.click();
  await expect(toggle).toHaveText("OFF");
});

test("Quantize state is session-only — resets on reload (not persisted, by design)", async ({ page }) => {
  await loginToConsole(page);
  await page.getByRole("button", { name: "Open architect rail" }).click();
  await page.getByRole("button", { name: /system settings/i }).click();
  const toggle = page
    .locator(".arch-settings-row", { hasText: "Quantize" })
    .getByRole("button");
  await toggle.click();
  await expect(toggle).toHaveText("ON");

  // Session persists across reload (localStorage), but Quantize is plain
  // React state — a real reload should reset it without a fresh login.
  await page.reload();
  await page.getByText("LOAD DECK").waitFor({ state: "visible", timeout: 10_000 });
  await page.getByRole("button", { name: "Open architect rail" }).click();
  await page.getByRole("button", { name: /system settings/i }).click();
  const toggleAfterReload = page
    .locator(".arch-settings-row", { hasText: "Quantize" })
    .getByRole("button");
  await expect(toggleAfterReload).toHaveText("OFF");
});
