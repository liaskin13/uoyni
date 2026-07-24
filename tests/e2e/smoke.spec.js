import { test, expect } from "@playwright/test";
import { loginToConsole } from "./fixtures/auth.js";

// Proves the Playwright harness itself works end-to-end (dev server,
// auth fixture, real browser render) — rides alongside the Quantize
// feature per /plan-eng-review D12b. Full E2E spec set lands after the
// beatgrid editor UI stabilizes (see TODOS.md / plan T9).
test("console loads and the Quantize toggle is reachable", async ({ page }) => {
  await loginToConsole(page);

  await expect(page.getByText("LOAD DECK")).toBeVisible();

  // The SETUP/SETTINGS controls live in a collapsible architect rail —
  // open it first, then open settings and confirm the (previously dead)
  // Quantize toggle renders.
  await page.getByRole("button", { name: "Open architect rail" }).click();
  await page.getByRole("button", { name: /system settings/i }).click();
  await expect(page.getByText("Quantize", { exact: false }).first()).toBeVisible();
});
