// Multi-genre validation suite — PR2's gating pre-step.
//
// The CEO plan review flagged that onsetEnvelope() (the shared foundation
// under item 1's tempo-drift detection, item 4's smoothing, and item 5's
// downbeat detection) is hip-hop/R&B-tuned and had never been tested against
// other genres PSC's roadmap is expanding into — especially house's
// four-on-the-floor rhythm, which the old syntheticClickBars() fixture
// couldn't even represent (it spikes bass+high together; house needs a
// bass-heavy, high-quiet kick). This suite runs the EXISTING pipeline
// (onsetEnvelope -> dpBeatTrack / detectTempoSegments, as shipped in PR1)
// against 5 genre archetypes and gates items 4/5 on it passing.
//
// See deep-rolling-brooks.md for the full empirical verification record
// behind these exact numbers/tolerances, including why breakbeat's
// half-tempo read is correct (not a bug) and a hi-hat-peak dead end that
// shouldn't be rediscovered by trial and error.

import { describe, it, expect } from "vitest";
import { onsetEnvelope, dpBeatTrack, detectTempoSegments } from "../beatDetector";
import { syntheticGenreBars, GENRE_ARCHETYPES, FRAME_RATE } from "./genreFixtures";

const DRIFT_THRESHOLD_PCT = 4; // matches beatDetector.js's own constant
// Mirrors beatDetector.js's (unexported) ONSET_SNAP_MAX_SEC/ONSET_SNAP_PHASE_PCT.
const ONSET_SNAP_MAX_SEC = 0.07; // mir_eval's standard F-measure onset tolerance
const ONSET_SNAP_PHASE_PCT = 0.175; // mir_eval's continuity_phase_threshold

// Octave ambiguity (half-time/double-time) is a first-class, expected
// property of tempo estimation, not a special case — verified against
// mir_eval's actual tempo.py (MIREX standard), which evaluates against TWO
// reference tempi for exactly this reason. Mirrors the existing
// "dpBeatTrack — octave-error awareness" test group's exact check.
function isPlausibleOctave(detectedBpm, trueBpm) {
  const ratio = detectedBpm / trueBpm;
  return [0.5, 1, 2].some((m) => Math.abs(ratio - m) < 0.1);
}

const OCTAVE_TOLERANT = new Set(["breakbeat"]);

// Multiplier applied to each archetype's nominal bpm for tempo-change tests.
// 1.25x works for 4 of 5 archetypes; breakbeat's ~170bpm range quantizes at a
// coarser stepFrames granularity where 1.25x (212.5) happens to round to the
// SAME stepFrames as 170 (both -> 4), aliasing to zero actual drift —
// verified empirically, not a detector bug. 0.8x moves it to a genuinely
// different quantized tempo. Shared module-level so both the false-drift and
// beat-timing describe blocks below use the same shift.
const AFTER_MULTIPLIER = { breakbeat: 0.8 };

describe("GENRE_ARCHETYPES data integrity", () => {
  it.each(Object.entries(GENRE_ARCHETYPES))(
    "%s's bass/mid/high patterns are each exactly 16 steps",
    (name, spec) => {
      expect(spec.bassPattern).toHaveLength(16);
      expect(spec.midPattern).toHaveLength(16);
      expect(spec.highPattern).toHaveLength(16);
    },
  );
});

describe("syntheticGenreBars", () => {
  it("produces durationSec*FRAME_RATE frames and a correctly quantized actualBpm", () => {
    const silence = new Array(16).fill(0);
    const { bars, actualBpm, stepFrames } = syntheticGenreBars({
      bpm: 124,
      durationSec: 2,
      bassPattern: silence,
      midPattern: silence,
      highPattern: silence,
    });
    expect(bars).toHaveLength(100); // 2s * 50fps
    expect(actualBpm).toBeCloseTo((60 * FRAME_RATE) / (4 * stepFrames), 6);
  });

  it("floors every band at noiseFloor when the pattern has no energy at a step", () => {
    const silence = new Array(16).fill(0);
    const { bars } = syntheticGenreBars({
      bpm: 124,
      durationSec: 1,
      bassPattern: silence,
      midPattern: silence,
      highPattern: silence,
      noiseFloor: 0.05,
    });
    for (const b of bars) {
      expect(b.bass).toBeCloseTo(0.05, 5);
      expect(b.mid).toBeCloseTo(0.05, 5);
      expect(b.high).toBeCloseTo(0.05, 5);
      expect(b.peak).toBeCloseTo(0.05, 5);
    }
  });
});

describe("multi-genre validation — BPM accuracy", () => {
  for (const [name, spec] of Object.entries(GENRE_ARCHETYPES)) {
    it(`detects ${name}'s tempo correctly`, () => {
      const { bars, actualBpm } = syntheticGenreBars(spec);
      const env = onsetEnvelope(bars);
      const result = dpBeatTrack(env, { frameRate: FRAME_RATE });

      expect(result.bpm).not.toBeNull();

      if (OCTAVE_TOLERANT.has(name)) {
        expect(isPlausibleOctave(result.bpm, actualBpm)).toBe(true);
      } else {
        const pctErr = (Math.abs(result.bpm - actualBpm) / actualBpm) * 100;
        expect(pctErr).toBeLessThanOrEqual(DRIFT_THRESHOLD_PCT);
      }
    });
  }

  // The exact claim the CEO review needed verified — named separately so a
  // future regression here reads as "house broke," not just "a loop test failed."
  it("house's four-on-the-floor kick is detected with zero onsetEnvelope() changes", () => {
    const { bars, actualBpm } = syntheticGenreBars(GENRE_ARCHETYPES.house);
    const env = onsetEnvelope(bars);
    const result = dpBeatTrack(env, { frameRate: FRAME_RATE });
    const pctErr = (Math.abs(result.bpm - actualBpm) / actualBpm) * 100;
    expect(pctErr).toBeLessThanOrEqual(DRIFT_THRESHOLD_PCT);
  });
});

describe("multi-genre validation — no false drift on constant-tempo genre material", () => {
  for (const [name, spec] of Object.entries(GENRE_ARCHETYPES)) {
    it(`${name} at constant tempo does not trigger a spurious drift anchor`, () => {
      const { bars } = syntheticGenreBars(spec);
      const env = onsetEnvelope(bars);
      const segments = detectTempoSegments(env, FRAME_RATE);
      // A non-null result here means PR1's onset-snap logic is fabricating
      // drift on genre material it's never been tested against.
      expect(segments).toBeNull();
    });

    it(`${name} at its tempo-change test's shifted tempo (${AFTER_MULTIPLIER[name] ?? 1.25}x) also does not trigger a spurious drift anchor`, () => {
      // The beat-timing describe block below shifts each archetype by
      // AFTER_MULTIPLIER to construct a genuine drift event. This confirms
      // the shifted tempo ITSELF is clean at constant tempo — if it weren't,
      // that block's "before+after" construction could be seeding a second,
      // unverified drift-detection edge case alongside the intended one.
      const multiplier = AFTER_MULTIPLIER[name] ?? 1.25;
      const { bars } = syntheticGenreBars({ ...spec, bpm: spec.bpm * multiplier });
      const env = onsetEnvelope(bars);
      const segments = detectTempoSegments(env, FRAME_RATE);
      expect(segments).toBeNull();
    });
  }
});

describe("multi-genre validation — beat-timing accuracy at a genuine tempo change", () => {
  // Reuses the exact construction already proven in beatDetector.test.js's
  // "detects a genuine tempo change and places an anchor at the transition"
  // (multiTempoEnvelope, 40s segments — a multiple of the 8s drift window),
  // parameterized per archetype instead of per click-track. This is what
  // ONSET_SNAP_MAX_SEC/ONSET_SNAP_PHASE_PCT actually govern — onset-snap
  // accuracy at a real drift event — not dpBeatTrack's full beat-grid phase,
  // which is a DP-backtrace artifact unrelated to genre robustness.
  const SEG_DUR_SEC = 40; // AFTER_MULTIPLIER is shared at module scope (see above)

  for (const [name, spec] of Object.entries(GENRE_ARCHETYPES)) {
    it(`${name}'s tempo-change anchor lands within tolerance of the true transition`, () => {
      const multiplier = AFTER_MULTIPLIER[name] ?? 1.25;
      const before = syntheticGenreBars({ ...spec, durationSec: SEG_DUR_SEC });
      const after = syntheticGenreBars({
        ...spec,
        bpm: spec.bpm * multiplier, // clear drift, same rhythmic pattern
        durationSec: SEG_DUR_SEC,
      });
      const bars = [...before.bars, ...after.bars];
      const env = onsetEnvelope(bars);
      const anchors = detectTempoSegments(env, FRAME_RATE);

      expect(anchors).not.toBeNull();
      const transitionAnchor = anchors.find((a) => a.time > 2);
      expect(transitionAnchor).toBeDefined();

      // Tolerance basis matches production: the transition window's content is
      // entirely from the AFTER segment (window boundaries align exactly with
      // SEG_DUR_SEC), so detectTempoSegments' own per-window tolerance is
      // derived from after.actualBpm, not before.actualBpm.
      const truePeriodSec = 60 / after.actualBpm;
      const toleranceSec = Math.min(ONSET_SNAP_MAX_SEC, truePeriodSec * ONSET_SNAP_PHASE_PCT);
      expect(Math.abs(transitionAnchor.time - SEG_DUR_SEC)).toBeLessThanOrEqual(toleranceSec);
    });
  }

  // Every case above lands with exactly zero deviation (each archetype's
  // pattern has a hit on step 0, which is exactly where the transition
  // falls) — that never actually exercises the tolerance math, only proves
  // onset-snap finds a trivially-exact match. This proves the tolerance
  // path is reachable and non-trivial: the after-segment's first hit is
  // deliberately offset from the transition point, so a genuine (small,
  // in-tolerance) snap distance is required for the test to pass.
  it("tolerates a transition anchor that isn't an exact zero-offset match", () => {
    const spec = GENRE_ARCHETYPES.house;
    const before = syntheticGenreBars({ ...spec, durationSec: SEG_DUR_SEC });
    const after = syntheticGenreBars({
      ...spec,
      bpm: spec.bpm * 1.25,
      durationSec: SEG_DUR_SEC,
      bassPattern: [0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], // no hit at step 0
    });
    const bars = [...before.bars, ...after.bars];
    const env = onsetEnvelope(bars);
    const anchors = detectTempoSegments(env, FRAME_RATE);

    expect(anchors).not.toBeNull();
    const transitionAnchor = anchors.find((a) => a.time > 2);
    expect(transitionAnchor).toBeDefined();

    const deviation = Math.abs(transitionAnchor.time - SEG_DUR_SEC);
    const truePeriodSec = 60 / after.actualBpm;
    const toleranceSec = Math.min(ONSET_SNAP_MAX_SEC, truePeriodSec * ONSET_SNAP_PHASE_PCT);
    expect(deviation).toBeGreaterThan(0); // proves this case isn't a trivial exact match
    expect(deviation).toBeLessThanOrEqual(toleranceSec);
  });
});
