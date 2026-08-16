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
  isBpmCompatible,
  isKeyCompatible,
  smartCrateScore,
  SMART_CRATE_BPM_TOLERANCE,
} from "../ArchitectConsole";

// Smart Crates — console-wide button/discoverability audit, 2026-08-16.
// Scoped to BPM (every track has real detected/manual BPM data) with key
// as a bonus signal only (musical_key is sparse/unpopulated for most
// tracks — no key-detection pipeline exists in this codebase).
describe("isBpmCompatible", () => {
  it("matches identical BPMs", () => {
    expect(isBpmCompatible(120, 120)).toBe(true);
  });

  it("matches within the standard ±6% pitch-fader tolerance", () => {
    expect(SMART_CRATE_BPM_TOLERANCE).toBe(0.06);
    expect(isBpmCompatible(120, 127)).toBe(true); // +5.8%
    expect(isBpmCompatible(120, 113.5)).toBe(true); // -5.4%
  });

  it("rejects BPMs outside the tolerance", () => {
    expect(isBpmCompatible(120, 130)).toBe(false); // +8.3%
    expect(isBpmCompatible(120, 100)).toBe(false); // -16.7%
  });

  it("is symmetric — order of arguments doesn't matter", () => {
    expect(isBpmCompatible(120, 125)).toBe(isBpmCompatible(125, 120));
  });

  it("returns false for missing/zero BPM on either side, never throws", () => {
    expect(isBpmCompatible(null, 120)).toBe(false);
    expect(isBpmCompatible(120, null)).toBe(false);
    expect(isBpmCompatible(0, 120)).toBe(false);
    expect(isBpmCompatible(undefined, undefined)).toBe(false);
  });
});

describe("isKeyCompatible", () => {
  it("matches identical keys case-insensitively", () => {
    expect(isKeyCompatible("8A", "8a")).toBe(true);
    expect(isKeyCompatible(" Cm ", "cm")).toBe(true);
  });

  it("rejects different keys", () => {
    expect(isKeyCompatible("8A", "9A")).toBe(false);
  });

  it("returns null (unknown, not incompatible) when either key is missing", () => {
    expect(isKeyCompatible(null, "8A")).toBeNull();
    expect(isKeyCompatible("8A", null)).toBeNull();
    expect(isKeyCompatible("", "")).toBeNull();
  });
});

describe("smartCrateScore", () => {
  const ref = { id: 1, bpm_display: "120", musical_key: "8A" };

  it("scores 0 for BPM-incompatible tracks", () => {
    expect(smartCrateScore({ id: 2, bpm_display: "90" }, ref)).toBe(0);
  });

  it("scores 1 for BPM match with unknown/no key", () => {
    expect(smartCrateScore({ id: 2, bpm_display: "122" }, ref)).toBe(1);
  });

  it("scores 2 for BPM + key match — ranks above BPM-only", () => {
    const bpmAndKey = smartCrateScore(
      { id: 2, bpm_display: "122", musical_key: "8A" },
      ref,
    );
    const bpmOnly = smartCrateScore({ id: 2, bpm_display: "122" }, ref);
    expect(bpmAndKey).toBe(2);
    expect(bpmAndKey).toBeGreaterThan(bpmOnly);
  });

  it("scores 0 for a track compared against itself (same id)", () => {
    expect(smartCrateScore(ref, ref)).toBe(0);
  });

  it("scores 0 rather than throwing for missing track/reference", () => {
    expect(smartCrateScore(null, ref)).toBe(0);
    expect(smartCrateScore(ref, null)).toBe(0);
    expect(smartCrateScore(null, null)).toBe(0);
  });

  it("falls back through detected_bpm the same way resolveTrackBpm does", () => {
    const detected = {
      id: 2,
      detected_bpm: 121,
      detected_bpm_confidence: 0.9,
    };
    expect(smartCrateScore(detected, ref)).toBe(1);
  });
});
