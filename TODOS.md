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

---

### FULL BOIL: complete coverage closure for beat-quantize/beatgrid branch

**Priority:** Medium
**Blocked by:** nothing — explicitly deferred out of the `feat/beat-quantize-grid` ship to keep that branch scoped to its own feature risk, not repo-wide test-infra debt.

**What:** The "boil the ocean" option L asked about during that branch's `/ship` coverage gate (2026-07-24), declined in favor of shipping with the scoped/recommended coverage. Full closure means:

1. `handleOctaveCorrect`/`handleBeatGridPointsChange` rollback/failure-path tests in `ArchitectConsole.jsx` — needs a render strategy for a meaningful slice of that 4000+ line component; no existing precedent in this repo.
2. `waveformAnalyzer.js` orchestration tests — verify `detectTempoSegments`/`dpBeatTrack` are actually wired correctly into `generateAndUploadWaveformV2`, not just the pure-function unit tests that already exist for the underlying math.
3. `DeckWaveformV2`'s drag-mouse anchor state machine — only keyboard nav + double-click insert are covered today (`DeckWaveformV2.beatgrid.test.js`); mouse drag-to-move is untested.
4. Worker-layer tests for the PATCH `/tracks/:id` allowlist additions in `worker/upload-worker.js` — there are zero worker tests anywhere in this repo currently, so this is really "stand up worker test infra," not a small addition.
5. The actual isolated E2E test backend (see "Isolated E2E test backend" item above) — a local Wrangler dev instance against test D1/R2, replacing the `page.route()` interception workaround.

**Why deferred:** Most of this (items 4 and 5 especially) is pre-existing repo-wide test-infra debt, not something the beat-quantize/beatgrid branch introduced — pulling it into that branch's ship would have scope-crept a feature PR into an infra PR.

---

### No way to clear a single hot cue — only clear ALL

**Priority:** Medium
**Blocked by:** nothing — needs a design pass on the cleanest UX before building (see below).

**What:** D noticed the console only offers a bulk "clear all cues" action — there's no way to clear one individual hot cue without wiping every cue on the deck. Flagged directly by D, relayed by L (2026-08-11).

**Why:** Real workflow gap for D — clearing one mis-placed cue currently means losing all of them and re-setting the rest from scratch.

**Context:** Needs a scoping pass before implementation: cleanest UX is not yet decided (options likely include a per-cue right-click/long-press clear, a modifier-click on the cue pad itself, or a small "x" affordance next to each cue in whatever list/pad UI currently renders them — find and read that UI first). Should be looked at together with the broader idea below rather than bolted on in isolation.

**Related, broader scope (not yet its own TODO — needs shaping first):** L separately asked to consider a full review of all console buttons/controls — their functionality, discoverability (hints/tooltips), and whether the COMMS status LCD (`announceStatus()`, added 2026-07-22 session, sibling to the REACH LCD) is being used to its full intended potential for surfacing this kind of state/feedback. Worth a dedicated `/design-review` or `/office-hours` pass rather than folding into a single-cue-clear fix — the single-cue-clear gap is a good concrete example to bring INTO that review, not a substitute for it.

**Depends on:** Nothing technical. Needs a UX decision (with L/D) before building.

---

### Extend WF (DeckWaveformV2) to the same 5-band Bark color scheme as SA

**Priority:** Medium
**Blocked by:** SA's 5-band proposal finishing its `/plan-design-review` pass and shipping first (2026-08-12 plan: `vivid-finding-riddle.md`, "DECIDED — SA 5-band color scheme, Bark critical-band boundaries").

**What:** L confirmed direct intent to move WF's bass/mid/high coloring to the same 5-band, Bark-critical-band-derived scheme just locked in for the SA (low/mid-low/mid/mid-high/high; red/red-orange/green/cyan/indigo — indigo is the top-end anchor, matching real ROYGBIV spectrum order, not a middle band) — explicitly wants SA correct first, WF second, not simultaneous.

**Why:** DESIGN.md states SA's band scheme exists specifically to keep SA and WF "speaking the same visual dialect." Moving only SA to 5 bands leaves that stated coherence goal unmet until WF follows. Also a real design opportunity on its own — WF has never had its band math re-examined the way SA's just was.

**Context:** Not a copy-paste of SA's implementation. SA colors 150 independent frequency bars; WF colors per-time-slice via a screen-blend RGB model showing which band dominates at that instant in the waveform (`DeckWaveformV2.jsx` / `src/lib/waveformAnalyzer.js`). The Bark boundary Hz values themselves carry over unchanged (534/1230/2579/5927Hz) but the color-blending logic needs its own design pass, not a mechanical port. Same colorblind-simulation check (deuteranopia/protanopia) that caught the orange-vs-green collision on SA should be re-run here before locking a final WF palette — WF's continuous per-pixel blending may behave differently than SA's discrete per-bar coloring under that simulation.

**Depends on:** SA's 5-band scheme shipping and being confirmed live first (L's explicit sequencing).

---

### SA peak-hold ghost-trail color slightly less crisp over Mid-low band (P3 polish)

**Priority:** Low (P3)
**Blocked by:** Nothing — cosmetic, not blocking the 5-band ship.

**What:** The peak-hold "ghost fill" overlay (`rgba(225,85,68,0.42)`, salmon) sits closer in hue to the new Mid-low red-orange band (`#ff5500`) than to the other 4 bands — RGB distance 74 vs. 74-338 for everything else. Still a real, visible difference, just the least crisp of the five.

**Why:** Surfaced during `/plan-design-review` of the SA 5-band color proposal — the deuteranopia-safety fix that moved Mid-low from `#ff8000` to `#ff5500` incidentally pulled it closer to the pre-existing salmon overlay color (was 86 apart, now 74).

**Context:** Tested yellow/gold/amber as alternative ghost-trail colors — all worse, not better: gold vs. green collides almost completely under protanopia (distance 2), amber and pure yellow both sit right at or near the colorblind-safety threshold (30) against green. Salmon remains the best-performing option checked so far — nothing found beats it. If revisited, the fix is a new ghost-trail color verified against all 5 final band colors (`#ff0000`/`#ff5500`/`#00ff00`/`#6600ff`/`#00ffff`) under both deuteranopia and protanopia simulation before adopting, not a guess.

**Depends on:** Nothing technical.

---

## Completed

### AudioContext leak + unthrottled waveform generation on upload

**What:** `analyzeAudio()` never closed its `AudioContext`; `handleUpload` and `loadAndPlay` both bypassed the sequential waveform-generation queue, opening one concurrent decode per file on a multi-file drop.

**Fix:** `analyzeAudio()`'s `decodeAudioData` wrapped in try/finally with `.close()` in both paths; `handleUpload` now routes through `waveformQueueRef`/`runWaveformQueue` via a new `enqueueWaveformGeneration` helper. `loadAndPlay` deliberately calls `ensureWaveformForTrack` directly rather than through the queue — routing it through the queue's playback-pause gate caused a regression (the just-loaded track's own waveform/BPM generation would stall for as long as it played), caught and fixed during pre-ship review.

**Completed:** feat/genre-validation (2026-08-12)
