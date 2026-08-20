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
  {
    // Dynamic Tempo Analysis (CONF-badge/genre plan, Phase 3) — the
    // differentiating case: 0.45 confidence, no tempo_genre override (falls
    // back to the DYNAMIC console default). Would have shown the
    // octave-correct button under the old flat-0.6 rule (0.45 < 0.6); must
    // stay hidden under the new dynamic-bucket 0.35 bar (0.45 > 0.35).
    id: 9005,
    title: "DYNAMIC BUCKET DIFFERENTIATOR",
    artist: "Fixture",
    vault: "venus",
    duration: 240,
    waveform_data: "v2",
    detected_bpm: 98,
    detected_bpm_confidence: 0.45,
  },
  {
    // hasCompleteManualBpm suppression-bug fix: a manual RANGE (not a
    // single resolved BPM) must NOT suppress the CONF badge/octave control
    // the way a real single manual BPM does.
    id: 9006,
    title: "RANGE BPM TRACK",
    artist: "Fixture",
    vault: "venus",
    duration: 240,
    waveform_data: "v2",
    bpm_display: "60-80",
    // A literal t.bpm ALSO set alongside the range — matches D's real
    // catalog shape (found live via /qa, 2026-08-20: the upload worker's
    // INSERT parses the first number of the typed bpm field into t.bpm
    // regardless of whether bpm_display is a range). Without this field
    // present in the fixture, the suppression-bug fix's unit tests could
    // pass while the real bug (hasCompleteManualBpm falling through to
    // Boolean(track.bpm) whenever bpm_display is a range) stayed live —
    // exactly what happened before this fixture was corrected.
    bpm: 60,
    detected_bpm: 68,
    // Below the dynamic bucket's 0.35 bar (no tempo_genre set -> falls
    // back to the DYNAMIC console default) so the octave control actually
    // renders — 0.4 would sit ABOVE that bar and correctly stay hidden
    // under the new bucket-aware gating, which would test the wrong thing.
    detected_bpm_confidence: 0.3,
  },
  {
    // manually_corrected pre-set (as if a prior octave-correct already ran)
    // — the octave control must stay hidden regardless of confidence, a
    // terminal state, not just another confidence reading.
    id: 9007,
    title: "ALREADY CORRECTED TRACK",
    artist: "Fixture",
    vault: "venus",
    duration: 240,
    waveform_data: "v2",
    detected_bpm: 140,
    detected_bpm_confidence: 0.2,
    manually_corrected: true,
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
