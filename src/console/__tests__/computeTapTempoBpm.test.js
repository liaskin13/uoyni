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

import { computeTapTempoBpm, TAP_MIN_TAPS } from "../ArchitectConsole";

// T10 — tap-tempo BPM computation. Timestamps are ms on any monotonic
// clock; only the intervals between consecutive taps matter.
describe("computeTapTempoBpm", () => {
  it("returns null below the minimum tap count", () => {
    expect(computeTapTempoBpm([])).toBeNull();
    expect(computeTapTempoBpm([0])).toBeNull();
    expect(computeTapTempoBpm([0, 500, 1000])).toBeNull(); // 3 taps, 2 intervals
    expect(TAP_MIN_TAPS).toBe(4);
  });

  it("computes 120 BPM from 4 perfectly even 500ms taps", () => {
    expect(computeTapTempoBpm([0, 500, 1000, 1500])).toBe(120);
  });

  it("computes 128 BPM (approx) from realistic slightly-uneven taps", () => {
    // 60000/128 ≈ 468.75ms per beat
    const bpm = computeTapTempoBpm([0, 469, 938, 1407, 1875]);
    expect(bpm).toBeGreaterThan(127);
    expect(bpm).toBeLessThan(129);
  });

  it("discards an outlier interval (fumbled extra tap) before averaging", () => {
    // Real gesture at steady 500ms (120 BPM), but one interval is 120ms —
    // a double-tap slip. 120ms is far outside 50-150% of the 500ms median
    // and must be excluded, not dragged into the average.
    const bpm = computeTapTempoBpm([0, 500, 1000, 1120, 1620, 2120]);
    expect(bpm).toBe(120);
  });

  it("discards an outlier interval (missed beat, doubled gap) before averaging", () => {
    // Steady 500ms taps but one gap is 1000ms (a skipped beat).
    const bpm = computeTapTempoBpm([0, 500, 1000, 2000, 2500, 3000]);
    expect(bpm).toBe(120);
  });

  it("returns a finite BPM even for highly irregular tap timing", () => {
    const bpm = computeTapTempoBpm([0, 100, 5000, 5200, 12000]);
    expect(Number.isFinite(bpm)).toBe(true);
  });

  // Regression: zero-interval taps (every tap landing on the same
  // millisecond — a real risk from rapid/duplicate synthetic click events,
  // not just a contrived input) produced a zero-ms median, so
  // 60000/avgMs === Infinity. That flowed straight into applyTapTempo(),
  // which does String(bpm) before PATCHing bpm_display to the server —
  // meaning a degenerate gesture could write the literal string "Infinity"
  // to a real track's BPM. Found by /ship's coverage audit, 2026-08-15.
  it("returns null (not Infinity) for zero-interval taps, never crossing into applyTapTempo", () => {
    expect(computeTapTempoBpm([0, 0, 0, 0])).toBeNull();
    expect(computeTapTempoBpm([100, 100, 100, 100])).toBeNull();
  });

  it("returns null rather than Infinity/NaN for any degenerate all-outlier-rejected case", () => {
    // Even if a future change to the outlier-rejection window ever let every
    // interval get filtered out, avgMs must never reach 0 undetected —
    // assert the invariant directly rather than one specific input shape.
    const cases = [
      [0, 0, 0, 0],
      [0, 0, 1, 1],
      [5, 5, 5, 5, 5],
    ];
    for (const taps of cases) {
      const bpm = computeTapTempoBpm(taps);
      expect(bpm === null || Number.isFinite(bpm)).toBe(true);
    }
  });
});
