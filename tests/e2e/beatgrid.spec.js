import { test, expect } from "@playwright/test";
import { loginToConsole } from "./fixtures/auth.js";
import { mockTracksApi, FIXTURE_TRACKS } from "./fixtures/mockTracks.js";

// A tiny valid (silent) WAV — real decodable bytes are required for the
// genre-badge pause-gate tests below, which need real isPlaying=true state
// (loadAndPlay() exits early with no audio_path — see envelopeRow.spec.js's
// identical rationale). Duplicated locally rather than imported, matching
// this test suite's existing per-file convention for this helper.
function buildMinimalWav() {
  const sampleRate = 8000;
  // 30s of silence, NOT envelopeRow.spec.js's 0.1s — that file never needs
  // playback to keep running (just a successful decode). These tests do:
  // real isPlaying=true must survive an entire interaction sequence
  // (locator resolution + click + assertions). A 0.1s clip finishes
  // playback and flips isPlaying back to false mid-test — confirmed by
  // direct reproduction: the "blocked while playing" cycle went through
  // anyway because playback had already ended by the time the badge was
  // double-clicked, silently defeating the whole premise of the test.
  const numSamples = 8000 * 30;
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

// Genre-cycle tests need real audio (so pausing has meaning) AND a backend
// that actually remembers a PATCH (so "persists across reload" is a real
// claim, not just an optimistic-UI check) — mockTracksApi's PATCH handler
// deliberately does neither (correct for the specs that only check the
// optimistic update/PATCH body). A per-PATCH random delay (5-60ms) lets
// responses genuinely arrive out of order under rapid-fire clicks, giving
// the request-sequence guard something real to prove rather than a FIFO
// mock that could never exercise it.
async function mockStatefulGenreTrack(page) {
  const state = new Map(FIXTURE_TRACKS.map((t) => [t.id, { ...t }]));
  state.set(9002, { ...state.get(9002), audio_path: "fixture-9002-genre.wav" });

  await page.route("**/tracks", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(Array.from(state.values())),
    });
  });

  await page.route(/\/tracks\/(\d+)(\/.*)?$/, async (route) => {
    const match = route.request().url().match(/\/tracks\/(\d+)/);
    const id = match ? parseInt(match[1], 10) : null;
    if (!state.has(id)) return route.fallback();

    const method = route.request().method();
    if (method === "PATCH") {
      const body = route.request().postDataJSON();
      await new Promise((r) => setTimeout(r, 5 + Math.random() * 55));
      state.set(id, { ...state.get(id), ...body });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    }
    if (method === "POST" || method === "PUT") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state.get(id)) });
  });

  await page.route("**/audio/fixture-9002-genre.wav", async (route) => {
    // audioEngine.load() sets crossOrigin="anonymous" and the real
    // UPLOAD_WORKER_URL is a different origin than the dev server — needs
    // an explicit CORS header even though the request is fully intercepted.
    return route.fulfill({
      status: 200,
      contentType: "audio/wav",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: buildMinimalWav(),
    });
  });
}

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

  // manually_corrected PATCHes alongside detected_bpm (Dynamic Tempo
  // Analysis plan) — kept separate from detected_bpm_confidence so that
  // field stays an honest measurement, never overloaded to also mean "a
  // human intervened".
  await expect.poll(() => patchBody).toEqual({ detected_bpm: 352, manually_corrected: true });

  // The button disappears immediately (optimistic manually_corrected=true),
  // not just once confidence happens to cross the threshold again — closes
  // the previously-tracked "button doesn't disappear after correcting" bug.
  await expect(row.locator(".arch-octave-controls")).toHaveCount(0);
});

// Dynamic Tempo Analysis (CONF-badge/genre plan) — the bucket-gated fix's
// differentiating proof: a confidence reading that would have shown the
// octave-correct button under the old flat-0.6 rule, but correctly stays
// hidden under the new dynamic-bucket 0.35 bar.
test("octave control stays hidden for a 0.45-confidence track under the DYNAMIC bucket default (would have shown under the old flat-0.6 rule)", async ({ page }) => {
  const row = page.locator(".arch-track-row", { hasText: "DYNAMIC BUCKET DIFFERENTIATOR" });
  const badge = row.locator(".arch-detected-bpm-badge");
  await expect(badge).toBeVisible();
  await expect(badge).toContainText("45%");
  await expect(row.locator(".arch-octave-controls")).toHaveCount(0);
});

test("a manual BPM range does not suppress the CONF badge/octave control (suppression-bug fix)", async ({ page }) => {
  const row = page.locator(".arch-track-row", { hasText: "RANGE BPM TRACK" });
  const badge = row.locator(".arch-detected-bpm-badge");
  await expect(badge).toBeVisible();
  await expect(badge).toContainText("30%");
  await expect(row.locator(".arch-octave-controls")).toBeVisible();
});

test("a track with manually_corrected already set never shows the octave control, regardless of confidence", async ({ page }) => {
  const row = page.locator(".arch-track-row", { hasText: "ALREADY CORRECTED TRACK" });
  await expect(row.locator(".arch-octave-controls")).toHaveCount(0);
});

// T9 — the same CONF badge, now also built onto the loaded-deck header
// (arch-deck-stats), completing the gap DESIGN.md already specced but that
// was previously only wired into track-list rows (tests above this point).
test("deck header shows the CONF badge, colored by confidence band, for the loaded track", async ({ page }) => {
  const row = page.locator(".arch-track-row", { hasText: "HIGH CONFIDENCE DETECTED" });
  await row.dblclick();

  const deckBadge = page.locator(".arch-deck-stats .arch-detected-bpm-badge");
  await expect(deckBadge).toBeVisible();
  await expect(deckBadge).toContainText("85%");
  // 0.85 confidence → 80-90% band → cyan (#00ffff), per DESIGN.md's
  // discrete-band table — verifies the color, not just the number.
  await expect(deckBadge).toHaveCSS("color", "rgb(0, 255, 255)");
});

test("deck header hides the CONF badge for a track with manual BPM entered", async ({ page }) => {
  const row = page.locator(".arch-track-row", { hasText: "MANUAL BPM TRACK" });
  await row.dblclick();

  await expect(page.locator(".arch-deck-stats .arch-detected-bpm-badge")).toHaveCount(0);
});

// Dynamic Tempo Analysis — the genre-cycle badge (deck header, after the
// BPM digits). These need real isPlaying state, unlike the CONF-badge
// specs above, so they use mockStatefulGenreTrack instead of the shared
// beforeEach's mockTracksApi (Playwright's most-recently-registered-runs-
// first route precedence lets it override cleanly per test).
test("genre badge double-click while paused cycles the vocabulary and persists across reload", async ({ page }) => {
  // The shared beforeEach already called loginToConsole with the plain
  // mockTracksApi mock, so the app's track list is already fetched without
  // audio_path by the time this test body runs — reload forces a fresh GET
  // /tracks against the stateful mock just registered, matching
  // envelopeRow.spec.js's "register before the first fetch" rule (there,
  // achieved by not sharing a beforeEach that logs in first).
  await mockStatefulGenreTrack(page);
  await page.reload();
  await page.getByText("LOAD DECK").waitFor({ state: "visible", timeout: 10_000 });

  const row = page.locator(".arch-track-row", { hasText: "HIGH CONFIDENCE DETECTED" });
  await row.dblclick(); // loads + auto-plays
  await page.waitForResponse((res) => res.url().includes("fixture-9002-genre.wav"));

  const genreBadge = page.locator(".arch-genre-badge");
  await expect(genreBadge).toContainText("DYNAMIC"); // no tempo_genre set -> console default

  await page.getByRole("button", { name: "Pause" }).click();
  await genreBadge.dblclick();
  await expect(genreBadge).toContainText("BREAKBEAT");

  await page.reload();
  await page.getByText("LOAD DECK").waitFor({ state: "visible", timeout: 10_000 });
  await row.dblclick();
  // Reload re-fetched GET /tracks against the SAME stateful mock — this
  // confirms the client round-trips tempo_genre correctly (the OV1
  // worker GET-side dspColumns fix this proves from the app's side),
  // not just that the optimistic UI update painted.
  await expect(page.locator(".arch-genre-badge")).toContainText("BREAKBEAT");
});

test("genre badge double-click while playing is blocked with an announceStatus message, not silent", async ({ page }) => {
  // The shared beforeEach already called loginToConsole with the plain
  // mockTracksApi mock, so the app's track list is already fetched without
  // audio_path by the time this test body runs — reload forces a fresh GET
  // /tracks against the stateful mock just registered, matching
  // envelopeRow.spec.js's "register before the first fetch" rule (there,
  // achieved by not sharing a beforeEach that logs in first).
  await mockStatefulGenreTrack(page);
  await page.reload();
  await page.getByText("LOAD DECK").waitFor({ state: "visible", timeout: 10_000 });

  const row = page.locator(".arch-track-row", { hasText: "HIGH CONFIDENCE DETECTED" });
  await row.dblclick();
  await page.waitForResponse((res) => res.url().includes("fixture-9002-genre.wav"));
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible(); // confirms isPlaying=true

  const genreBadge = page.locator(".arch-genre-badge");
  await expect(genreBadge).toContainText("DYNAMIC");
  await genreBadge.dblclick();

  // Still DYNAMIC — blocked, not silently ignored, and not cycled either.
  await expect(genreBadge).toContainText("DYNAMIC");
  // Two role="status" regions render the same announceStatus() message —
  // the aria-live announcer div (announce()) and the visible COMMS-box
  // readout (systemStatus). Scope to the visible one specifically.
  await expect(page.locator(".arch-comms-lcd-status")).toContainText("Pause to change tempo genre");
});

test("rapid repeated genre cycling while paused converges to the final genre, matching what actually persists (sequence-guard proof)", async ({ page }) => {
  // The shared beforeEach already called loginToConsole with the plain
  // mockTracksApi mock, so the app's track list is already fetched without
  // audio_path by the time this test body runs — reload forces a fresh GET
  // /tracks against the stateful mock just registered, matching
  // envelopeRow.spec.js's "register before the first fetch" rule (there,
  // achieved by not sharing a beforeEach that logs in first).
  await mockStatefulGenreTrack(page);
  await page.reload();
  await page.getByText("LOAD DECK").waitFor({ state: "visible", timeout: 10_000 });

  const row = page.locator(".arch-track-row", { hasText: "HIGH CONFIDENCE DETECTED" });
  await row.dblclick();
  await page.waitForResponse((res) => res.url().includes("fixture-9002-genre.wav"));
  await page.getByRole("button", { name: "Pause" }).click();

  const genreBadge = page.locator(".arch-genre-badge");
  await expect(genreBadge).toContainText("DYNAMIC");

  // DYNAMIC -> BREAKBEAT -> HOUSE -> TECHNO, fired as 3 sequential
  // Playwright dblclick actions with NO wait for each PATCH to settle in
  // between — each click's optimistic update commits synchronously
  // (proven correct: the on-screen genre progresses through all 4 values,
  // not just the first), but the 3 underlying PATCH requests are still
  // in flight together and race against the mock's randomized per-request
  // delay, so responses can land out of order. That's the real thing the
  // sequence guard protects: an early click's SLOW response arriving after
  // a later click's FAST one must never overwrite the newer value.
  //
  // (Firing all 3 as synchronous DOM dispatchEvent calls in one JS tick —
  // tried first — is NOT equivalent: React batches all 3 into a single
  // render pass, so every handler invocation reads the SAME stale
  // `deckTrack` closure and computes the SAME "next" genre instead of
  // progressively cycling. That's an artifact of same-tick batching, not
  // realistic rapid clicking — even a very fast human double-click, or
  // consecutive Playwright actions, has enough of a yield for React's
  // synchronous handler to commit its optimistic update before the next
  // click's event dispatches.)
  await genreBadge.dblclick();
  await genreBadge.dblclick();
  await genreBadge.dblclick();

  await expect(genreBadge).toContainText("TECHNO");
  // Give the slowest of the 3 in-flight PATCHes (up to 60ms mock delay)
  // time to land before reloading, so the reload's GET can't race ahead of
  // the mock's own state mutation.
  await page.waitForTimeout(150);

  await page.reload();
  await page.getByText("LOAD DECK").waitFor({ state: "visible", timeout: 10_000 });
  await row.dblclick();
  await expect(page.locator(".arch-genre-badge")).toContainText("TECHNO");
});
