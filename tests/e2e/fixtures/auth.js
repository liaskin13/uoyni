// Console entry is a synchronous, keyboard-driven 4-digit code check
// (src/entry/EntrySequence.jsx) — matched against RESIDENT_REGISTRY in
// src/data/residentBlueprint.js, not the (dead/unused) ENTRY_CODE constant
// exported from src/config.js. No network call, no API mocking needed.
const RESIDENT_CODES = { D: "3865", L: "7677" };

// Types the console entry code and waits for the Architect Console to load.
// owner defaults to "D" — D's vaultId is "saturn" and reaches the same
// ArchitectConsole; pass "L" for the architect-specific stage/theme.
export async function loginToConsole(page, owner = "D") {
  await page.goto("/");
  await page.keyboard.type(RESIDENT_CODES[owner]);
  await page.keyboard.press("Enter");
  await page.getByText("LOAD DECK").waitFor({ state: "visible", timeout: 10_000 });
}
