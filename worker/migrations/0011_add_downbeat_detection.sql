-- Downbeat/bar-phase detection results (src/lib/beatDetector.js's
-- detectDownbeatPhase), computed once during Regenerate/waveform generation
-- alongside detected_bpm. NULL means either flat-tempo detection declined to
-- guess (below MIN_DOWNBEAT_CONTRAST) or the track has drift segments, where
-- the equivalent data lives per-anchor inside beat_grid_points instead.
-- Apply via CF dashboard D1 console (token lacks D1 Edit permission) BEFORE
-- deploying the worker change that references these columns.
ALTER TABLE tracks ADD COLUMN detected_downbeat_offset REAL;
ALTER TABLE tracks ADD COLUMN detected_downbeat_confidence REAL;
