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

import { bucketForGenre, GENRE_BUCKETS } from "../ArchitectConsole";

// Dynamic Tempo Analysis — genre vocabulary → threshold bucket lookup.
// Small, deliberately not exhaustive (4 values); unknown/future genres
// default to "dynamic" since D's catalog is the platform's core subject —
// the safe default errs toward not crying wolf on groove.
describe("bucketForGenre", () => {
  it("maps DYNAMIC and BREAKBEAT to the dynamic (groove-tolerant) bucket", () => {
    expect(bucketForGenre("DYNAMIC")).toBe("dynamic");
    expect(bucketForGenre("BREAKBEAT")).toBe("dynamic");
  });

  it("maps HOUSE and TECHNO to the static (rigid-tempo) bucket", () => {
    expect(bucketForGenre("HOUSE")).toBe("static");
    expect(bucketForGenre("TECHNO")).toBe("static");
  });

  it("defaults unknown/future genres to dynamic, not a crash or undefined", () => {
    expect(bucketForGenre("JUNGLE")).toBe("dynamic");
    expect(bucketForGenre(undefined)).toBe("dynamic");
    expect(bucketForGenre(null)).toBe("dynamic");
    expect(bucketForGenre("")).toBe("dynamic");
  });

  it("GENRE_BUCKETS is the single source of truth this function reads from", () => {
    expect(GENRE_BUCKETS).toEqual({
      DYNAMIC: "dynamic",
      BREAKBEAT: "dynamic",
      HOUSE: "static",
      TECHNO: "static",
    });
  });
});
