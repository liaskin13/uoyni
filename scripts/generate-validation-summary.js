// T13 — writes public/validationSummary.json from the exact beat-detection
// code being built, run as a step in `npm run build` (not a CI-artifact
// handoff — this repo's Pages deploy is direct-upload, disconnected from
// git, so a CI-generated artifact would have nowhere to land). The number
// that ships is always generated from what's actually deploying, not a
// separate CI run that may never reach production.
//
// Reuses the exact scoring logic already proven in
// src/lib/__tests__/multiGenreValidation.test.js (same tolerance constants,
// same construction) rather than inventing a second validation path — see
// that file for the full reasoning behind these numbers/tolerances.
//
// Exits non-zero if any genre fails validation, so a broken suite fails the
// build rather than silently shipping stale/wrong numbers.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { onsetEnvelope, dpBeatTrack, detectTempoSegments } from "../src/lib/beatDetector.js";
import { syntheticGenreBars, GENRE_ARCHETYPES, FRAME_RATE } from "../src/lib/__tests__/genreFixtures.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DRIFT_THRESHOLD_PCT = 4; // matches beatDetector.js's own constant
const ONSET_SNAP_MAX_SEC = 0.07; // mir_eval's standard F-measure onset tolerance (70ms)
const ONSET_SNAP_PHASE_PCT = 0.175; // mir_eval's continuity_phase_threshold
const OCTAVE_TOLERANT = new Set(["breakbeat"]);
const AFTER_MULTIPLIER = { breakbeat: 0.8 };
const SEG_DUR_SEC = 40;

function isPlausibleOctave(detectedBpm, trueBpm) {
  const ratio = detectedBpm / trueBpm;
  return [0.5, 1, 2].some((m) => Math.abs(ratio - m) < 0.1);
}

function validateGenre(name, spec) {
  // 1. BPM accuracy on constant-tempo material.
  const { bars, actualBpm } = syntheticGenreBars(spec);
  const env = onsetEnvelope(bars);
  const bpmResult = dpBeatTrack(env, { frameRate: FRAME_RATE });
  const bpmPctErr =
    bpmResult.bpm == null ? null : (Math.abs(bpmResult.bpm - actualBpm) / actualBpm) * 100;
  const bpmOk =
    bpmResult.bpm != null &&
    (OCTAVE_TOLERANT.has(name)
      ? isPlausibleOctave(bpmResult.bpm, actualBpm)
      : bpmPctErr <= DRIFT_THRESHOLD_PCT);

  // 2. Beat-timing accuracy at a genuine tempo change (what the ±70ms
  // tolerance actually governs).
  const multiplier = AFTER_MULTIPLIER[name] ?? 1.25;
  const before = syntheticGenreBars({ ...spec, durationSec: SEG_DUR_SEC });
  const after = syntheticGenreBars({
    ...spec,
    bpm: spec.bpm * multiplier,
    durationSec: SEG_DUR_SEC,
  });
  const driftBars = [...before.bars, ...after.bars];
  const driftEnv = onsetEnvelope(driftBars);
  const anchors = detectTempoSegments(driftEnv, FRAME_RATE);
  const transitionAnchor = anchors?.find((a) => a.time > 2) ?? null;
  const truePeriodSec = 60 / after.actualBpm;
  const toleranceSec = Math.min(ONSET_SNAP_MAX_SEC, truePeriodSec * ONSET_SNAP_PHASE_PCT);
  const transitionDeviationMs =
    transitionAnchor == null ? null : Math.abs(transitionAnchor.time - SEG_DUR_SEC) * 1000;
  const timingOk =
    transitionAnchor != null && Math.abs(transitionAnchor.time - SEG_DUR_SEC) <= toleranceSec;

  return {
    genre: name,
    bpmActual: Math.round(actualBpm * 100) / 100,
    bpmDetected: bpmResult.bpm,
    bpmPctErr: bpmPctErr == null ? null : Math.round(bpmPctErr * 100) / 100,
    // dpBeatTrack's autocorrelation-strength confidence on the plain
    // (non-drift) constant-tempo pass above — additive field so funk's
    // lower-but-correct confidence (real microtiming lowers periodicity
    // without being wrong) is visible in the Validation Suite panel both
    // settings surfaces show, not just pass/fail.
    confidence: Math.round(bpmResult.confidence * 1000) / 1000,
    transitionDeviationMs:
      transitionDeviationMs == null ? null : Math.round(transitionDeviationMs * 10) / 10,
    toleranceMs: Math.round(toleranceSec * 1000 * 10) / 10,
    passed: bpmOk && timingOk,
  };
}

function main() {
  const perGenre = Object.entries(GENRE_ARCHETYPES).map(([name, spec]) => validateGenre(name, spec));
  const genresValidated = perGenre.filter((g) => g.passed).length;
  const totalGenres = perGenre.length;
  const allPassing = genresValidated === totalGenres;

  const summary = {
    generatedAt: new Date().toISOString(),
    toleranceMs: ONSET_SNAP_MAX_SEC * 1000,
    driftThresholdPct: DRIFT_THRESHOLD_PCT,
    genresValidated,
    totalGenres,
    allPassing,
    perGenre,
  };

  const outPath = resolve(__dirname, "../public/validationSummary.json");
  writeFileSync(outPath, JSON.stringify(summary, null, 2));

  if (!allPassing) {
    console.error(
      `[generate-validation-summary] FAILED — ${genresValidated}/${totalGenres} genres passing. ` +
        `Details: ${JSON.stringify(perGenre.filter((g) => !g.passed), null, 2)}`,
    );
    process.exit(1);
  }

  console.log(
    `[generate-validation-summary] OK — ${genresValidated}/${totalGenres} genres validated, ±${summary.toleranceMs}ms tolerance. Wrote ${outPath}`,
  );
}

main();
