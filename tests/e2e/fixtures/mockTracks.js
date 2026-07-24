// Intercepts /tracks/* worker calls with fixture data — this repo's .env
// points at the REAL production worker (see playwright.config.js), so
// every E2E test that touches track data MUST route through this mock
// rather than hitting production.
//
// Precise matching only — anything not explicitly recognized here falls
// through to the real network untouched (route.fallback()), rather than
// guessing a response shape for endpoints this mock doesn't know about.

export const FIXTURE_TRACKS = [
  {
    id: 9001,
    title: "MANUAL BPM TRACK",
    artist: "Fixture",
    vault: "venus",
    bpm_display: "128",
    duration: 240,
    waveform_data: "v2",
  },
  {
    id: 9002,
    title: "HIGH CONFIDENCE DETECTED",
    artist: "Fixture",
    vault: "venus",
    duration: 240,
    waveform_data: "v2",
    detected_bpm: 122,
    detected_bpm_confidence: 0.85,
  },
  {
    id: 9003,
    title: "LOW CONFIDENCE DETECTED",
    artist: "Fixture",
    vault: "venus",
    duration: 240,
    waveform_data: "v2",
    detected_bpm: 176,
    detected_bpm_confidence: 0.32,
  },
  {
    id: 9004,
    title: "NO DETECTION YET",
    artist: "Fixture",
    vault: "venus",
    duration: 240,
    waveform_data: "v2",
  },
];

const FIXTURE_IDS = new Set(FIXTURE_TRACKS.map((t) => t.id));

export async function mockTracksApi(page) {
  await page.route("**/tracks", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(FIXTURE_TRACKS),
    });
  });

  await page.route(/\/tracks\/(\d+)(\/.*)?$/, async (route) => {
    const match = route.request().url().match(/\/tracks\/(\d+)/);
    const id = match ? parseInt(match[1], 10) : null;
    if (!FIXTURE_IDS.has(id)) return route.fallback(); // real track — never touch it

    const method = route.request().method();
    if (method === "PATCH" || method === "POST" || method === "PUT") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    }
    // GET on a fixture track id — return that single fixture.
    const track = FIXTURE_TRACKS.find((t) => t.id === id) ?? null;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(track),
    });
  });
}
