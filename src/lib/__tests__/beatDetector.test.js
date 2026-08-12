import { describe, it, expect } from "vitest";
import {
  onsetEnvelope,
  dpBeatTrack,
  detectTempoSegments,
  smoothWindowedTempo,
  findNearestOnsetPeak,
} from "../beatDetector";

const FRAME_RATE = 50;
const DRIFT_WINDOW_SEC = 8;
const WINDOW_FRAMES = DRIFT_WINDOW_SEC * FRAME_RATE; // 400

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

// Builds an onset envelope for a track whose tempo changes at segment
// boundaries — concatenates independent syntheticClickBars() runs so each
// segment's periodicity is genuinely local, the same shape dpBeatTrack's
// globally-smoothed beatTimesSec could NOT represent (that's the bug the
// windowed-envelope approach fixes: drift detection must run on the raw
// envelope, not on a beat sequence already forced toward a single tempo).
function multiTempoEnvelope(segments) {
  const bars = segments.flatMap(({ bpm, durationSec }) => syntheticClickBars(bpm, durationSec));
  return onsetEnvelope(bars);
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

describe("detectTempoSegments", () => {
  it("returns null for insufficient data (not enough windows to say anything about drift)", () => {
    expect(detectTempoSegments(null, FRAME_RATE)).toBeNull();
    expect(detectTempoSegments([], FRAME_RATE)).toBeNull();
    const shortEnv = multiTempoEnvelope([{ bpm: 120, durationSec: 5 }]); // well under 2 windows (16s)
    expect(detectTempoSegments(shortEnv, FRAME_RATE)).toBeNull();
  });

  it("returns null for a track with constant tempo — MUST NOT write a spurious single-anchor grid", () => {
    // 120 BPM's period (25 frames) divides the 400-frame window evenly, so
    // every window boundary lands exactly on a real onset — isolates "no
    // drift detected" from any window-snap starvation as the reason for null.
    const env = multiTempoEnvelope([{ bpm: 120, durationSec: 80 }]);
    expect(detectTempoSegments(env, FRAME_RATE)).toBeNull();
  });

  it("detects a genuine tempo change and places an anchor at the transition", () => {
    // Both segment durations (40s) are multiples of the 8s window, and both
    // BPMs' periods (25 and 20 frames) divide the 400-frame window evenly —
    // every window boundary in both segments lands exactly on a real onset,
    // and the transition falls exactly on a window boundary (window 5, 40s).
    const env = multiTempoEnvelope([
      { bpm: 120, durationSec: 40 },
      { bpm: 150, durationSec: 40 },
    ]);
    const anchors = detectTempoSegments(env, FRAME_RATE);
    expect(anchors).not.toBeNull();
    expect(anchors.length).toBeGreaterThanOrEqual(2);
    expect(anchors[0].bpm).toBeCloseTo(120, 0);
    expect(anchors[anchors.length - 1].bpm).toBeCloseTo(150, 0);
    // anchors[0].time is snapped to the nearest real onset near t=0, which
    // may itself be a frame or two off zero — "time > 0" alone can't
    // distinguish that from the actual transition, so require it be well
    // into the track (only the transition anchor should qualify).
    const transitionAnchor = anchors.find((a) => a.time > 5);
    expect(transitionAnchor).toBeDefined();
    expect(transitionAnchor.time).toBeGreaterThan(35);
    expect(transitionAnchor.time).toBeLessThan(45);
  });

  it("detects multiple tempo changes across a track", () => {
    const env = multiTempoEnvelope([
      { bpm: 120, durationSec: 24 },
      { bpm: 150, durationSec: 24 },
      { bpm: 75, durationSec: 24 },
    ]);
    const anchors = detectTempoSegments(env, FRAME_RATE);
    expect(anchors).not.toBeNull();
    expect(anchors.length).toBeGreaterThanOrEqual(3);
  });

  it("every returned anchor has finite time and bpm (never NaN/Infinity)", () => {
    const env = multiTempoEnvelope([
      { bpm: 120, durationSec: 40 },
      { bpm: 150, durationSec: 40 },
    ]);
    const anchors = detectTempoSegments(env, FRAME_RATE);
    for (const a of anchors) {
      expect(Number.isFinite(a.time)).toBe(true);
      expect(Number.isFinite(a.bpm)).toBe(true);
      expect(a.bpm).toBeGreaterThan(0);
    }
  });

  it("skips windows too quiet to estimate a tempo from, rather than guessing", () => {
    // A window of near-silence sandwiched between real click-track segments
    // — estimateTempoPeriod's energy<=0 guard should make that window
    // contribute nothing, not throw or seed a bad anchor.
    const clickSeg = syntheticClickBars(120, 24);
    const silentSeg = new Array(WINDOW_FRAMES).fill({ bass: 0, mid: 0, high: 0, peak: 0 });
    const bars = [...clickSeg, ...silentSeg, ...clickSeg];
    const env = onsetEnvelope(bars);
    expect(() => detectTempoSegments(env, FRAME_RATE)).not.toThrow();
    const result = detectTempoSegments(env, FRAME_RATE);
    if (result) {
      for (const a of result) {
        expect(Number.isFinite(a.time)).toBe(true);
        expect(Number.isFinite(a.bpm)).toBe(true);
      }
    }
  });
});

describe("smoothWindowedTempo — reject-then-corroborate", () => {
  it("rejects a single-window spike with no corroboration, holds flat", () => {
    const windows = [
      { time: 0, bpm: 120 },
      { time: 8, bpm: 130 }, // spike
      { time: 16, bpm: 120 }, // back to baseline — does NOT corroborate the spike
    ];
    const smoothed = smoothWindowedTempo(windows);
    expect(smoothed.map((w) => w.bpm)).toEqual([120, 120, 120]);
  });

  it("accepts a sustained change once the next window corroborates it", () => {
    const windows = [
      { time: 0, bpm: 120 },
      { time: 8, bpm: 130 },
      { time: 16, bpm: 130 }, // corroborates
      { time: 24, bpm: 130 },
    ];
    const smoothed = smoothWindowedTempo(windows);
    expect(smoothed.map((w) => w.bpm)).toEqual([120, 130, 130, 130]);
  });

  it("holds a trailing uncorroborated window flat (no next window to confirm it)", () => {
    const windows = [
      { time: 0, bpm: 120 },
      { time: 8, bpm: 130 }, // last window, nothing after it to corroborate
    ];
    const smoothed = smoothWindowedTempo(windows);
    expect(smoothed.map((w) => w.bpm)).toEqual([120, 120]);
  });

  it("rejects corroboration from a window too far away in time, despite matching bpm", () => {
    // Gap between the candidate (8s) and its only "corroborating" reading
    // (30s) is 22s > maxGapSec(16s) — too far apart in time to trust as the
    // same drift event, even though the bpm values agree exactly.
    const windows = [
      { time: 0, bpm: 120 },
      { time: 8, bpm: 130 },
      { time: 30, bpm: 130 },
    ];
    const smoothed = smoothWindowedTempo(windows);
    expect(smoothed[0].bpm).toBe(120);
    expect(smoothed[1].bpm).toBe(120); // held flat — gap too large to corroborate
  });

  it("passes through empty/single-element input unchanged", () => {
    expect(smoothWindowedTempo([])).toEqual([]);
    expect(smoothWindowedTempo(null)).toEqual([]);
    const single = [{ time: 0, bpm: 120 }];
    expect(smoothWindowedTempo(single)).toEqual(single);
  });
});

describe("findNearestOnsetPeak", () => {
  it("finds a local peak within tolerance", () => {
    const env = [0, 0.1, 0.2, 0.9, 0.2, 0.1, 0]; // peak at index 3
    expect(findNearestOnsetPeak(env, 3, 2)).toBe(3);
    expect(findNearestOnsetPeak(env, 2, 2)).toBe(3); // nearest peak from an offset target
  });

  it("returns -1 when nothing in range is a genuine local peak", () => {
    const monotonic = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6]; // strictly increasing — no local max anywhere
    expect(findNearestOnsetPeak(monotonic, 3, 2)).toBe(-1);
  });

  it("returns -1 when the tolerance window doesn't reach any peak", () => {
    const env = [0, 0, 0, 0.9, 0, 0, 0]; // peak at index 3, far from target
    expect(findNearestOnsetPeak(env, 0, 1)).toBe(-1); // target 0, tolerance 1 -> range [0,1], never reaches index 3
  });

  it("picks the strongest peak when multiple exist in range", () => {
    const env = [0, 0.5, 0.2, 0.9, 0.2, 0.5, 0]; // two local peaks: index 1 (0.5) and index 3 (0.9), index 5 also a peak (0.5, boundary)
    expect(findNearestOnsetPeak(env, 3, 3)).toBe(3); // strongest wins, not just nearest
  });

  it("finds a genuine onset peak at frame 0 (no left neighbor to compare against)", () => {
    const env = [0.9, 0.2, 0, 0, 0];
    expect(findNearestOnsetPeak(env, 0, 1)).toBe(0);
  });
});

describe("detectTempoSegments — invalid frameRate/windowSec must not hang", () => {
  it("returns null instead of looping forever when frameRate is 0", () => {
    const envelope = new Array(2000).fill(0.5);
    expect(detectTempoSegments(envelope, 0)).toBeNull();
  });

  it("returns null instead of looping forever when frameRate is negative", () => {
    const envelope = new Array(2000).fill(0.5);
    expect(detectTempoSegments(envelope, -50)).toBeNull();
  });

  it("returns null instead of looping forever when opts.windowSec is 0", () => {
    const envelope = new Array(2000).fill(0.5);
    expect(detectTempoSegments(envelope, 50, { windowSec: 0 })).toBeNull();
  });
});
