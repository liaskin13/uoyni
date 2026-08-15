// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { formatValidationSummary } from "../useValidationSummary";

// T13 — the three states the validation-numbers row can show: loading,
// unavailable (fetch failed / artifact missing / malformed), and real numbers.
describe("formatValidationSummary", () => {
  it("shows a loading placeholder while the fetch is in flight (undefined)", () => {
    expect(formatValidationSummary(undefined)).toBe("…");
  });

  it("shows PENDING VALIDATION when the fetch failed or the artifact is missing (null)", () => {
    expect(formatValidationSummary(null)).toBe("PENDING VALIDATION");
  });

  it("shows PENDING VALIDATION for a malformed/empty object rather than crashing", () => {
    expect(formatValidationSummary({})).toBe("PENDING VALIDATION");
    expect(formatValidationSummary({ totalGenres: 0 })).toBe("PENDING VALIDATION");
  });

  it("formats real numbers as N/M GENRES · ±Xms", () => {
    expect(
      formatValidationSummary({ genresValidated: 5, totalGenres: 5, toleranceMs: 70 }),
    ).toBe("5/5 GENRES · ±70MS");
  });

  it("still formats a partial-pass summary (not just the all-passing case)", () => {
    expect(
      formatValidationSummary({ genresValidated: 4, totalGenres: 5, toleranceMs: 70 }),
    ).toBe("4/5 GENRES · ±70MS");
  });
});
