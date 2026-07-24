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

import { quantizeToBeat, resolveTrackBpm } from "../ArchitectConsole";

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
