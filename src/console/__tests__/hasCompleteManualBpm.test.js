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

import { hasCompleteManualBpm } from "../ArchitectConsole";

// Replaces the flawed `!cleanBpm(bpm_display) && !t.bpm` condition at all 3
// gate sites — that check only trims text, it doesn't distinguish "one
// fixed BPM is manually pinned" from "a manual range like '60-80' is
// annotated" (D's real library rows). A range must NOT suppress CONF/ZONES/
// octave-control — this is the precise fix for that suppression bug.
describe("hasCompleteManualBpm", () => {
  it("is true for a single resolved bpm_display", () => {
    expect(hasCompleteManualBpm({ bpm_display: "128" })).toBe(true);
    expect(hasCompleteManualBpm({ bpm_display: "128.0" })).toBe(true);
  });

  it("is true for a literal numeric t.bpm with no bpm_display", () => {
    expect(hasCompleteManualBpm({ bpm: 128 })).toBe(true);
  });

  it("is false for a manual range — the suppression-bug fix", () => {
    expect(hasCompleteManualBpm({ bpm_display: "60-80" })).toBe(false);
  });

  it("is false when neither bpm_display nor bpm is set", () => {
    expect(hasCompleteManualBpm({})).toBe(false);
    expect(hasCompleteManualBpm({ bpm_display: "", bpm: null })).toBe(false);
  });

  it("is false for a null/undefined track", () => {
    expect(hasCompleteManualBpm(null)).toBe(false);
    expect(hasCompleteManualBpm(undefined)).toBe(false);
  });
});
