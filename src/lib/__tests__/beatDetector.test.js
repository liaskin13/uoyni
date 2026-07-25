import { describe, it, expect } from "vitest";
import { onsetEnvelope, dpBeatTrack, detectTempoSegments } from "../beatDetector";

const FRAME_RATE = 50;

// Builds a synthetic bars array (what analyzeAudio() would return) with a
// sharp peak/high spike every `periodFrames`, simulating a click track at a
// known BPM. Keeps the detector honest against ground truth rather than
// just checking it doesn't crash.
function syntheticClickBars(bpm, durationSec, { jitter = 0, noiseFloor = 0.02 } = {}) {
  const periodFrames = Math.round((60 / bpm) * FRAME_RATE);
  const totalFrames = Math.round(durationSec * FRAME_RATE);
  const bars = [];
  for (let i = 0; i < totalFrames; i++) {
    const isBeat = i % periodFrames === 0;
    const spike = isBeat ? 1.0 : noiseFloor;
    const j = jitter ? (Math.random() - 0.5) * jitter : 0;
    bars.push({ bass: spike, mid: noiseFloor, high: spike + j, peak: spike });
  }
  return bars;
}

describe("onsetEnvelope", () => {
  it("returns an empty array for empty/missing input", () => {
    expect(onsetEnvelope([])).toEqual([]);
    expect(onsetEnvelope(null)).toEqual([]);
  });

  it("treats missing band fields as 0 without throwing", () => {
    expect(() => onsetEnvelope([{}, {}])).not.toThrow();
  });

  it("registers a positive flux on a quiet-to-loud jump, near-zero on decay", () => {
    const bars = [{ peak: 0, high: 0 }, { peak: 1, high: 1 }, { peak: 0.2, high: 0.1 }];
    const env = onsetEnvelope(bars);
    expect(env[1]).toBeGreaterThan(env[2]); // the onset registers more than the decay
  });
});

describe("dpBeatTrack — degenerate inputs (never crash, never return garbage)", () => {
  it("returns bpm:null, confidence:0 for an empty envelope", () => {
    const result = dpBeatTrack([]);
    expect(result.bpm).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("returns bpm:null, confidence:0 for a flat/silent envelope", () => {
    const flat = new Array(1000).fill(0.001);
    const result = dpBeatTrack(flat);
    expect(result.bpm).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("returns bpm:null, confidence:0 for a too-short envelope (< ~8 beats worth)", () => {
    // 50 frames at 50fps = 1 second — nowhere near 8 beats at any plausible BPM
    const short = new Array(50).fill(0.5);
    const result = dpBeatTrack(short);
    expect(result.bpm).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("never throws and never returns NaN on random noise", () => {
    const noise = Array.from({ length: 2000 }, () => Math.random());
    const result = dpBeatTrack(noise);
    expect(Number.isNaN(result.confidence)).toBe(false);
    if (result.bpm !== null) expect(Number.isFinite(result.bpm)).toBe(true);
  });
});

describe("dpBeatTrack — periodic input (ground truth)", () => {
  it("detects 120 BPM from a clean click track within 1 BPM", () => {
    const bars = syntheticClickBars(120, 30);
    const env = onsetEnvelope(bars);
    const result = dpBeatTrack(env, { frameRate: FRAME_RATE });
    expect(result.bpm).not.toBeNull();
    expect(result.bpm).toBeGreaterThan(119);
    expect(result.bpm).toBeLessThan(121);
    expect(result.confidence).toBeGreaterThan(0.3);
  });

  it("detects 90 BPM from a clean click track within 1 BPM", () => {
    const bars = syntheticClickBars(90, 30);
    const env = onsetEnvelope(bars);
    const result = dpBeatTrack(env, { frameRate: FRAME_RATE });
    expect(result.bpm).toBeGreaterThan(89);
    expect(result.bpm).toBeLessThan(91);
  });

  it("detects a tempo near the top of the plausible range as a plausible octave of 174 BPM", () => {
    // At 174 BPM the click period quantizes to 17 frames (50fps), an actual
    // synthetic rate of ~176.5 BPM. A pure click train's autocorrelation has
    // equally strong peaks at the fundamental period AND at 2x the period
    // (every-other-beat alignment is just as perfect) — classic octave
    // ambiguity, not a bug. This is exactly the case the console's one-click
    // double/halve control exists for (see plan D8) rather than solving it
    // algorithmically, which is explicitly out of scope.
    const bars = syntheticClickBars(174, 30);
    const env = onsetEnvelope(bars);
    const result = dpBeatTrack(env, { frameRate: FRAME_RATE });
    expect(result.bpm).not.toBeNull();
    const ratio = result.bpm / 176.5;
    const isPlausibleOctave = [0.5, 1, 2].some((m) => Math.abs(ratio - m) < 0.05);
    expect(isPlausibleOctave).toBe(true);
  });

  it("returns beat times that land close to the true (frame-quantized) beat grid", () => {
    const bpm = 128;
    const periodFrames = Math.round((60 / bpm) * FRAME_RATE);
    const bars = syntheticClickBars(bpm, 20);
    const env = onsetEnvelope(bars);
    const result = dpBeatTrack(env, { frameRate: FRAME_RATE });
    // The synthetic generator itself quantizes the click period to whole
    // frames, so the actual periodicity in the data is periodFrames/FRAME_RATE,
    // not the literal 60/bpm — compare against what's actually in the data.
    const trueBeatSeconds = periodFrames / FRAME_RATE;
    for (const t of result.beatTimesSec) {
      const nearestMultiple = Math.round(t / trueBeatSeconds) * trueBeatSeconds;
      expect(Math.abs(t - nearestMultiple)).toBeLessThan(1 / FRAME_RATE);
    }
  });

  it("stays reasonably accurate with mild jitter (real-world tracks aren't a metronome)", () => {
    const bars = syntheticClickBars(120, 30, { jitter: 0.15 });
    const env = onsetEnvelope(bars);
    const result = dpBeatTrack(env, { frameRate: FRAME_RATE });
    expect(result.bpm).toBeGreaterThan(115);
    expect(result.bpm).toBeLessThan(125);
  });
});

describe("dpBeatTrack — octave-error awareness (documented limitation)", () => {
  it("a half-tempo click track (60 BPM) is detected as some multiple/submultiple of true tempo", () => {
    // Not asserting exact 60 — DP beat trackers are known to be octave-ambiguous.
    // This test documents the limitation the console's double/halve control exists for.
    const bars = syntheticClickBars(60, 30);
    const env = onsetEnvelope(bars);
    const result = dpBeatTrack(env, { frameRate: FRAME_RATE });
    expect(result.bpm).not.toBeNull();
    const ratio = result.bpm / 60;
    const isPlausibleOctave = [0.5, 1, 2].some((m) => Math.abs(ratio - m) < 0.1);
    expect(isPlausibleOctave).toBe(true);
  });
});

// Builds an onset envelope for a track whose tempo changes at segment
// boundaries — concatenates independent syntheticClickBars() runs so each
// segment's periodicity is genuinely local, the same shape dpBeatTrack's
// globally-smoothed beatTimesSec could NOT represent (that's the bug this
// rewrite fixes: drift detection must run on the raw envelope, not on a
// beat sequence that's already been forced toward a single tempo).
function multiTempoEnvelope(segments) {
  const bars = segments.flatMap(({ bpm, durationSec }) => syntheticClickBars(bpm, durationSec));
  return onsetEnvelope(bars);
}

describe("detectTempoSegments", () => {
  it("returns null for insufficient data (not enough windows to say anything about drift)", () => {
    expect(detectTempoSegments(null, FRAME_RATE)).toBeNull();
    expect(detectTempoSegments([], FRAME_RATE)).toBeNull();
    const shortEnv = multiTempoEnvelope([{ bpm: 120, durationSec: 5 }]);
    expect(detectTempoSegments(shortEnv, FRAME_RATE)).toBeNull();
  });

  it("returns null for a track with constant tempo — MUST NOT write a spurious single-anchor grid", () => {
    const env = multiTempoEnvelope([{ bpm: 128, durationSec: 60 }]);
    expect(detectTempoSegments(env, FRAME_RATE)).toBeNull();
  });

  it("skips near-silent windows instead of seeding a bogus tempo from noise", () => {
    const clickBars = syntheticClickBars(120, 20);
    const silentBars = new Array(20 * FRAME_RATE).fill({ bass: 0, mid: 0, high: 0, peak: 0 });
    const env = onsetEnvelope([...clickBars, ...silentBars, ...clickBars]);
    // Should not throw, and any anchors returned must still be finite/sane —
    // the silent middle window must not corrupt the result.
    const anchors = detectTempoSegments(env, FRAME_RATE);
    if (anchors) {
      for (const a of anchors) {
        expect(Number.isFinite(a.bpm)).toBe(true);
        expect(a.bpm).toBeGreaterThan(0);
      }
    }
  });

  it("detects a genuine tempo change and places an anchor at the transition", () => {
    const env = multiTempoEnvelope([
      { bpm: 120, durationSec: 40 },
      { bpm: 140, durationSec: 40 },
    ]);
    const anchors = detectTempoSegments(env, FRAME_RATE);
    expect(anchors).not.toBeNull();
    expect(anchors.length).toBeGreaterThanOrEqual(2);
    // syntheticClickBars quantizes each period to whole frames, so the true
    // periodicity in the data isn't the literal 120/140 — same caveat the
    // dpBeatTrack tests above document. 120 quantizes exact; 140 -> ~142.86.
    expect(anchors[0].bpm).toBeCloseTo(120, 0);
    expect(anchors[anchors.length - 1].bpm).toBeCloseTo(142.86, 0);
    // The transition anchor should land near where the tempo actually changed (~40s in).
    const transitionAnchor = anchors.find((a) => a.time > 0);
    expect(transitionAnchor.time).toBeGreaterThan(24);
    expect(transitionAnchor.time).toBeLessThan(56);
  });

  it("detects multiple tempo changes across a track", () => {
    const env = multiTempoEnvelope([
      { bpm: 100, durationSec: 32 },
      { bpm: 120, durationSec: 32 },
      { bpm: 90, durationSec: 32 },
    ]);
    const anchors = detectTempoSegments(env, FRAME_RATE);
    expect(anchors).not.toBeNull();
    expect(anchors.length).toBeGreaterThanOrEqual(3);
  });

  it("every returned anchor has finite time and bpm (never NaN/Infinity)", () => {
    const env = multiTempoEnvelope([
      { bpm: 100, durationSec: 32 },
      { bpm: 150, durationSec: 32 },
    ]);
    const anchors = detectTempoSegments(env, FRAME_RATE);
    expect(anchors).not.toBeNull();
    for (const a of anchors) {
      expect(Number.isFinite(a.time)).toBe(true);
      expect(Number.isFinite(a.bpm)).toBe(true);
      expect(a.bpm).toBeGreaterThan(0);
    }
  });
});
