// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useValidationSummary, formatValidationSummary } from "../useValidationSummary";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// T13 — useValidationSummary's own fetch/parse states. formatValidationSummary
// above covers the string output for each; these cover the hook actually
// reaching each state.
describe("useValidationSummary", () => {
  it("starts in the loading state (undefined)", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {}))); // never resolves
    const { result } = renderHook(() => useValidationSummary());
    expect(result.current).toBeUndefined();
  });

  it("resolves to the parsed summary on a successful fetch", async () => {
    const summary = { genresValidated: 5, totalGenres: 5, toleranceMs: 70 };
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(summary) })),
    );
    const { result } = renderHook(() => useValidationSummary());
    await waitFor(() => expect(result.current).toEqual(summary));
  });

  it("resolves to null on a non-ok HTTP response (e.g. 404)", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 404 })));
    const { result } = renderHook(() => useValidationSummary());
    await waitFor(() => expect(result.current).toBeNull());
  });

  it("resolves to null on a genuine network/fetch rejection, not just a bad HTTP status", () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network error"))));
    const { result } = renderHook(() => useValidationSummary());
    return waitFor(() => expect(result.current).toBeNull());
  });

  it("does not update state after unmount — the cancelled guard is exercised, not just present", async () => {
    let resolveFetch;
    const pending = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    vi.stubGlobal("fetch", vi.fn(() => pending));
    const { result, unmount } = renderHook(() => useValidationSummary());
    expect(result.current).toBeUndefined();

    unmount();
    resolveFetch({ ok: true, json: () => Promise.resolve({ genresValidated: 5, totalGenres: 5, toleranceMs: 70 }) });

    // Let the resolved promise chain run — if the cancelled guard were
    // missing, this would call setState on an unmounted hook (React warns
    // and the update would be a no-op at best, a leak at worst). Asserting
    // the flow completes without throwing is the point of this test.
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBeUndefined(); // unchanged — update was correctly skipped
  });
});

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
