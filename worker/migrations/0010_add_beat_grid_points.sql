-- Multi-point beatgrid anchor data for tracks with tempo drift (D's live
-- mixes/WAV sets). JSON array of {time: seconds, bpm: number}, same
-- JSON-in-TEXT-column pattern as cue_labels (migration 0006). NULL/empty
-- means the track uses the flat single-BPM grid (today's behavior, unchanged).
-- Apply via CF dashboard D1 console (token lacks D1 Edit permission) BEFORE
-- deploying the worker change that references this column.
ALTER TABLE tracks ADD COLUMN beat_grid_points TEXT DEFAULT NULL;
