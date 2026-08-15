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

import { confidenceBadgeColor } from "../ArchitectConsole";

// T9 — 5 discrete 10%-wide confidence bands, reusing the SA's palette
// verbatim (useAudioAnalyzer.js:55-82). Boundary values are the exact spec
// in DESIGN.md's "Confidence badge" section — do not shift these.
describe("confidenceBadgeColor", () => {
  it("bands below 60% as red", () => {
    expect(confidenceBadgeColor(0)).toBe("#ff0000");
    expect(confidenceBadgeColor(0.59)).toBe("#ff0000");
  });

  it("bands 60-70% as red-orange, boundary inclusive at exactly 60%", () => {
    expect(confidenceBadgeColor(0.6)).toBe("#ff5500");
    expect(confidenceBadgeColor(0.69)).toBe("#ff5500");
  });

  it("bands 70-80% as green, boundary inclusive at exactly 70%", () => {
    expect(confidenceBadgeColor(0.7)).toBe("#00ff00");
    expect(confidenceBadgeColor(0.79)).toBe("#00ff00");
  });

  it("bands 80-90% as cyan, boundary inclusive at exactly 80%", () => {
    expect(confidenceBadgeColor(0.8)).toBe("#00ffff");
    expect(confidenceBadgeColor(0.89)).toBe("#00ffff");
  });

  it("bands 90-100% as indigo, boundary inclusive at exactly 90%", () => {
    expect(confidenceBadgeColor(0.9)).toBe("#6600ff");
    expect(confidenceBadgeColor(1)).toBe("#6600ff");
  });

  it("treats missing/null confidence as 0 (red)", () => {
    expect(confidenceBadgeColor(null)).toBe("#ff0000");
    expect(confidenceBadgeColor(undefined)).toBe("#ff0000");
  });
});
