-- Offline beat detection results (src/lib/beatDetector.js), computed once
-- during Regenerate/waveform generation and persisted for display + fallback
-- into resolveTrackBpm(). Manual bpm/bpm_display always take precedence.
-- Apply via CF dashboard D1 console (token lacks D1 Edit permission) BEFORE
-- deploying the worker change that references these columns.
ALTER TABLE tracks ADD COLUMN detected_bpm REAL;
ALTER TABLE tracks ADD COLUMN detected_beat_offset REAL;
ALTER TABLE tracks ADD COLUMN detected_bpm_confidence REAL;
