# Changelog

All notable changes to Pleasant Soul Collective will be documented in this file.

## [1.5.0.0] - 2026-08-19

### Added

- **Gapless loop engine** — loops now hand off to a native, sample-accurate
  Web Audio loop instead of a JS-timed seek: zero audible click at the loop
  boundary, and zero-crossing edges are snapped as a matched pair (not
  independently) so the loop length doesn't drift cycle over cycle. Only
  decodes the loop-region slice, never the whole track, so it works on D's
  800MB+ WAV mixes the same as a 3-minute file
- **Chronological hot-cue auto-sort** — the 32 hot-cue pads (4 banks × 8) can
  now auto-arrange themselves by track position instead of staying wherever
  you first clicked, matching Serato's own "sort cues chronologically"
  option. Naming a cue pins it in place so your memorized structural cues
  (drop, breakdown) don't drift when new ones get added around them. Off by
  a click if you'd rather keep the old fixed-pad behavior
- **Bank identity glyphs** — hot-cue pads show a triangle instead of a bare
  number: which way it points and whether it's solid or hollow tells you
  which of the 4 banks you're looking at at a glance, and it lights up in
  the cue's own color once set. Every bank can now be renamed by
  double-clicking it, not just one of the four
- **Smart Crates, for real** — the toggle existed for a while but did
  nothing; it now actually sorts BPM/key-compatible tracks to the top of
  whatever list you're browsing and tags them, so building a compatible set
  around whatever's loaded is one click instead of manual scanning
- Guest sessions now persist which access code redeemed them and quietly
  re-check that code in the background, so a revoked or expired code signs
  a guest out instead of a stale saved session staying valid forever
- A visible `?` button for the keyboard-shortcut legend, a "type HELP" hint
  in the console search box, and a beatgrid discoverability hint on the
  waveform itself — closing a console-wide sweep of controls and features
  that worked fine but had no way to find out they existed
- Individual hot-cue clearing (an `×` on any occupied pad) on all 4 banks,
  and a confirm step on ACCESS CODES REVOKE (previously instant/irreversible
  with no warning, the only destructive console action without one)

### Fixed

- Loop playback had an audible gap at the loop-out point on every cycle —
  first tightened by polling playback position at animation-frame
  resolution instead of the browser's much coarser timing event, then
  fully closed by the native gapless engine above
- The `0000` public guest-access code was briefly broken in production by
  an unrelated session-persistence change that mistook a stale code
  comment for a real feature flag — caught and fixed the same day it
  shipped, before it affected real onboarding for long
- HISTORY track-list filter was silently wired to the wrong internal
  setting and never actually filtered anything
- Recurring Codespace commit-signing failures (`gpg failed to sign the
  data... 403 | Author is invalid`), bypassed for weeks — root cause found:
  the Codespace's signing helper requires your git identity to match your
  GitHub profile's display name, not your username
- Console idle-state text contrast raised to a real legibility floor across
  ~15 button classes and the entire track-list content column — some
  content was as low as 1.7:1 against its background, well under
  accessibility guidelines

### Changed

- T9B, a proposed always-on confidence meter, was designed and then
  cancelled — same call as an earlier ambient-meter idea that didn't earn
  its place next to information already shown as precise text

## [1.4.0.0] - 2026-08-15

### Added

- **BPM confidence badge** on the loaded-deck header — shows detection
  confidence as a colored `CONF NN%` tag (red → red-orange → green → cyan →
  indigo across five confidence bands), the same badge already used in
  track-list rows, now also visible on the deck you're actually playing
- **Tap-tempo manual override** — a `TAP` control next to BPM/LIVE lets you
  set tempo by tapping the beat by hand (4+ taps required; fewer shows
  "keep tapping…"), with outlier-tap rejection so one mistimed tap doesn't
  throw off the reading
- **Onset-envelope explainability row** — hover the waveform to see the
  actual detected onset trace for the beats around your cursor, so you can
  see *why* the detector picked the tempo it did, not just trust the number
- **Beat-detection validation numbers**, in both consoles' settings panels —
  shows real "N/5 genres validated, ±70ms tolerance" numbers, generated
  fresh from the exact code in every build (not a stale CI number)
- **COMMS keyword-help** — type `BEATGRID`, `TAP`, or `VALIDATION` into the
  console search box and press Enter for quick in-context instructions

### Fixed

- Tap-tempo could compute an "Infinity" BPM from a degenerate all-zero-
  interval tap gesture and PATCH that literal string to a track's BPM —
  now falls back to the normal "keep tapping…" state instead
- A mid-gesture tap count or hover position from a previously loaded track
  could bleed into a newly loaded one — both now reset on every deck switch
- The onset-envelope row redrew its canvas's full backing store on every
  mouse movement over the waveform instead of only on an actual resize —
  fixed for smoother hovering

### Infrastructure

- CI's e2e-smoke job now generates the validation-numbers build artifact
  before running Playwright, so tests that check it see real numbers
  instead of always hitting the "pending" fallback

## [1.3.0.0] - 2026-08-14

### Added

- **GOD MODE MOBILE** — D and L can now generate, list, and revoke access
  codes from their phones. A new, narrow `tier === "A" && isMobile` route
  (not the console made responsive — a named, scoped exception to
  DESIGN.md's console-desktop-only rule), with a QR code rendered next to
  each generated code so a guest can scan and auto-join with zero typing
- Single-device binding on `POST /redeem` — once a code is claimed by one
  device, a different device attempting the same code is rejected (409
  "ALREADY CLAIMED"), instead of codes being freely shareable indefinitely
- Native Cloudflare rate limiting on `POST /redeem` (20 req/60s per IP),
  closing a bypass where omitting the fingerprint from the request body
  skipped device-binding enforcement entirely

### Changed

- Access-code device fingerprint moved from `sessionStorage` to
  `localStorage` — required for single-device binding to survive a closed
  browser tab/session without wrongly rejecting the legitimate holder later

### Infrastructure

- Wrangler upgraded 3→4 (worker), required for the native rate-limit binding
- Added `vitest-pool-workers` — this repo's first worker-level test
  infrastructure, scoped to `POST /redeem`'s new branches (14 tests)

### Deferred

- The entry gate's public "REQUEST ACCESS" form remains unwired (a separate,
  larger capability — a stranger-facing request/review queue — tracked in
  TODOS.md, not built this round)

## [1.2.0.0] - 2026-08-13

### Added

- Automatic downbeat detection for uploaded tracks — the console now identifies
  which beat is "beat 1" of each bar, using the existing offline beat-detection
  pipeline (no new upload/analysis pass)
- Loop-length quantize now snaps to the actual detected downbeat when
  confidence is high enough, instead of an arbitrary beat boundary — matches
  what rekordbox/Serato/Traktor already offer
- Gated on confidence, same pattern as existing BPM detection: below the
  threshold, loop quantize behaves exactly as it did before this change

### Fixed

- Loop-length quantize now uses the correct tempo for the current playback
  position on tracks with tempo drift, instead of a single track-wide average
- Stale beatgrid data is now cleared when a track's tempo analysis changes
  from drifting to stable between Regenerates, instead of lingering

## Reconstructed history: 2026-05-26 → 2026-08-13

*This window shipped real work with no formal version bumps — versioning
discipline started with 1.2.0.0. Backfilled 2026-08-14 from `git log` and
session records at L's request, as a record of the project's actual
trajectory. Grouped by theme, dated by the day the work landed on `main`.*

### 2026-08-12 — Beat detection PR2 pre-work, SA color fix, dep pin (PRs #5–#9)

#### Fixed

- Tempo-drift detection re-estimates tempo from the raw onset envelope per
  window and snaps to real onset peaks, instead of feeding the beat
  tracker's own smoothed beat times back into drift detection — the earlier
  approach averaged real drift away before it could ever be measured
  (landed, correctly reverted same day, then re-fixed properly)
- SA (spectrum analyzer) 5-band Bark color scheme corrected — indigo
  restored as the ROYGBIV-order high-band anchor — plus a Nyquist-boundary
  bug in the band-edge math
- Pinned `react-dom` to react's exact version (19.2.6); the mismatch had
  been quietly breaking the dev server

#### Added

- Multi-genre validation suite for tempo detection (PR2 pre-step)

### 2026-07-24 — Beat detection PR1: offline detection, quantize, beatgrid (PR #4)

#### Added

- Offline beat detection (onset envelope + DP beat tracker)
- Multi-point beatgrid — editor, rendering, and tempo-drift auto-seed
- Real Quantize wired for hot cues and loop length
- Playwright stood up with a full E2E spec set for Quantize/detector/beatgrid

#### Fixed

- L's settings page crash (`waveformDetail` never passed)

### 2026-07-21/22 — Vault management tools, INTAKE fix, latency tuning

#### Added

- Move-between-vaults, bulk void/regen, and COMMS status LCD in the console
- Live-tunable beat-offset override for waveform latency compensation

#### Fixed

- INTAKE modal only uploaded the first of multiple dropped files
- Sub-frame identity-leak window closed by resetting the queue in `handleIgnite`

### 2026-06-27/30 — Batch upload hardening, latency auto-compensation

#### Added

- Dynamic audio latency auto-compensation for waveform beat sync
- Guest code session persistence across page refreshes (20-day TTL)
- Inline-editable duration field in the track library

#### Fixed

- Batch upload: duplicate `psc:track-uploaded` event, concurrency,
  double-dispatch, and `consoleOwner` bugs
- Track list duration now updates in memory after waveform generation completes

### 2026-06-18/20 — Batch upload ships, VU meter analog redesign

#### Added

- Drag & drop batch upload with concurrent queue management
- VU meters rebuilt as proper analog instruments: D'Arsonval amplitude-linear
  normalization (not dB-linear), flat wide ellipse-arc sweep instead of a
  circular arc, +6 VU headroom, LED clip indicator, identity-colored L/R
  channels

### 2026-06-12 — Playback smoothing, SA frequency mapping

#### Added

- Playback position smoothing (interpolates only while time is advancing)
- SA logarithmic frequency mapping
- Access code change, waveform regen shortcut, and beat-offset tuning shipped

### 2026-05-27 → 06-03 — Waveform v2 foundation: DeckWaveformV2, analog meters

#### Added

- Rekordbox-style waveform layout overhaul with restored color and transport
  controls
- Screen-blend waveform rendering engine, first prototyped in a sandbox route
  then shipped to production as `DeckWaveformV2` — 3-layer per-band additive
  blend, drag-to-scrub, BPM-aware zoom, beat grid with bar numbers
- Pro-grade console redesign: VU meters (dBFS scale, peak hold, clip
  indicator), φ (phase correlation) meter, and 3-band RGB spectrum analyzer

## [1.1.0] - 2026-05-26

### Added

- Beat grid visualization with ResizeObserver for responsive waveform rendering
- Vibrato meter in waveform display with 3-band screen-blend rendering
- Waveform pinpoints for precise navigation
- Full color range support in waveform visualizer

### Fixed

- Waveform layout and zoom button placement alignment with design system
- Console CSS fixes for improved visual consistency
- Smooth scrolling in waveform viewer (removed integer bar snapping)
- DeckWaveform component formatting for maintainability

### Changed

- Waveform zoom presets now support 8s zoom level
- Mac zoom button handling improved

## Reconstructed history: 2026-03-30 → 2026-05-19

*The [1.0.0] entry below undersells it — real work goes back to the repo's
first commit on 2026-03-30, seven weeks earlier. Backfilled 2026-08-14
alongside the 5-26→8-13 gap above, drawing on `git log` and
`tasks/lessons.md`'s phase narratives for the "why" behind each pivot.*

### 2026-05-19 — Guest access codes, Sprint 1A/1B, security pass

#### Added

- Guest access codes + vault config (T1–T13)
- Sprint 1A: live FFT spectrum analyzer, waveform colors, overview strip,
  energy map, cue labels
- Sprint 1B: ContextStrip, library layout, compact loop controls

#### Fixed

- Audio silence bug — shared a prewarmed `AudioContext` with the live FFT
  analyser instead of each claiming its own
- Audio CORS — routed through the worker proxy to satisfy the Web Audio API

### 2026-05-13/18 — Serato-accurate FFT waveform pipeline, console redesign

#### Added

- Serato-first waveform pipeline + Vitest test baseline
- Serato range-fetch waveform: a 256KB R2 read replaces a 920MB full-file
  decode — the performance fix that made FFT-based waveforms viable at
  scale (later widened to 1MB, then 4MB, to cover large embedded ID3
  artwork)
- Waveform generated from raw WAV PCM via FFT sparse sampling, backed by a
  12-worker concurrency pool
- Multi-band stacked waveform rendering all three Serato colors per bar
- PSC console redesign: instrument layout, display bar, SIGNAL/Zone A
  grouping

#### Fixed

- WAV RIFF ID3 parsing added; the full-decode fallback removed
- VU meter — unified to the correct Serato color scheme on both channels

### 2026-05-10/12 — Phase 10 reconciliation: Cloudflare-only backend

#### Changed

- Removed Supabase; backend rewired to Cloudflare-only (Worker + R2)
- Forward-ported all phase-10 source: console, lockbox, signal, audio,
  listener, state
- Removed the legacy orbital/3D surfaces and deprecated vault modules — the
  final removal of the original cosmic UI (see the design-canon purge below)

#### Added

- Cloudflare upload worker, D1 schema, and migrations ported in
- GitHub Actions workflow for Cloudflare Pages deployment
- Production upload pipeline, deck balance, and hotcue bank workflow
- Unified cinematic redesign across listener, vault, and console
- Accurate Serato color palette; dead "Amethyst"/green-identity code removed

### 2026-04-22/26 — Phase 9: vault wall rewrite, design canon locked (PR #1)

#### Added

- D7 collaborators, voice comments, D console pads, Pull Cord enforcement
- MUSES section, D→L broadcast panel, Void Trigger 3-state ARM→CONFIRM→ACTIVE

#### Changed

- Space/cosmos/chakra language purged from the design canon — the
  platform's aesthetic direction settled permanently as Achromatic
  Brutalist Futurism
- Vault wall rebuilt from a record-shelf metaphor to the file-cell interface
- Tier system corrected: Featured Artists split out from The Destined, with
  each role's actions defined explicitly

#### Fixed

- Vault buttons unreachable for room-stage users (ISSUE-001)

### 2026-04-01/09 — Ignition Sequence: initial scaffold (cosmic/orbital era)

#### Added

- The project's first scaffold: terminal gate logic, an 8-node grid, a Sun
  Node/Black Star vortex transition, Nixie-tube VU meters, and a Command
  Deck radar map — the platform's original aesthetic direction, fully
  scrapped seven weeks later in favor of Achromatic Brutalist Futurism
  (see Phase 9 above)
- 70s Soul Studio Console Foundation — the early instrument-panel direction
  that survived the pivot and carried forward into the console's identity

## [1.0.0] - 2026-05-20

### Added

- Initial Pleasant Soul Collective platform release
- Architect Console for artist management
- Listener Shell for playback
- Basic waveform visualization
- Vault authentication and access control
