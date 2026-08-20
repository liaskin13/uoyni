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

import { shouldShowOctaveControl, OCTAVE_CONTROL_CONFIDENCE_THRESHOLD } from "../ArchitectConsole";

// The bucket-gated behavioral fix (base plan's actual thesis): dynamic
// tracks require a materially lower reading before suggesting a
// correction — groove alone shouldn't trigger it. Static keeps today's
// exact 0.6 behavior, validated and built for that material.
describe("shouldShowOctaveControl", () => {
  it("thresholds: dynamic=0.35, static=DETECTED_BPM_CONFIDENCE_THRESHOLD (0.6)", () => {
    expect(OCTAVE_CONTROL_CONFIDENCE_THRESHOLD).toEqual({ dynamic: 0.35, static: 0.6 });
  });

  it("the differentiating proof case: 0.45 confidence hides under dynamic (would have shown under the old flat-0.6 rule)", () => {
    const track = { detected_bpm_confidence: 0.45 };
    expect(shouldShowOctaveControl(track, "dynamic")).toBe(false);
    expect(shouldShowOctaveControl(track, "static")).toBe(true); // matches unchanged static behavior
  });

  it("dynamic bucket shows the control only below 0.35", () => {
    expect(shouldShowOctaveControl({ detected_bpm_confidence: 0.34 }, "dynamic")).toBe(true);
    expect(shouldShowOctaveControl({ detected_bpm_confidence: 0.35 }, "dynamic")).toBe(false);
  });

  it("static bucket matches today's exact 0.6 boundary, unchanged", () => {
    expect(shouldShowOctaveControl({ detected_bpm_confidence: 0.59 }, "static")).toBe(true);
    expect(shouldShowOctaveControl({ detected_bpm_confidence: 0.6 }, "static")).toBe(false);
  });

  it("is false whenever real measured drift exists (ZONES wins), regardless of confidence or bucket", () => {
    const track = {
      detected_bpm_confidence: 0,
      beat_grid_points: JSON.stringify([{ time: 0, bpm: 96 }, { time: 30, bpm: 142 }]),
    };
    expect(shouldShowOctaveControl(track, "dynamic")).toBe(false);
    expect(shouldShowOctaveControl(track, "static")).toBe(false);
  });

  it("is false once manually_corrected is set — a terminal state, not just another confidence reading", () => {
    const track = { detected_bpm_confidence: 0, manually_corrected: true };
    expect(shouldShowOctaveControl(track, "dynamic")).toBe(false);
  });

  it("falls back to the dynamic bar for an unrecognized bucket value", () => {
    expect(shouldShowOctaveControl({ detected_bpm_confidence: 0.4 }, "made-up-bucket")).toBe(false);
    expect(shouldShowOctaveControl({ detected_bpm_confidence: 0.3 }, "made-up-bucket")).toBe(true);
  });
});
