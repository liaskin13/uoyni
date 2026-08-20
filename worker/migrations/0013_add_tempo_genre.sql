-- Per-track genre tag driving tempo-analysis threshold bucket (dynamic vs
-- static). NULL means "use the console-level default" (DYNAMIC for D).
-- manually_corrected marks a track whose detected_bpm was fixed by hand via
-- the octave-correction control -- kept SEPARATE from detected_bpm_confidence
-- so that field stays an honest measurement (never overloaded to also mean
-- "a human intervened"), per eng review 2A.
-- Apply via CF dashboard D1 console (token lacks D1 Edit permission) BEFORE
-- deploying the worker change that references these columns.
ALTER TABLE tracks ADD COLUMN tempo_genre TEXT DEFAULT NULL;
ALTER TABLE tracks ADD COLUMN manually_corrected INTEGER DEFAULT 0;
