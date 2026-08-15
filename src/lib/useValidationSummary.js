import { useEffect, useState } from "react";

// T13 — reads public/validationSummary.json, written at build time by
// scripts/generate-validation-summary.js from the exact beat-detection code
// being deployed (see that script's header for why this isn't a CI-artifact
// handoff). Shared between ArchitectConsole.jsx's (D) and AdminSettings.jsx's
// (L) settings panels — same fetch/parse logic, two different rows.
//
// Returns: undefined while loading, null if the fetch/parse failed or the
// artifact is missing (a track's-worth of "pending validation" state, not a
// crash), or the parsed summary object once loaded.
export function useValidationSummary() {
  const [summary, setSummary] = useState(undefined);

  useEffect(() => {
    let cancelled = false;
    fetch("/validationSummary.json")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return summary;
}

// Pure formatting, split out from the hook so it's unit-testable without
// mocking fetch. `summary` is whatever useValidationSummary() currently
// returns (undefined/null/parsed object) — same three states, one string.
export function formatValidationSummary(summary) {
  if (summary === undefined) return "…";
  if (summary === null || !summary.totalGenres) return "PENDING VALIDATION";
  return `${summary.genresValidated}/${summary.totalGenres} GENRES · ±${summary.toleranceMs}MS`;
}
