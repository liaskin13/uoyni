// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

vi.mock("../../config", () => ({
  UPLOAD_WORKER_URL: "https://psc-worker.example.com",
  UPLOAD_SECRET: "test-secret",
  VAULT_DISPLAY_NAMES: { saturn: "ORIGINAL MUSIC", venus: "MIXES", mercury: "LIVE SETS", earth: "SONIC ARCH" },
  VAULT_ACCENT_COLORS: { saturn: "#fff", venus: "#fff", mercury: "#fff", earth: "#fff" },
  LOCKBOX_PREFIX: "lockbox_",
  R2_PUBLIC_URL: "https://r2.example.com",
}));

import {
  quantizeToBeat,
  resolveTrackBpm,
  resolveBpmAtTime,
  resolveDownbeatOffsetForQuantize,
  DETECTED_BPM_CONFIDENCE_THRESHOLD,
  QUANTIZE_DOWNBEAT_CONFIDENCE_THRESHOLD,
} from "../ArchitectConsole";

describe("resolveBpmAtTime — regression parity with resolveTrackBpm (highest-risk path)", () => {
  it("MANDATORY: with no grid points, produces output identical to resolveTrackBpm for every track shape", () => {
    const trackShapes = [
      { bpm_display: "128" },
      { bpm: 90 },
      { bpm_display: "70-119" },
      { detected_bpm: 122, detected_bpm_confidence: 0.8 },
      { detected_bpm: 122, detected_bpm_confidence: 0.3 },
      {},
      null,
    ];
    for (const track of trackShapes) {
      expect(resolveBpmAtTime(track, 42.5)).toBe(resolveTrackBpm(track));
      expect(resolveBpmAtTime({ ...track, beat_grid_points: null }, 10)).toBe(
        resolveTrackBpm(track),
      );
      expect(resolveBpmAtTime({ ...track, beat_grid_points: "[]" }, 10)).toBe(
        resolveTrackBpm(track),
      );
    }
  });

  it("falls back to resolveTrackBpm on malformed beat_grid_points JSON rather than throwing", () => {
    const track = { bpm_display: "128", beat_grid_points: "{not valid json" };
    expect(() => resolveBpmAtTime(track, 5)).not.toThrow();
    expect(resolveBpmAtTime(track, 5)).toBe(128);
  });
});

describe("resolveBpmAtTime — multi-point grid", () => {
  const track = {
    beat_grid_points: JSON.stringify([
      { time: 10, bpm: 120 },
      { time: 40, bpm: 140 },
    ]),
  };

  it("extends the first anchor's BPM backward for time before it — no 'no tempo' region", () => {
    expect(resolveBpmAtTime(track, 0)).toBe(120);
    expect(resolveBpmAtTime(track, 9.999)).toBe(120);
  });

  it("uses the first anchor's BPM exactly at its own time", () => {
    expect(resolveBpmAtTime(track, 10)).toBe(120);
  });

  it("uses the first segment's BPM for time within its range", () => {
    expect(resolveBpmAtTime(track, 25)).toBe(120);
  });

  it("switches to the second anchor's BPM exactly at its time", () => {
    expect(resolveBpmAtTime(track, 40)).toBe(140);
  });

  it("uses the last anchor's BPM for time past all anchors", () => {
    expect(resolveBpmAtTime(track, 1000)).toBe(140);
  });

  it("accepts an already-parsed array (not just a JSON string)", () => {
    const parsedTrack = {
      beat_grid_points: [{ time: 0, bpm: 100 }, { time: 20, bpm: 150 }],
    };
    expect(resolveBpmAtTime(parsedTrack, 25)).toBe(150);
  });

  it("ignores malformed anchor entries (missing/non-finite time or bpm) rather than crashing", () => {
    const messyTrack = {
      beat_grid_points: [
        { time: 0, bpm: 100 },
        { time: "not a number", bpm: 999 },
        { bpm: 888 },
        { time: 5 },
        { time: 20, bpm: 150 },
      ],
    };
    expect(resolveBpmAtTime(messyTrack, 25)).toBe(150);
    expect(resolveBpmAtTime(messyTrack, 2)).toBe(100);
  });

  it("sorts out-of-order anchor entries by time before resolving", () => {
    const unsorted = {
      beat_grid_points: [{ time: 40, bpm: 140 }, { time: 10, bpm: 120 }],
    };
    expect(resolveBpmAtTime(unsorted, 25)).toBe(120);
  });
});

describe("resolveTrackBpm", () => {
  it("prefers bpm_display over bpm", () => {
    expect(resolveTrackBpm({ bpm_display: "128", bpm: 90 })).toBe(128);
  });

  it("falls back to bpm when bpm_display is absent", () => {
    expect(resolveTrackBpm({ bpm: 140 })).toBe(140);
  });

  it("parses the first value out of a range string", () => {
    expect(resolveTrackBpm({ bpm_display: "70-119" })).toBe(70);
  });

  it("falls back to detected_bpm when confidence clears the threshold and no manual entry exists", () => {
    expect(
      resolveTrackBpm({ detected_bpm: 122, detected_bpm_confidence: 0.8 }),
    ).toBe(122);
  });

  it("does NOT surface detected_bpm below the confidence threshold — shows nothing, not a wrong number", () => {
    expect(
      resolveTrackBpm({ detected_bpm: 122, detected_bpm_confidence: 0.3 }),
    ).toBeNull();
  });

  it("treats confidence exactly at the threshold as acceptable (>=, not >)", () => {
    expect(
      resolveTrackBpm({
        detected_bpm: 122,
        detected_bpm_confidence: DETECTED_BPM_CONFIDENCE_THRESHOLD,
      }),
    ).toBe(122);
  });

  it("manual entry always wins over a high-confidence detection", () => {
    expect(
      resolveTrackBpm({
        bpm_display: "128",
        detected_bpm: 65,
        detected_bpm_confidence: 0.95,
      }),
    ).toBe(128);
  });

  it("returns null when no valid BPM is present", () => {
    expect(resolveTrackBpm({})).toBeNull();
    expect(resolveTrackBpm({ bpm_display: "0" })).toBeNull();
    expect(resolveTrackBpm(null)).toBeNull();
  });
});

describe("quantizeToBeat", () => {
  it("snaps to the nearest beat boundary at 120 BPM (0.5s per beat)", () => {
    // 10.3s -> nearest 0.5s multiple is 10.5s
    expect(quantizeToBeat(10.3, () => 120)).toBeCloseTo(10.5, 5);
  });

  it("snaps down when closer to the previous beat", () => {
    // 10.1s -> nearest 0.5s multiple is 10.0s
    expect(quantizeToBeat(10.1, () => 120)).toBeCloseTo(10.0, 5);
  });

  it("is idempotent on a value already exactly on a beat boundary", () => {
    const bpmAt = () => 128;
    const beatSeconds = 60 / 128;
    const onBeat = beatSeconds * 4;
    expect(quantizeToBeat(onBeat, bpmAt)).toBeCloseTo(onBeat, 10);
  });

  it("is a no-op (returns timeSec unchanged) when bpmAt returns null", () => {
    expect(quantizeToBeat(42.7, () => null)).toBe(42.7);
  });

  it("is a no-op when bpmAt returns 0", () => {
    expect(quantizeToBeat(42.7, () => 0)).toBe(42.7);
  });

  it("respects a non-zero offsetSec (position-aware grid segment start)", () => {
    // 100 BPM -> 0.6s/beat. Segment starts at offset 5.2s.
    // 5.9s is 0.7s after the offset -> nearest beat is 1 beat (0.6s) -> 5.8s
    expect(quantizeToBeat(5.9, () => 100, 5.2)).toBeCloseTo(5.8, 5);
  });

  it("accepts a resolver function so position-aware lookups (Part 3) need no signature change", () => {
    const segments = [{ start: 0, bpm: 120 }, { start: 10, bpm: 140 }];
    const bpmAt = (t) => (segments.findLast((s) => s.start <= t) || segments[0]).bpm;
    expect(quantizeToBeat(3.0, bpmAt)).toBeCloseTo(3.0, 5); // 120 BPM boundary
    // Past the segment boundary the resolver switches to 140 BPM (0.4286s/beat);
    // with no offsetSec the snap is still relative to absolute 0, not the segment start.
    const beatSeconds140 = 60 / 140;
    expect(quantizeToBeat(10.1, bpmAt)).toBeCloseTo(Math.round(10.1 / beatSeconds140) * beatSeconds140, 5);
  });
});

describe("resolveDownbeatOffsetForQuantize", () => {
  it("REGRESSION-CRITICAL: a track with no downbeat data at all returns 0, identical to today's behavior", () => {
    // Every track before this ships has neither field — this must be a pure no-op.
    expect(resolveDownbeatOffsetForQuantize({}, 42.5)).toBe(0);
    expect(resolveDownbeatOffsetForQuantize(null, 42.5)).toBe(0);
    expect(
      resolveDownbeatOffsetForQuantize({ bpm_display: "128" }, 42.5),
    ).toBe(0);
  });

  it("no grid points, confidence above threshold: returns the track-level offset", () => {
    const track = {
      detected_downbeat_offset: 1.25,
      detected_downbeat_confidence: QUANTIZE_DOWNBEAT_CONFIDENCE_THRESHOLD,
    };
    expect(resolveDownbeatOffsetForQuantize(track, 50)).toBe(1.25);
  });

  it("no grid points, confidence below threshold: returns 0, not a low-confidence guess", () => {
    const track = {
      detected_downbeat_offset: 1.25,
      detected_downbeat_confidence: QUANTIZE_DOWNBEAT_CONFIDENCE_THRESHOLD - 0.01,
    };
    expect(resolveDownbeatOffsetForQuantize(track, 50)).toBe(0);
  });

  it("grid points present, matching segment confidence above threshold: returns that anchor's downbeatOffset", () => {
    const track = {
      beat_grid_points: [
        { time: 0, bpm: 120, downbeatOffset: 0.3, downbeatConfidence: 0.9 },
        { time: 40, bpm: 140, downbeatOffset: 40.1, downbeatConfidence: QUANTIZE_DOWNBEAT_CONFIDENCE_THRESHOLD },
      ],
    };
    expect(resolveDownbeatOffsetForQuantize(track, 50)).toBe(40.1);
    expect(resolveDownbeatOffsetForQuantize(track, 10)).toBe(0.3);
  });

  it("grid points present, matching segment confidence below threshold: returns 0", () => {
    const track = {
      beat_grid_points: [
        { time: 0, bpm: 120, downbeatOffset: 0.3, downbeatConfidence: 0.1 },
      ],
    };
    expect(resolveDownbeatOffsetForQuantize(track, 10)).toBe(0);
  });

  it("grid points present but the matching anchor has no downbeat data at all: returns 0", () => {
    // e.g. a manually-inserted anchor (DeckWaveformV2's double-click-insert
    // path constructs a fresh {time, bpm} with no downbeat fields) mixed in
    // among detected anchors.
    const track = {
      beat_grid_points: [{ time: 0, bpm: 120 }],
    };
    expect(resolveDownbeatOffsetForQuantize(track, 10)).toBe(0);
  });

  it("falls back to the first anchor's downbeat data for time before it, matching resolveBpmAtTime's own convention", () => {
    const track = {
      beat_grid_points: [
        { time: 10, bpm: 120, downbeatOffset: 10.2, downbeatConfidence: 0.9 },
      ],
    };
    expect(resolveDownbeatOffsetForQuantize(track, 0)).toBe(10.2);
  });

  it("data-integrity edge case: no grid points, confidence clears the bar, but detected_downbeat_offset itself is missing — falls back to 0, not undefined", () => {
    const track = {
      detected_downbeat_confidence: QUANTIZE_DOWNBEAT_CONFIDENCE_THRESHOLD,
      // detected_downbeat_offset intentionally absent
    };
    expect(resolveDownbeatOffsetForQuantize(track, 50)).toBe(0);
  });

  it("data-integrity edge case: matching anchor's confidence clears the bar but downbeatOffset itself is missing — falls back to 0, not undefined", () => {
    const track = {
      beat_grid_points: [
        { time: 0, bpm: 120, downbeatConfidence: 0.9 }, // downbeatOffset intentionally absent
      ],
    };
    expect(resolveDownbeatOffsetForQuantize(track, 10)).toBe(0);
  });
});
