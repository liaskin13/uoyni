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

// Deterministic PRNG (mulberry32) — jittered fixtures must be reproducible
// across test runs, not seeded off real randomness. Same seed always
// produces the same jitter sequence.
function mulberry32(seed) {
  let state = seed | 0;
  return function () {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {object} spec
 * @param {number} spec.bpm nominal tempo — NOT the ground truth, see actualBpm below
 * @param {number} spec.durationSec
 * @param {number[]} spec.bassPattern 16-length, energy 0-1 per 16th-note step
 * @param {number[]} spec.midPattern
 * @param {number[]} spec.highPattern
 * @param {number} [spec.noiseFloor]
 * @param {number} [spec.jitterFrac] fraction of one 16th-note step (0-1) each
 *   hit may shift earlier/later, simulating microtiming/groove — real,
 *   deliberate, non-quantized timing deviation within a STABLE tempo, not
 *   detection noise. 0 (default) reproduces today's byte-identical
 *   quantized-grid placement — every existing archetype/test is unaffected.
 *   The jitter offset is clamped to stay inside the hit's own step window,
 *   so pattern identity (which step a hit belongs to) is never disturbed —
 *   only its exact frame within that window.
 * @param {number} [spec.jitterSeed] mulberry32 seed — same seed always
 *   produces the same jitter sequence (default 1).
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
  jitterFrac = 0,
  jitterSeed = 1,
}) {
  const stepFrames = Math.max(1, Math.round((60 / bpm / SIXTEENTHS_PER_BEAT) * FRAME_RATE));
  const actualBpm = (60 * FRAME_RATE) / (SIXTEENTHS_PER_BEAT * stepFrames);
  const totalFrames = Math.round(durationSec * FRAME_RATE);
  const rand = mulberry32(jitterSeed);
  const maxJitterFrames = Math.floor(jitterFrac * stepFrames);

  // Precompute, per step, which frame within its own window carries the
  // hit — nominally the step-start frame, shifted by a bounded random
  // offset. Clamped to [step-start, step-start + stepFrames - 1] so a hit
  // never crosses into a neighboring step's window (that would change
  // which pattern step it represents, not just when within it).
  const numSteps = Math.ceil(totalFrames / stepFrames);
  const hitFrameForStep = new Array(numSteps);
  for (let s = 0; s < numSteps; s++) {
    const nominal = s * stepFrames;
    const jitter = maxJitterFrames > 0 ? Math.round((rand() * 2 - 1) * maxJitterFrames) : 0;
    const lo = nominal;
    const hi = Math.min(nominal + stepFrames - 1, totalFrames - 1);
    hitFrameForStep[s] = Math.max(lo, Math.min(hi, nominal + jitter));
  }

  const bars = new Array(totalFrames);
  for (let i = 0; i < totalFrames; i++) {
    const stepIdx = Math.floor(i / stepFrames);
    const patternIdx = stepIdx % STEPS_PER_BAR;
    const isHitFrame = i === hitFrameForStep[stepIdx];
    const b = isHitFrame ? (bassPattern[patternIdx] ?? 0) : 0;
    const m = isHitFrame ? (midPattern[patternIdx] ?? 0) : 0;
    const h = isHitFrame ? (highPattern[patternIdx] ?? 0) : 0;
    bars[i] = {
      bass: Math.max(b, noiseFloor),
      mid: Math.max(m, noiseFloor),
      high: Math.max(h, noiseFloor),
      peak: Math.max(b, m, h, noiseFloor),
    };
  }
  return { bars, actualBpm, stepFrames };
}

// Builds bars + beatTimesSec for a fixed-tempo click track where bass energy
// is strong only in a 120ms window after beats at `downbeatPhase` (mod 4),
// and near-floor elsewhere — isolates PR2 Item 5's downbeat-phase-detection
// decision from tempo estimation entirely (beat times are given directly,
// not derived from dpBeatTrack). Shared by beatDetector.test.js and
// waveformAnalyzer.test.js — same reuse rationale as syntheticGenreBars above.
const DOWNBEAT_WINDOW_MS = 120; // must match beatDetector.js's BASS_WINDOW_MS

export function phaseWeightedBars({ bpm = 120, numBeats, downbeatPhase, strongBass = 1.0, weakBass = 0.02 }) {
  const beatPeriodSec = 60 / bpm;
  const beatTimesSec = Array.from({ length: numBeats }, (_, i) => i * beatPeriodSec);
  const totalFrames = Math.round((numBeats + 1) * beatPeriodSec * FRAME_RATE);
  const windowFrames = Math.round((DOWNBEAT_WINDOW_MS / 1000) * FRAME_RATE);
  const bars = Array.from({ length: totalFrames }, () => ({ bass: weakBass }));
  beatTimesSec.forEach((t, i) => {
    if (i % 4 !== downbeatPhase) return;
    const start = Math.round(t * FRAME_RATE);
    for (let f = start; f < Math.min(bars.length, start + windowFrames); f++) bars[f].bass = strongBass;
  });
  return { bars, beatTimesSec };
}

// 6 archetypes, each a { bpm, durationSec, bassPattern, midPattern, highPattern }
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
  // Dynamic Tempo Analysis (CONF-badge/genre plan, Phase 3) — the executable
  // proof of the whole plan's thesis: real microtiming/groove is NOT the
  // same thing as tempo drift, and the detector should tell them apart, not
  // conflate "the tempo isn't rigidly periodic" with "the tempo is
  // changing." Same syncopated funk kick/backbeat-snare pattern as the
  // hip-hop archetype's rhythmic character, but every hit gets a bounded
  // random timing shift (jitterFrac 0.15, ~20ms at this bpm/frame-rate —
  // real human "pushed"/"laid-back" feel, not a detection defect) instead
  // of landing exactly on the quantized 16th-note grid.
  //
  // Empirically calibrated against the real onsetEnvelope/dpBeatTrack/
  // detectTempoSegments exports (not guessed) — see the calibration sweep
  // referenced in the plan doc: jitterFrac=0.15 was swept across 10 seeds
  // (jitterSeed=1 locked in here), and at every seed: (a) detected BPM
  // matched actualBpm exactly — jitter never shifted the resolved tempo,
  // (b) detectTempoSegments returned null every time, including at jitter
  // levels far beyond this one (proves "groove ≠ drift" isn't a fragile
  // result), (c) dpBeatTrack confidence measurably dropped vs the SAME
  // pattern with jitterFrac=0 (0.907 → 0.591, a direct ablation isolating
  // jitter's effect from pattern complexity) and lands between the two
  // OCTAVE_CONTROL_CONFIDENCE_THRESHOLD bars (0.35 dynamic / 0.6 static) —
  // this is exactly the differentiating case: would have shown the
  // octave-correct button under the old flat-0.6 rule, correctly stays
  // hidden under the new dynamic-bucket rule.
  funk: {
    bpm: 100,
    durationSec: 64,
    bassPattern: [1, 0, 0, 0.3, 0, 0, 0.6, 0, 0, 0.3, 0, 0, 0, 0, 0.3, 0],
    midPattern: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    highPattern: [0.4, 0, 0.4, 0.2, 0.6, 0, 0.4, 0.2, 0.4, 0, 0.4, 0.2, 0.6, 0, 0.4, 0.2],
    jitterFrac: 0.15,
    jitterSeed: 1,
  },
};
