import { describe, it, expect } from "vitest";
import {
  buildGridSegments,
  segmentAt,
  snapToGridBeat,
  clampAnchorTime,
  hitTestAnchor,
} from "../beatGrid";

describe("buildGridSegments — regression parity (single-segment path)", () => {
  it("returns a single synthetic segment at time=0 when no points exist (today's flat-BPM behavior)", () => {
    expect(buildGridSegments([], 128)).toEqual([{ time: 0, bpm: 128, beatsAtStart: 0 }]);
    expect(buildGridSegments(null, 128)).toEqual([{ time: 0, bpm: 128, beatsAtStart: 0 }]);
  });

  it("returns an empty array when there are no points and no flat BPM either", () => {
    expect(buildGridSegments([], null)).toEqual([]);
    expect(buildGridSegments([], 0)).toEqual([]);
  });
});

describe("buildGridSegments — multi-point accumulated beat count", () => {
  it("computes beatsAtStart continuously across a tempo change", () => {
    // 120 BPM (0.5s/beat) from 0 to 10s = 20 beats, then 140 BPM from 10s on.
    const segments = buildGridSegments([{ time: 0, bpm: 120 }, { time: 10, bpm: 140 }], null);
    expect(segments[0]).toEqual({ time: 0, bpm: 120, beatsAtStart: 0 });
    expect(segments[1].beatsAtStart).toBeCloseTo(20, 5);
  });

  it("handles three segments (two tempo changes) with continuous accumulation", () => {
    const segments = buildGridSegments(
      [{ time: 0, bpm: 100 }, { time: 6, bpm: 120 }, { time: 16, bpm: 90 }],
      null,
    );
    // 100 BPM (0.6s/beat) for 6s = 10 beats
    expect(segments[1].beatsAtStart).toBeCloseTo(10, 5);
    // + 120 BPM (0.5s/beat) for 10s = 20 beats -> 30 total
    expect(segments[2].beatsAtStart).toBeCloseTo(30, 5);
  });

  it("sorts unsorted input points by time", () => {
    const segments = buildGridSegments([{ time: 10, bpm: 140 }, { time: 0, bpm: 120 }], null);
    expect(segments.map((s) => s.time)).toEqual([0, 10]);
  });

  it("filters out malformed points rather than crashing", () => {
    const segments = buildGridSegments(
      [{ time: 0, bpm: 120 }, { time: "bad", bpm: 999 }, { bpm: 888 }],
      null,
    );
    expect(segments).toEqual([{ time: 0, bpm: 120, beatsAtStart: 0 }]);
  });
});

describe("segmentAt", () => {
  const segments = buildGridSegments([{ time: 10, bpm: 120 }, { time: 40, bpm: 140 }], null);

  it("returns null for an empty segment list", () => {
    expect(segmentAt([], 5)).toBeNull();
  });

  it("extends the first segment backward for time before it", () => {
    expect(segmentAt(segments, 0).bpm).toBe(120);
  });

  it("finds the correct segment mid-range", () => {
    expect(segmentAt(segments, 25).bpm).toBe(120);
    expect(segmentAt(segments, 50).bpm).toBe(140);
  });

  it("uses the segment's own bpm exactly at its boundary time", () => {
    expect(segmentAt(segments, 40).bpm).toBe(140);
  });
});

describe("clampAnchorTime — prevents crossing/reordering the array", () => {
  const points = [{ time: 10, bpm: 120 }, { time: 20, bpm: 130 }, { time: 30, bpm: 140 }];
  const duration = 60;

  it("clamps a middle anchor to stay strictly between its neighbors", () => {
    expect(clampAnchorTime(points, 1, 25, duration)).toBe(25); // within range, unchanged
    expect(clampAnchorTime(points, 1, 5, duration)).toBeGreaterThan(10); // clamped above prev
    expect(clampAnchorTime(points, 1, 50, duration)).toBeLessThan(30); // clamped below next
  });

  it("never lets a middle anchor touch or cross its neighbor's exact time", () => {
    const clampedLow = clampAnchorTime(points, 1, 10, duration);
    expect(clampedLow).toBeGreaterThan(10);
    const clampedHigh = clampAnchorTime(points, 1, 30, duration);
    expect(clampedHigh).toBeLessThan(30);
  });

  it("clamps the first anchor to [0, next anchor)", () => {
    expect(clampAnchorTime(points, 0, -5, duration)).toBe(0);
    expect(clampAnchorTime(points, 0, 15, duration)).toBe(15);
    expect(clampAnchorTime(points, 0, 25, duration)).toBeLessThan(20);
  });

  it("clamps the last anchor to (prev anchor, trackDuration]", () => {
    expect(clampAnchorTime(points, 2, 100, duration)).toBe(duration);
    expect(clampAnchorTime(points, 2, 25, duration)).toBeGreaterThan(20);
  });

  it("clamps correctly with a single anchor (both bounds are track edges)", () => {
    const single = [{ time: 10, bpm: 120 }];
    expect(clampAnchorTime(single, 0, -10, duration)).toBe(0);
    expect(clampAnchorTime(single, 0, 200, duration)).toBe(duration);
  });
});

describe("hitTestAnchor", () => {
  const points = [{ time: 10, bpm: 120 }, { time: 20, bpm: 130 }];

  it("returns -1 for an empty points array", () => {
    expect(hitTestAnchor([], 10, 1)).toBe(-1);
  });

  it("returns -1 when nothing is within tolerance", () => {
    expect(hitTestAnchor(points, 15, 1)).toBe(-1);
  });

  it("returns the index of the anchor within tolerance", () => {
    expect(hitTestAnchor(points, 10.3, 0.5)).toBe(0);
    expect(hitTestAnchor(points, 19.8, 0.5)).toBe(1);
  });

  it("returns the closer anchor when two are within tolerance", () => {
    const close = [{ time: 10, bpm: 120 }, { time: 10.4, bpm: 125 }];
    expect(hitTestAnchor(close, 10.1, 1)).toBe(0);
  });
});

describe("snapToGridBeat", () => {
  it("snaps to the nearest beat boundary within the covering segment", () => {
    const segments = buildGridSegments([{ time: 0, bpm: 120 }], null); // 0.5s/beat
    expect(snapToGridBeat(segments, 10.3)).toBeCloseTo(10.5, 5);
    expect(snapToGridBeat(segments, 10.1)).toBeCloseTo(10.0, 5);
  });

  it("snaps relative to the segment's own anchor time, not absolute 0", () => {
    const segments = buildGridSegments([{ time: 3, bpm: 120 }], null);
    // Beats fall at 3, 3.5, 4, 4.5... — snapping 4.6 should land on 4.5
    expect(snapToGridBeat(segments, 4.6)).toBeCloseTo(4.5, 5);
  });

  it("returns timeSec unchanged when there are no segments", () => {
    expect(snapToGridBeat([], 12.34)).toBe(12.34);
  });
});
