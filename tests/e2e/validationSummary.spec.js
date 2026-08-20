import { test, expect } from "@playwright/test";
import { loginToConsole } from "./fixtures/auth.js";
import { mockTracksApi } from "./fixtures/mockTracks.js";

// T13 — in-console validation-numbers panel. The formatting logic
// (loading/unavailable/real-numbers) has dedicated unit tests
// (src/lib/__tests__/useValidationSummary.test.js) — these specs verify the
// row is wired into both settings panels (D's ArchitectConsole.jsx, L's
// AdminSettings.jsx — genuinely different components, see quantize.spec.js's
// precedent) and reads the real build-time artifact.

test.beforeEach(async ({ page }) => {
  await mockTracksApi(page);
});

test("D's settings panel shows real validation numbers from the build artifact", async ({ page }) => {
  await loginToConsole(page, "D");
  await page.getByRole("button", { name: "Open architect rail" }).click();
  await page.getByRole("button", { name: /system settings/i }).click();

  const row = page.locator(".arch-settings-row", { hasText: "Validation Suite" });
  await expect(row).toBeVisible();
  // Real numbers from public/validationSummary.json (committed as a build
  // artifact, gitignored but present on disk from the last `npm run build`)
  // — 5/5 genres, ±70ms, matching scripts/generate-validation-summary.js's
  // reuse of multiGenreValidation.test.js's exact tolerance.
  await expect(row).toContainText(/\d+\/\d+ GENRES · ±\d+MS/);
});

test("L's settings panel (different component than D's) also shows validation numbers", async ({ page }) => {
  await loginToConsole(page, "L");
  await page.getByRole("button", { name: "Open architect rail" }).click();
  await page.getByRole("button", { name: /system settings/i }).click();

  const row = page.locator(".adm-row", { hasText: "Validation Suite" });
  await expect(row).toBeVisible();
  await expect(row).toContainText(/\d+\/\d+ GENRES · ±\d+MS/);
});

test("shows PENDING VALIDATION rather than crashing when the artifact is missing", async ({ page }) => {
  await page.route("**/validationSummary.json", (route) => route.fulfill({ status: 404, body: "" }));
  await loginToConsole(page, "D");
  await page.getByRole("button", { name: "Open architect rail" }).click();
  await page.getByRole("button", { name: /system settings/i }).click();

  const row = page.locator(".arch-settings-row", { hasText: "Validation Suite" });
  await expect(row).toContainText("PENDING VALIDATION");
});

test("COMMS VALIDATION topic opens correctly, same behavior as BEATGRID", async ({ page }) => {
  await loginToConsole(page, "D");
  const search = page.getByPlaceholder("SEARCH · OR TYPE HELP");
  await search.fill("VALIDATION");
  await expect(page.getByText("⏎ HELP")).toBeVisible();
  await search.press("Enter");
  await expect(page.getByText("mir_eval's standard onset F-measure tolerance", { exact: false })).toBeVisible();
});
