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

import { computeEnvelopeWindow } from "../ArchitectConsole";

// T11 — beat-relative window (2 beats before + 2 beats after hoverTime) and
// the cursor's 0-1 position within it. barsPerSec matches analyzeAudio's
// default (50).
describe("computeEnvelopeWindow", () => {
  it("returns null for missing hoverTime/bpm/envelope", () => {
    expect(computeEnvelopeWindow({ hoverTime: null, bpm: 120, envelopeLength: 1000 })).toBeNull();
    expect(computeEnvelopeWindow({ hoverTime: 10, bpm: null, envelopeLength: 1000 })).toBeNull();
    expect(computeEnvelopeWindow({ hoverTime: 10, bpm: 120, envelopeLength: 0 })).toBeNull();
  });

  it("windows 4 beats total (2 before + 2 after) at 120 BPM mid-track", () => {
    // 120 BPM -> 0.5s/beat -> 2s total window -> 100 bars at 50 bars/sec
    const win = computeEnvelopeWindow({ hoverTime: 10, bpm: 120, envelopeLength: 5000, barsPerSec: 50 });
    expect(win).not.toBeNull();
    expect(win.endBar - win.startBar).toBe(100);
    // hoverTime sits exactly at the window's center -> cursor at 0.5
    expect(win.cursorFrac).toBeCloseTo(0.5, 5);
  });

  it("clamps the window start at the track's beginning (hover near time 0)", () => {
    const win = computeEnvelopeWindow({ hoverTime: 0.1, bpm: 120, envelopeLength: 5000, barsPerSec: 50 });
    expect(win.startBar).toBe(0);
    // cursor is no longer centered — it's shifted toward the window's start
    // because 2 beats before hoverTime got clamped away
    expect(win.cursorFrac).toBeLessThan(0.5);
  });

  it("clamps the window end at the envelope's length (hover near track end)", () => {
    const win = computeEnvelopeWindow({ hoverTime: 99.99, bpm: 120, envelopeLength: 5000, barsPerSec: 50 });
    expect(win.endBar).toBe(5000);
    expect(win.cursorFrac).toBeGreaterThan(0.5);
  });

  it("produces a wider window (in bars) at a slower BPM", () => {
    const slow = computeEnvelopeWindow({ hoverTime: 30, bpm: 80, envelopeLength: 10000, barsPerSec: 50 });
    const fast = computeEnvelopeWindow({ hoverTime: 30, bpm: 160, envelopeLength: 10000, barsPerSec: 50 });
    expect(slow.endBar - slow.startBar).toBeGreaterThan(fast.endBar - fast.startBar);
  });

  it("returns null if the computed window collapses to zero bars", () => {
    // An absurdly high bpm with a tiny envelope can collapse start>=end at
    // the boundary — must not divide by zero or return a degenerate window.
    const win = computeEnvelopeWindow({ hoverTime: 0, bpm: 100000, envelopeLength: 1, barsPerSec: 50 });
    expect(win === null || win.endBar > win.startBar).toBe(true);
  });
});
