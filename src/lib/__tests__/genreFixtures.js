// Synthetic multi-genre bars generator — the PR2 pre-step's foundation.
//
// Unlike beatDetector.test.js's syntheticClickBars() (which spikes bass and
// high together from the same value), this decouples all three bands per
// 16th-note step, so a bass-heavy/high-quiet house kick can actually be
// represented. Non-test module (not *.test.js) so Item 5's future downbeat
// tests can import GENRE_ARCHETYPES/syntheticGenreBars too — the first case
// in this repo needing a fixture shared across test files.
//
// Archetypes are structurally-distinct synthetic stress patterns representing
// the CLASS of tempo-detection challenge each genre poses (bass/high
// decoupling, syncopation, sparse-vs-dense subdivision) — not claimed as
// musicologically precise transcriptions. Exact numbers verified empirically
// against the real onsetEnvelope/dpBeatTrack/detectTempoSegments exports
// before being locked in here (see deep-rolling-brooks.md for the full
// verification record, including a hi-hat-peak dead end worth not repeating).

const BEATS_PER_BAR = 4; // 4/4 time
const SIXTEENTHS_PER_BEAT = 4;
const STEPS_PER_BAR = BEATS_PER_BAR * SIXTEENTHS_PER_BEAT; // 16th-note resolution
export const FRAME_RATE = 50; // must match BEAT_DETECTOR_FRAME_RATE (waveformAnalyzer.js) — exported so callers don't redeclare the same literal

/**
 * @param {object} spec
 * @param {number} spec.bpm nominal tempo — NOT the ground truth, see actualBpm below
 * @param {number} spec.durationSec
 * @param {number[]} spec.bassPattern 16-length, energy 0-1 per 16th-note step
 * @param {number[]} spec.midPattern
 * @param {number[]} spec.highPattern
 * @param {number} [spec.noiseFloor]
 * @returns {{bars: {bass:number,mid:number,high:number,peak:number}[], actualBpm: number, stepFrames: number}}
 *   actualBpm is the GROUND TRUTH after frame-quantization (16th-note duration
 *   must round to an integer number of frames), not the nominal input bpm —
 *   compare detected BPM against actualBpm, not bpm, or tests measure
 *   generator rounding error instead of detector accuracy.
 */
export function syntheticGenreBars({
  bpm,
  durationSec,
  bassPattern,
  midPattern,
  highPattern,
  noiseFloor = 0.02,
}) {
  const stepFrames = Math.max(1, Math.round((60 / bpm / SIXTEENTHS_PER_BEAT) * FRAME_RATE));
  const actualBpm = (60 * FRAME_RATE) / (SIXTEENTHS_PER_BEAT * stepFrames);
  const totalFrames = Math.round(durationSec * FRAME_RATE);
  const bars = [];
  for (let i = 0; i < totalFrames; i++) {
    const stepIdx = Math.floor(i / stepFrames) % STEPS_PER_BAR;
    const isStepStart = i % stepFrames === 0;
    const b = isStepStart ? (bassPattern[stepIdx] ?? 0) : 0;
    const m = isStepStart ? (midPattern[stepIdx] ?? 0) : 0;
    const h = isStepStart ? (highPattern[stepIdx] ?? 0) : 0;
    bars.push({
      bass: Math.max(b, noiseFloor),
      mid: Math.max(m, noiseFloor),
      high: Math.max(h, noiseFloor),
      peak: Math.max(b, m, h, noiseFloor),
    });
  }
  return { bars, actualBpm, stepFrames };
}

// 5 archetypes, each a { bpm, durationSec, bassPattern, midPattern, highPattern }
// spec ready to pass straight into syntheticGenreBars(). Only breakbeat is
// expected to land on a half-tempo octave rather than an exact match — see
// GSTACK REVIEW REPORT / plan doc for why that's correct, not a bug.
export const GENRE_ARCHETYPES = {
  house: {
    bpm: 124,
    durationSec: 64,
    // Four-on-the-floor kick (bass, every beat) — the case the CEO review
    // worried onsetEnvelope() couldn't handle. Hats fully decoupled (high only).
    bassPattern: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    midPattern: new Array(16).fill(0),
    highPattern: [0, 0, 0.5, 0, 0, 0, 0.8, 0, 0, 0, 0.5, 0, 0, 0, 0.8, 0],
  },
  "hip-hop": {
    bpm: 90,
    durationSec: 64,
    bassPattern: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0], // kick 1, and-of-2
    midPattern: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], // snare 2, 4
    highPattern: [0.3, 0, 0.3, 0, 0.7, 0, 0.3, 0, 0.3, 0, 0.3, 0, 0.7, 0, 0.3, 0],
  },
  "half-time-trap": {
    bpm: 140,
    durationSec: 64,
    // Quarter-note-locked low pulse (808-style sustain/retrigger) under a
    // strong downbeat kick + sparse half-time snare (beat 3 only). Hats are
    // deliberately QUIET (0.15) — see the plan's "dead end" note: a uniform,
    // louder hat pattern floods onsetEnvelope's flux term and breaks this
    // archetype's tempo reading entirely (verified, not assumed).
    bassPattern: [1, 0, 0, 0, 0.35, 0, 0, 0, 0.35, 0, 0, 0, 0.35, 0, 0, 0],
    midPattern: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    highPattern: new Array(16).fill(0.15),
  },
  breakbeat: {
    bpm: 170,
    durationSec: 64,
    // On-grid kick anchor (steps 0, 8) with syncopated ghost hits around it —
    // expected to read at exactly half tempo (verified against mir_eval's own
    // two-reference-tempo standard: octave ambiguity is a first-class,
    // expected property of tempo estimation, not a bug to design around).
    bassPattern: [1, 0, 0, 0, 0, 0, 0, 0.3, 1, 0, 0, 0, 0, 0, 0.3, 0],
    midPattern: [0, 0, 0, 0, 1, 0, 0, 0.4, 0, 0, 0, 0, 1, 0, 0, 0.4],
    highPattern: [0, 0, 0, 0, 1, 0, 0, 0.4, 0, 0, 0, 0, 1, 0, 0, 0.4],
  },
  afrobeats: {
    bpm: 112,
    durationSec: 64,
    bassPattern: [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0], // clave-like log-drum syncopation
    midPattern: new Array(16).fill(0),
    highPattern: [0.3, 0, 0.3, 0, 0.3, 0, 0.3, 0, 0.3, 0, 0.3, 0, 0.3, 0, 0.3, 0], // steady shaker
  },
};
