# Changelog

All notable changes to Pleasant Soul Collective will be documented in this file.

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
