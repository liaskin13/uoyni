import { test, expect } from "@playwright/test";
import { loginToConsole } from "./fixtures/auth.js";
import { mockTracksApi, FIXTURE_TRACKS } from "./fixtures/mockTracks.js";

// T11 — onset-envelope explainability row. The window/cursor math has
// dedicated unit tests (src/console/__tests__/envelopeWindow.test.js) —
// these specs verify the row itself is wired end-to-end: always present,
// idle hint, "unavailable" for tracks with no resolvable BPM, and that
// hovering the waveform actually redraws the canvas (checked via a
// before/after toDataURL diff, not exact pixels — that's what the unit
// tests already cover precisely).
//
// The active-trace state needs real per-bar analysis data, which none of
// the fixture tracks carry over the network by default — this file mocks
// GET /tracks/9002/waveform-bin with a synthetic packToBinary()-format
// buffer (4 bytes/bar: bass, mid, high, peak) so that path is exercised too.
// seconds MUST match the fixture's declared duration (240) — the app scales
// bar-index <-> time using bars.length against track.duration together, so
// a mismatched synthetic length shifts every hover position outside the
// data actually covered, an easy way to accidentally test nothing.

function synthesizeWaveformBinary(bpm, seconds = 240, barsPerSec = 50) {
  const n = seconds * barsPerSec;
  const buf = Buffer.alloc(n * 4);
  const beatBars = (60 / bpm) * barsPerSec;
  for (let i = 0; i < n; i++) {
    const distToNearestBeat = Math.min(
      i % beatBars,
      beatBars - (i % beatBars),
    );
    // A slow amplitude drift across the whole track (not just a repeating
    // beat pattern) so two different hover positions produce genuinely
    // different pixels — a purely periodic pattern would render pixel-
    // identical at any two positions separated by a whole number of beats,
    // which isn't a real "did the hover redraw" signal.
    const drift = 0.5 + 0.5 * Math.sin((i / n) * Math.PI * 6);
    const spike = Math.max(0, 1 - distToNearestBeat / 3) * drift;
    buf[i * 4] = Math.round(Math.min(1, 0.15 + spike * 0.7) * 255); // bass
    buf[i * 4 + 1] = Math.round(Math.min(1, 0.1 + spike * 0.4) * 255); // mid
    buf[i * 4 + 2] = Math.round(Math.min(1, 0.05 + spike * 0.9) * 255); // high
    buf[i * 4 + 3] = Math.round(Math.min(1, 0.2 + spike * 0.75) * 255); // peak
  }
  return buf;
}

// A tiny valid (silent) WAV — real decodable bytes are required, since
// loading a track onto the deck runs through audioEngine.load() ->
// decodeAudioData() before waveform-bin is ever fetched. The fixture tracks
// have no audio_path (so getAudioUrl() returns null and this path never
// runs at all in the other specs) — routes below override just enough to
// give one track a working audio+waveform-bin path without touching the
// shared mockTracksApi fixture other specs rely on.
function buildMinimalWav() {
  const sampleRate = 8000;
  const numSamples = 800; // 0.1s of silence
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
  return buf; // remaining bytes are already zero (silence)
}

async function mockLoadableAudioTrack(page) {
  // The double-click-to-load flow uses the track object already sitting in
  // trackListData (populated from the GET /tracks LIST response) — it does
  // NOT re-fetch GET /tracks/:id first. Overriding only the single-track
  // endpoint is a no-op for this flow; the list response itself must carry
  // audio_path. Registered after mockTracksApi's own /tracks route (in
  // beforeEach), so this one wins per Playwright's most-recently-registered-
  // runs-first route precedence.
  const augmented = FIXTURE_TRACKS.map((t) =>
    t.id === 9002 ? { ...t, audio_path: "fixture-9002.wav" } : t,
  );
  await page.route("**/tracks", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(augmented),
    });
  });
  await page.route("**/audio/fixture-9002.wav", async (route) => {
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

test("envelope row is always present, showing the idle hint before any hover", async ({ page }) => {
  await mockTracksApi(page);
  await loginToConsole(page);

  const canvas = page.locator(".arch-envelope-canvas");
  await expect(canvas).toBeVisible(); // present even with no track loaded

  const row = page.locator(".arch-envelope-row");
  const box1 = await row.boundingBox();

  const trackRow = page.locator(".arch-track-row", { hasText: "MANUAL BPM TRACK" });
  await trackRow.dblclick();
  await expect(canvas).toBeVisible();

  // Loading a track doesn't shift the row's position — it was already
  // reserved space, not something that appears. Allow ~1px of sub-pixel
  // layout jitter, not an exact match.
  const box2 = await row.boundingBox();
  expect(Math.abs(box2.y - box1.y)).toBeLessThan(1.5);
});

test("shows unavailable rather than crashing when hovering a track with no resolvable BPM", async ({ page }) => {
  await mockTracksApi(page);
  await loginToConsole(page);

  const trackRow = page.locator(".arch-track-row", { hasText: "NO DETECTION YET" });
  await trackRow.dblclick();

  const canvas = page.locator(".arch-envelope-canvas");
  const idleImage = await canvas.evaluate((el) => el.toDataURL());

  await page.locator(".arch-waveform-main").hover();
  await expect
    .poll(() => canvas.evaluate((el) => el.toDataURL()))
    .not.toBe(idleImage); // redrew to *something* on hover, not still the idle frame

  // No console crash / error overlay from the hover.
  await expect(page.locator("#root")).toBeVisible();
});

test("hovering a track with real analysis data redraws the envelope trace", async ({ page }) => {
  // Order matters: mocks must be registered before loginToConsole navigates
  // and the console fetches its track list — mockLoadableAudioTrack's /tracks
  // override must be in place before that first fetch, not after.
  await mockTracksApi(page);
  await mockLoadableAudioTrack(page);
  await page.route("**/tracks/9002/waveform-bin", async (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/octet-stream",
      body: synthesizeWaveformBinary(122),
    });
  });
  await loginToConsole(page);

  const trackRow = page.locator(".arch-track-row", { hasText: "HIGH CONFIDENCE DETECTED" });
  await trackRow.dblclick();
  // Loading (real, decoded) audio is async — wait for the waveform-bin fetch
  // it triggers to actually land before asserting on canvas content.
  await page.waitForResponse((res) => res.url().includes("/tracks/9002/waveform-bin"));

  const canvas = page.locator(".arch-envelope-canvas");
  const idleImage = await canvas.evaluate((el) => el.toDataURL());

  await page.locator(".arch-waveform-main").hover();
  await expect
    .poll(() => canvas.evaluate((el) => el.toDataURL()))
    .not.toBe(idleImage);

  // Moving to a different point in the waveform redraws again (a different
  // window/cursor position), not a static image reused from the first hover.
  const midHoverImage = await canvas.evaluate((el) => el.toDataURL());
  const waveformBox = await page.locator(".arch-waveform-main").boundingBox();
  await page.mouse.move(waveformBox.x + waveformBox.width * 0.25, waveformBox.y + waveformBox.height / 2);
  await expect
    .poll(() => canvas.evaluate((el) => el.toDataURL()))
    .not.toBe(midHoverImage);
});

test("mouse leaving the waveform returns the row to its idle hint", async ({ page }) => {
  await mockTracksApi(page);
  await mockLoadableAudioTrack(page);
  await page.route("**/tracks/9002/waveform-bin", async (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/octet-stream",
      body: synthesizeWaveformBinary(122),
    });
  });
  await loginToConsole(page);

  const trackRow = page.locator(".arch-track-row", { hasText: "HIGH CONFIDENCE DETECTED" });
  await trackRow.dblclick();
  await page.waitForResponse((res) => res.url().includes("/tracks/9002/waveform-bin"));

  const canvas = page.locator(".arch-envelope-canvas");
  const idleImage = await canvas.evaluate((el) => el.toDataURL());

  await page.locator(".arch-waveform-main").hover();
  await expect
    .poll(() => canvas.evaluate((el) => el.toDataURL()))
    .not.toBe(idleImage);

  await page.mouse.move(10, 10); // move off the waveform entirely
  await expect
    .poll(() => canvas.evaluate((el) => el.toDataURL()))
    .toBe(idleImage);
});
