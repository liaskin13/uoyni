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

import { resolveTrackGenre } from "../ArchitectConsole";

// 3-branch fallback chain (D6): per-track override → console-level default
// → hardcoded "DYNAMIC" — same "manual value, then fallback" convention
// resolveTrackBpm already uses (track?.bpm_display || track?.bpm).
describe("resolveTrackGenre", () => {
  it("uses the track's own tempo_genre when set, regardless of console default", () => {
    expect(resolveTrackGenre({ tempo_genre: "HOUSE" }, "TECHNO")).toBe("HOUSE");
  });

  it("falls back to the console-level default when the track has no saved genre", () => {
    expect(resolveTrackGenre({ tempo_genre: null }, "BREAKBEAT")).toBe("BREAKBEAT");
    expect(resolveTrackGenre({}, "HOUSE")).toBe("HOUSE");
  });

  it("falls back to the hardcoded DYNAMIC when neither track nor console default is set", () => {
    expect(resolveTrackGenre({}, null)).toBe("DYNAMIC");
    expect(resolveTrackGenre({}, undefined)).toBe("DYNAMIC");
    expect(resolveTrackGenre(null, null)).toBe("DYNAMIC");
  });

  it("treats an empty-string tempo_genre as unset, not a real value", () => {
    expect(resolveTrackGenre({ tempo_genre: "" }, "HOUSE")).toBe("HOUSE");
  });
});
