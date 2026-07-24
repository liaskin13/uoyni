# PSC TODOS

Deferred work captured during plan reviews. Each item includes why it was deferred
and enough context to pick it up cold.

---

## Phase 11

---

### Test suite — Vitest baseline

**Priority:** High
**Blocked by:** nothing (can start any time after Phase 10)

Phase 10 ships with zero automated tests. Build verification is the only gate. This
is acceptable for Phase 10 (D+L internal only), but any refactoring after this
point is invisible until it visually breaks.

Minimum viable test baseline:

- `lib/tracks.js` — unit tests for `uploadTrack()`, `getAudioUrl()` (now async),
  `fetchVaultTracks()` error path (should return [], not throw)
- `src/state/SystemContext.jsx` — `dispatchCommand()` with authorized vs unauthorized
  caller, `loadVaultTracks()` side effect from CMD.UPLOAD_TRACK handler
- `src/components/UploadModal.jsx` — format validation (WAV/AIFF/MP3 accepted,
  others rejected), size validation (>200MB rejected)

Set up: `bun add -d vitest @testing-library/react`. No Playwright/E2E yet — unit tests
first.

---

## Implementation Decisions (pending)

### Voice comment signed URL TTL strategy

**Context:** Audio tracks use 1-week TTL with graceful onerror handling. Voice comments
are shorter-lived and more transient in nature — the right TTL and refresh strategy
may differ.

**Options to evaluate during Item 2 implementation:**

- Same as tracks: 1-week TTL, graceful onerror message
- Shorter TTL (e.g., 1hr) with automatic re-sign on onerror (more complex but voice
  comments are accessed in shorter, active collaboration sessions)
- Generate signed URLs on-demand per play click (lazy, avoids TTL issue entirely but
  adds 100-200ms latency per play)

**Resolve during:** Item 2 (voice comments) implementation in Phase 10.

---

### AudioContext leak + unthrottled waveform generation on upload

**Priority:** Medium
**Blocked by:** nothing — separate failure surface from the INTAKE batch-upload fix, deferred out of that PR to keep the diff right-sized.

**What:** `src/lib/waveformAnalyzer.js:222` creates `new AudioContext()` inside `analyzeAudio()` and never calls `.close()`. Separately, `ArchitectConsole.jsx`'s `psc:track-uploaded` listener (`handleUpload`, ~line 570-576) calls `ensureWaveformForTrack(newTrack, true)` directly and unthrottled, instead of going through the existing sequential `waveformQueueRef`/`runWaveformQueue` pipeline (~line 528) already used for the initial track-list load.

**Why:** Dropping several files in one batch fires one `psc:track-uploaded` event per upload, each triggering its own immediate, concurrent waveform decode — each opening a fresh, never-closed `AudioContext`. This is the confirmed cause of stacked `[PSC] waveform generation failed: EncodingError: Decoding failed` console errors observed during a multi-file drop session (2026-07-21).

**Fix:** (1) wrap the `decodeAudioData` call in `analyzeAudio()` in try/finally and close the context; (2) route `handleUpload`'s waveform trigger through `waveformQueueRef`/`runWaveformQueue` instead of calling `ensureWaveformForTrack` directly, so upload-time waveform generation is one-at-a-time regardless of batch size.

**Context:** Discovered while diagnosing a separate multi-file upload bug (INTAKE modal only reading `dataTransfer.files[0]`) that turned out to be the real cause of "only the first file uploads." This waveform issue is real but was a red herring for that bug — uploads succeed, only the post-upload waveform decode fails.

---

### Pre-existing: vault-switch-mid-batch and orphaned R2 multipart sessions

**Priority:** Low
**Blocked by:** nothing, but the second half touches `worker/upload-worker.js` — treat with extra care, prior worker changes have caused regressions (see `~/.gstack/projects/*/  *-main-design-20260527-*.md` constraints).

**What:** Two small, pre-existing gaps noticed during the INTAKE batch-upload eng review (2026-07-21):
1. If the destination vault `<select>` is changed while items are still queued/uploading, later items in the same batch go to the new vault — a single drop can silently split across two vaults. Already true today via console tab-switching; the INTAKE modal's dedicated dropdown just makes it more discoverable/likely to trigger.
2. If the browser closes or reloads mid-upload, the R2 multipart upload session (`worker/upload-worker.js` `/upload-init`/`/upload-part`/`/upload-complete`) is abandoned with no `abortMultipartUpload` call — an orphaned-storage leak in R2 over time.

**Why:** Neither is caused by the INTAKE fix, both are worth a deliberate look eventually. #2 is the more concrete one (real storage cost over time); #1 is a UX footgun.

**Context:** Flagged, not investigated further — didn't want to scope-creep the INTAKE batch-upload fix into worker territory. #2 needs a periodic cleanup job (e.g., a scheduled worker cron listing/aborting stale multipart uploads via R2's API) or accept the leak as negligible at current volume.

---

### Bulk backfill: beat detection for D's existing catalog

**Priority:** Medium
**Blocked by:** the beat-quantize/beatgrid plan (real Quantize + offline beat detector + multi-point beatgrid) shipping AND being validated against known-BPM tracks in D's library first — do not build this against an unproven detector.

**What:** A batch job that runs the new offline beat detector (`src/lib/beatDetector.js`, once it ships) against every already-uploaded track, not just ones D re-Regenerates going forward.

**Why:** Without it, the detector's value is invisible on D's existing catalog until he manually re-Regenerates each track one at a time.

**Pros:** Immediate value across the whole library instead of trickling in track-by-track.

**Cons:** Real cost — re-fetching/re-processing every large WAV that already has waveform data; needs its own throttling/queue design (mirror the existing `waveformQueueRef`/`runWaveformQueue` pattern in `ArchitectConsole.jsx`, ~line 528) to avoid hammering R2/D1 with a burst of concurrent regenerations.

**Context:** Surfaced during the `/plan-eng-review` of the beat-quantize/beatgrid plan (2026-07-22). Natural follow-up once the detector is proven — premature to build alongside a not-yet-shipped, not-yet-validated detection algorithm.

---

### Reconsider pause-required gate on beatgrid editing

**Priority:** Low (revisit only if it proves annoying in practice)
**Blocked by:** nothing — this is a "watch and see" item, not a build task yet.

**What:** v1 of the multi-point beatgrid editor (see beat-quantize/beatgrid plan) only allows dragging/inserting anchor points while the deck is paused — disabled with a dimmed visual cue while playing, to avoid any risk of audible glitches from loop/quantize math recalculating mid-playback.

**Why:** L expressed discomfort with this restriction during the `/plan-eng-review` of that plan (2026-07-22) but chose not to relitigate it mid-review. Shipping pause-only as the safe v1 default was the recommendation, but L wants it explicitly not treated as a closed question.

**Context:** If D finds pausing-to-adjust-the-grid genuinely annoying once he's using the multi-point editor live, revisit whether live-editing-while-playing can be made safe (e.g., queuing grid changes to apply at the next loop/beat boundary instead of instantly, to avoid the glitch risk that motivated the pause-gate in the first place).

**Depends on:** The beatgrid editor (Part 3 of the beat-quantize plan) shipping first — this is only meaningful feedback once D has actually used the paused-only version.

---

### Isolated E2E test backend (no mock/local worker exists)

**Priority:** Medium
**Blocked by:** nothing — can start any time.

**What:** This repo's `.env` points `VITE_UPLOAD_WORKER_URL` at the real production Cloudflare Worker (`psc-upload-worker.psoulc.workers.dev`). There is no local/mock backend and no separate test environment — every Playwright test that runs here talks to D's real production data unless a test explicitly intercepts it.

**Why:** Discovered while building the beat-quantize/beatgrid E2E specs (2026-07-24) — writing a test that clicked the octave-correction button would have fired a real `PATCH /tracks/:id` against production on every CI run. Worked around it for now with `page.route()` interception in `tests/e2e/fixtures/mockTracks.js` (precise-match only, everything unrecognized falls through to the real network via `route.fallback()`), but that's a per-test-file discipline, not a structural guarantee — a future test file that forgets to mock is a real risk, especially once CI runs unattended on every push/PR.

**Context:** A proper fix is a local Wrangler dev instance (`wrangler dev` against a local/test D1 + R2) that CI spins up, so tests hit an actual isolated backend instead of requiring every spec author to remember to intercept `/tracks/*` by hand. Until then: any new E2E test touching track data MUST route through `mockTracksApi` (or an equivalent precise mock) — never assume the dev server's network calls are safe by default.

**Depends on:** Nothing technical — mostly a matter of prioritizing the Wrangler-dev CI setup work.
