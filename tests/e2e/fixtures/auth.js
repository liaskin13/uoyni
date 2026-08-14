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
  // Wait for the entry screen's window-level keydown listener to actually be
  // attached before typing — typing immediately after goto() races the
  // React mount and can drop keystrokes, an intermittent flake independent
  // of the app itself.
  await page.locator(".entry-wordmark").waitFor({ state: "visible", timeout: 10_000 });
  await page.keyboard.type(RESIDENT_CODES[owner]);
  await page.keyboard.press("Enter");
  await page.getByText("LOAD DECK").waitFor({ state: "visible", timeout: 15_000 });
  // "LOAD DECK" confirms the console shell has mounted, but the track list
  // itself populates from a separate async fetchAllTracks() call — on a
  // resource-constrained CI runner that gap can outlast the default 5000ms
  // expect() timeout, so callers that immediately assert on a specific
  // track row see "element(s) not found" rather than a real app bug. Wait
  // here, once, with a generous budget, so every downstream assertion runs
  // against an already-populated list.
  await page.locator(".arch-track-row").first().waitFor({ state: "visible", timeout: 15_000 });
}
