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

## [1.0.0] - 2026-05-20

### Added

- Initial Pleasant Soul Collective platform release
- Architect Console for artist management
- Listener Shell for playback
- Basic waveform visualization
- Vault authentication and access control
