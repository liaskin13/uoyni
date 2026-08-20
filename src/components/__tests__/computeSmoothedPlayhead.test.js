import { describe, it, expect } from "vitest";
import { computeSmoothedPlayhead } from "../DeckWaveformV2";

// Regression coverage for a real bug found + fixed 2026-08-20 while
// investigating a "the loop function looks sticky, not smooth" report.
// Root cause: the previous version compared the fresh playback-source
// reading (rawTime) against the DISPLAY's own drifting wall-clock
// extrapolation baseline, and only re-synced that baseline on a "big
// jump" (>=0.1s delta). That's correct for HTMLAudioElement, where
// rawTime genuinely stays stale for ~200-300ms between real timeupdate
// ticks. It's wrong for the gapless loop engine (loopEngine.js), which
// provides a dense, continuously-accurate rawTime every frame — comparing
// it to a frozen baseline meant completely normal forward playback alone
// crossed the 0.1s threshold roughly every 110-140ms, firing a false
// "seek/wrap" reset that wasn't one. Measured live against a real 0.5s
// loop on production audio: 109 of 132 "reset" events over ~3s were this
// false positive, only 23 were real wraps.
describe("computeSmoothedPlayhead", () => {
  const DUR = 240;

  it("extrapolates via wall-clock elapsed time when the source hasn't produced a new reading (sparse source, e.g. HTMLAudioElement between timeupdate ticks)", () => {
    const state = { lastRawSeen: 10, lastTime: 10, lastTimeUpdate: 1000 };
    // rawTime unchanged since last frame (===lastRawSeen) — the sparse case.
    const result = computeSmoothedPlayhead(10, 1050, true, false, state, DUR);
    expect(result.ct).toBeCloseTo(10.05, 5); // 50ms wall-clock elapsed
    expect(result.state).toBe(state); // baseline untouched while extrapolating
  });

  it("trusts a fresh raw reading directly and re-baselines, even for a tiny forward delta (the dense-source case — this is the actual bug fix)", () => {
    // Simulates the loop engine: rawTime advances by ~16.7ms every frame,
    // same magnitude the previous version's 0.1s threshold would have let
    // through as "small" anyway — but the OLD code compared against a
    // FROZEN baseline (lastTime), so after ~6-8 such frames the gap
    // crossed 0.1s and falsely reset. The fix compares against
    // lastRawSeen instead, which updates every frame, so this case is now
    // simply "fresh data, use it" on every single frame — never drifts
    // toward a threshold at all.
    const state = { lastRawSeen: 10.0, lastTime: 10.0, lastTimeUpdate: 1000 };
    const result = computeSmoothedPlayhead(10.0167, 1016.7, true, false, state, DUR);
    expect(result.ct).toBe(10.0167);
    expect(result.state).toEqual({ lastRawSeen: 10.0167, lastTime: 10.0167, lastTimeUpdate: 1016.7 });
  });

  it("does not falsely reset across many consecutive dense-source frames within one short loop cycle (the exact regression)", () => {
    // Simulates ~8 frames of a loop engine advancing at real-time rate
    // (~16.7ms/frame) within a single 0.5s loop cycle — well past the old
    // 0.1s threshold in cumulative drift from a frozen baseline, but each
    // individual frame's raw delta is tiny. Every frame should land in
    // the "fresh data" branch and track rawTime exactly, with zero
    // spurious "big jump" resets — verified by ct exactly matching each
    // frame's rawTime, not diverging via stale wall-clock extrapolation.
    let state = { lastRawSeen: 0, lastTime: 0, lastTimeUpdate: 0 };
    let now = 0;
    let rawTime = 0;
    for (let frame = 0; frame < 8; frame++) {
      now += 16.7;
      rawTime += 0.0167;
      const result = computeSmoothedPlayhead(rawTime, now, true, false, state, DUR);
      expect(result.ct).toBeCloseTo(rawTime, 6);
      state = result.state;
    }
  });

  it("snaps immediately to the new position on a genuine loop wrap (large negative delta)", () => {
    const state = { lastRawSeen: 22.14, lastTime: 22.14, lastTimeUpdate: 5000 };
    const result = computeSmoothedPlayhead(21.59, 5017, true, false, state, DUR); // wrapped back ~0.55s
    expect(result.ct).toBe(21.59);
    expect(result.state).toEqual({ lastRawSeen: 21.59, lastTime: 21.59, lastTimeUpdate: 5017 });
  });

  it("bypasses smoothing entirely while dragging — always uses the raw value", () => {
    const state = { lastRawSeen: 10, lastTime: 10, lastTimeUpdate: 1000 };
    const result = computeSmoothedPlayhead(10.001, 1001, true, /* isDragging */ true, state, DUR);
    expect(result.ct).toBe(10.001);
  });

  it("bypasses smoothing entirely when not playing — always uses the raw value", () => {
    const state = { lastRawSeen: 10, lastTime: 10, lastTimeUpdate: 1000 };
    const result = computeSmoothedPlayhead(10.5, 1500, /* isPlaying */ false, false, state, DUR);
    expect(result.ct).toBe(10.5);
  });

  it("clamps extrapolated position to track duration", () => {
    const state = { lastRawSeen: 239.9, lastTime: 239.9, lastTimeUpdate: 1000 };
    const result = computeSmoothedPlayhead(239.9, 2000, true, false, state, DUR); // 1s of wall-clock elapsed, would overshoot
    expect(result.ct).toBe(DUR);
  });

  it("clamps the wall-clock extrapolation window to 0.35s even after a long stall (tab backgrounding, GC pause)", () => {
    const state = { lastRawSeen: 10, lastTime: 10, lastTimeUpdate: 1000 };
    const result = computeSmoothedPlayhead(10, 5000, true, false, state, DUR); // 4s stall, unchanged rawTime
    expect(result.ct).toBeCloseTo(10.35, 5);
  });
});
