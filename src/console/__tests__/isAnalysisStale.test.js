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

import { isAnalysisStale, DYNAMIC_TEMPO_ANALYSIS_SHIPPED_AT } from "../ArchitectConsole";

describe("isAnalysisStale", () => {
  it("is false for a track with no waveform_generated_at yet", () => {
    expect(isAnalysisStale({})).toBe(false);
    expect(isAnalysisStale({ waveform_generated_at: null })).toBe(false);
  });

  it("is true for a track analyzed before Dynamic Tempo Analysis shipped", () => {
    expect(
      isAnalysisStale({ waveform_generated_at: "2026-08-19T23:59:59.999Z" }),
    ).toBe(true);
    expect(
      isAnalysisStale({ waveform_generated_at: "2026-05-22T00:00:00.000Z" }),
    ).toBe(true);
  });

  it("is false for a track analyzed on/after the ship date", () => {
    expect(isAnalysisStale({ waveform_generated_at: DYNAMIC_TEMPO_ANALYSIS_SHIPPED_AT })).toBe(
      false,
    );
    expect(
      isAnalysisStale({ waveform_generated_at: "2026-08-21T12:00:00.000Z" }),
    ).toBe(false);
  });
});
