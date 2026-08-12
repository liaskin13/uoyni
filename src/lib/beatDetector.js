// Offline beat detection — onset envelope + dynamic-programming beat tracker.
//
// Adapted from Ellis, "Beat Tracking by Dynamic Programming" (JNMR 2007) —
// the same algorithm class librosa.beat.beat_track and @audio/beat's
// beatTrack() implement. We adapt only the DP recurrence itself rather than
// depending on @audio/beat: that library's public API only accepts raw
// sample buffers with no way to feed a pre-computed envelope, and it has no
// published npm release. Reimplementing ~80 lines of well-understood DP is
// smaller and safer than reintroducing a raw-PCM pass (see below).
//
// CRITICAL: never re-decode audio here. onsetEnvelope() operates on the
// small per-bar band array (bass/mid/high/peak, ~50 bars/sec) that
// analyzeAudio() already produces and returns to its caller — the same
// chunked-safe array used for waveform rendering. A second raw-PCM pass
// over D's 800MB-1GB+ WAVs would reintroduce the OOM bug documented in
// waveformAnalyzer.js's analyzeAudio() header. This module must only ever
// be called with that already-computed bars array.

const MIN_BPM = 60;
const MAX_BPM = 200;
const MIN_FRAMES_ABSOLUTE = 100; // ~2s at 50 bars/sec — too little to say anything
const MIN_BEATS_REQUIRED = 8; // per plan: <8 beats of data is "insufficient", not a crash
const FLAT_ENVELOPE_FLOOR = 0.02; // strongest onset peak must clear this to attempt tracking

/**
 * Onset-strength envelope derived from already-computed band data.
 * Uses positive-only peak flux (loud jumps register as onsets, decay does
 * not) blended with the high-band energy (transients/attack), since PSC's
 * catalog (hip hop/R&B, per project history) has strong percussive attack
 * concentrated in the high band.
 *
 * @param {{bass:number,mid:number,high:number,peak:number}[]} bars
 * @returns {number[]} onset strength per bar, same length as bars
 */
export function onsetEnvelope(bars) {
  if (!bars || bars.length === 0) return [];
  const env = new Array(bars.length);
  let prevPeak = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const flux = Math.max(0, (b.peak ?? 0) - prevPeak);
    env[i] = 0.5 * (b.high ?? 0) + 0.5 * flux;
    prevPeak = b.peak ?? 0;
  }
  return env;
}

/**
 * Estimate the dominant beat period via autocorrelation of the onset
 * envelope, restricted to the plausible DJ tempo range. A light log-Gaussian
 * prior around 120 BPM discourages (but does not forbid) extreme tempos —
 * residual octave errors are corrected by the console's one-click
 * double/halve control, not by this estimator alone.
 *
 * @returns {{ periodFrames: number, bpm: number, strength: number } | null}
 */
function estimateTempoPeriod(envelope, frameRate) {
  const minLag = Math.floor((60 / MAX_BPM) * frameRate);
  const maxLag = Math.ceil((60 / MIN_BPM) * frameRate);
  if (maxLag >= envelope.length) return null;

  const mean = envelope.reduce((a, b) => a + b, 0) / envelope.length;
  const centered = envelope.map((v) => v - mean);
  const energy = centered.reduce((a, v) => a + v * v, 0);
  if (energy <= 0) return null;

  let bestLag = -1;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = lag; i < centered.length; i++) {
      corr += centered[i] * centered[i - lag];
    }
    const normalized = corr / energy;
    const bpmAtLag = (60 * frameRate) / lag;
    const logRatio = Math.log2(bpmAtLag / 120);
    const prior = Math.exp(-(logRatio * logRatio) / (2 * 0.6 * 0.6)); // soft, wide prior
    const score = normalized * prior;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestLag < 0) return null;

  const bpm = (60 * frameRate) / bestLag;
  // Re-derive the un-weighted autocorrelation strength at the chosen lag for
  // confidence — the tempo prior should influence lag selection, not inflate
  // the reported confidence of a lag the raw signal doesn't actually support.
  let rawCorr = 0;
  for (let i = bestLag; i < centered.length; i++) {
    rawCorr += centered[i] * centered[i - bestLag];
  }
  const strength = Math.max(0, Math.min(1, rawCorr / energy));

  return { periodFrames: bestLag, bpm, strength };
}

/**
 * Dynamic-programming beat tracker (Ellis 2007) over an onset-strength
 * envelope. Never receives raw audio — see module header.
 *
 * @param {number[]} envelope onset strength per frame (from onsetEnvelope)
 * @param {{ frameRate?: number }} opts frameRate must match the bars' bars/sec (default 50)
 * @returns {{ bpm: number|null, beatOffsetSec: number|null, confidence: number, beatTimesSec: number[] }}
 */
export function dpBeatTrack(envelope, opts = {}) {
  const frameRate = opts.frameRate ?? 50;
  const degenerate = { bpm: null, beatOffsetSec: null, confidence: 0, beatTimesSec: [] };

  if (!envelope || envelope.length < MIN_FRAMES_ABSOLUTE) return degenerate;

  const peak = Math.max(...envelope);
  if (!Number.isFinite(peak) || peak < FLAT_ENVELOPE_FLOOR) return degenerate;

  const tempo = estimateTempoPeriod(envelope, frameRate);
  if (!tempo) return degenerate;

  const { periodFrames } = tempo;
  if (envelope.length < periodFrames * MIN_BEATS_REQUIRED) return degenerate;

  // Ellis recurrence: C[i] = O[i] + max over Delta in [period/2, 2*period] of
  // (txWeight(Delta) + C[i-Delta]), txWeight penalizing deviation from the
  // estimated period on a log scale.
  const alpha = 400; // transition-cost weight, matches Ellis's reference scale
  const minDelta = Math.max(1, Math.round(periodFrames / 2));
  const maxDelta = Math.round(periodFrames * 2);

  const n = envelope.length;
  const score = new Float64Array(n);
  const backlink = new Int32Array(n).fill(-1);

  for (let i = 0; i < n; i++) {
    let best = envelope[i]; // base case: no predecessor beats this
    let bestPrev = -1;
    const upper = Math.min(i, maxDelta);
    for (let delta = minDelta; delta <= upper; delta++) {
      const logRatio = Math.log2(delta / periodFrames);
      const txWeight = -alpha * logRatio * logRatio;
      const candidate = envelope[i] + txWeight + score[i - delta];
      if (candidate > best) {
        best = candidate;
        bestPrev = i - delta;
      }
    }
    score[i] = best;
    backlink[i] = bestPrev;
  }

  // Backtrace from the strongest-scoring frame in the final period window
  // (the true last beat may not be the literal final frame).
  let endIdx = n - 1;
  let endScore = -Infinity;
  const tailStart = Math.max(0, n - periodFrames);
  for (let i = tailStart; i < n; i++) {
    if (score[i] > endScore) {
      endScore = score[i];
      endIdx = i;
    }
  }

  const beatFrames = [];
  let cursor = endIdx;
  while (cursor >= 0) {
    beatFrames.push(cursor);
    cursor = backlink[cursor];
  }
  beatFrames.reverse();

  if (beatFrames.length < MIN_BEATS_REQUIRED) return degenerate;

  const beatTimesSec = beatFrames.map((f) => f / frameRate);
  const beatOffsetSec = beatTimesSec[0];
  const bpm = Math.round(tempo.bpm * 100) / 100;

  return {
    bpm,
    beatOffsetSec,
    confidence: tempo.strength,
    beatTimesSec,
  };
}

const DRIFT_WINDOW_SEC = 8; // per-window duration for independent tempo re-estimation
const DRIFT_THRESHOLD_PCT = 4; // matches typical live-mix tempo-drift tolerance before it's audible
const MAX_CORROBORATION_GAP_SEC = DRIFT_WINDOW_SEC * 2; // 16s — beyond this, a "corroborating" reading is too far away in time to trust as evidence of the SAME drift event, not a coincidentally similar one
const ONSET_SNAP_MAX_SEC = 0.07; // mir_eval's standard F-measure onset tolerance (70ms)
const ONSET_SNAP_PHASE_PCT = 0.175; // mir_eval's continuity_phase_threshold — fraction of the beat period

/**
 * Finds the strongest local maximum of the onset envelope within
 * +/-toleranceFrames of targetFrame. A "peak" must be a genuine local max
 * (>= both neighbors), not just the loudest sample in range — a point on the
 * rising/falling shoulder of a transient is not itself an onset. Exported
 * (alongside smoothWindowedTempo) so the onset-snap accept/reject boundary
 * can be unit-tested directly rather than only indirectly through
 * detectTempoSegments, where the smoothing/anchor-merge layers on top make
 * isolating this specific decision hard to observe black-box.
 *
 * @returns {number} the peak's frame index, or -1 if no local peak exists in range
 */
export function findNearestOnsetPeak(envelope, targetFrame, toleranceFrames) {
  const lo = Math.max(1, targetFrame - toleranceFrames);
  const hi = Math.min(envelope.length - 2, targetFrame + toleranceFrames);
  let bestFrame = -1;
  let bestVal = 0; // a flat/silent plateau (all-zero envelope) is not a genuine onset — require real positive energy
  for (let f = lo; f <= hi; f++) {
    const isLocalPeak = envelope[f] >= envelope[f - 1] && envelope[f] >= envelope[f + 1];
    if (isLocalPeak && envelope[f] > bestVal) {
      bestVal = envelope[f];
      bestFrame = f;
    }
  }
  return bestFrame;
}

/**
 * Smooths per-window tempo estimates via reject-then-corroborate: a
 * candidate drift (a window differing from the last confirmed BPM by
 * >=driftThresholdPct) is only accepted if the NEXT window corroborates it
 * (within corroborationTolerancePct) AND is close enough in TIME to be
 * trustworthy evidence — onset-snapping upstream can skip windows entirely,
 * so array adjacency does not imply ~8s time adjacency. A single
 * uncorroborated window (noise) is held flat at the last confirmed value,
 * never allowed to seed a new anchor on its own.
 *
 * @param {{time:number, bpm:number}[]} windows
 * @returns {{time:number, bpm:number}[]}
 */
export function smoothWindowedTempo(windows, opts = {}) {
  const driftThresholdPct = opts.driftThresholdPct ?? DRIFT_THRESHOLD_PCT;
  const corroborationTolerancePct = opts.corroborationTolerancePct ?? 3; // tighter than driftThresholdPct — see plan rationale
  const maxGapSec = opts.maxGapSec ?? MAX_CORROBORATION_GAP_SEC;

  if (!windows || windows.length <= 1) return windows ?? [];

  const pctDiff = (a, b) => (Math.abs(a - b) / b) * 100;
  const confirmed = [windows[0].bpm];

  for (let i = 1; i < windows.length; i++) {
    const prevConfirmed = confirmed[i - 1];
    const raw = windows[i].bpm;

    if (pctDiff(raw, prevConfirmed) < driftThresholdPct) {
      confirmed.push(prevConfirmed); // not a meaningful change — hold flat
      continue;
    }

    const next = windows[i + 1];
    const withinTimeRange = next && (next.time - windows[i].time) <= maxGapSec;
    const corroborated = withinTimeRange && pctDiff(next.bpm, raw) <= corroborationTolerancePct;
    confirmed.push(corroborated ? raw : prevConfirmed);
  }

  return windows.map((w, i) => ({ ...w, bpm: confirmed[i] }));
}

/**
 * Detects genuine tempo drift across a track by independently re-estimating
 * tempo per fixed-duration window of the raw onset envelope (NOT from
 * dpBeatTrack's own beat times — dpBeatTrack's alpha=400 transition-cost
 * penalty forces beat spacing toward near-constant, which averages real
 * drift away before it can be seen). Each window's time anchor is snapped to
 * the nearest genuine onset peak within mir_eval-grounded tolerance so
 * anchors land on audible beats, not raw window boundaries — a window with
 * no onset peak in tolerance is skipped rather than seeding a bad anchor,
 * which means the windows array can have gaps in TIME while staying
 * contiguous in array index (see smoothWindowedTempo, which accounts for
 * this). Estimates are then smoothed via reject-then-corroborate before the
 * final threshold-merge into anchors, so isolated noisy windows can't seed a
 * spurious anchor on their own.
 *
 * Returns null when there isn't enough data to say anything meaningful, or
 * when no window drifts beyond the threshold — callers should leave
 * beat_grid_points unset in that case (today's flat-BPM behavior, matching
 * every existing track), not write a single-anchor array.
 *
 * @param {number[]} envelope onset strength per frame (from onsetEnvelope)
 * @param {number} frameRate frames per second (matches the bars' bars/sec, typically 50)
 * @returns {{time:number, bpm:number}[] | null}
 */
export function detectTempoSegments(envelope, frameRate, opts = {}) {
  const windowSec = opts.windowSec ?? DRIFT_WINDOW_SEC;
  const driftThresholdPct = opts.driftThresholdPct ?? DRIFT_THRESHOLD_PCT;
  const windowFrames = Math.round(windowSec * frameRate);

  if (!envelope || envelope.length < windowFrames * 2) return null;

  const rawWindows = [];
  for (let start = 0; start + windowFrames <= envelope.length; start += windowFrames) {
    const slice = envelope.slice(start, start + windowFrames);
    const tempo = estimateTempoPeriod(slice, frameRate);
    if (!tempo) continue; // too quiet / no discernible periodicity in this window — skip, don't guess

    const beatPeriodSec = 60 / tempo.bpm;
    const toleranceSec = Math.min(ONSET_SNAP_MAX_SEC, beatPeriodSec * ONSET_SNAP_PHASE_PCT);
    const toleranceFrames = Math.max(1, Math.round(toleranceSec * frameRate));
    const snappedFrame = findNearestOnsetPeak(envelope, start, toleranceFrames);
    if (snappedFrame < 0) continue; // no genuine onset peak in tolerance — skip rather than seed a bad anchor

    rawWindows.push({ time: snappedFrame / frameRate, bpm: Math.round(tempo.bpm * 100) / 100 });
  }

  if (rawWindows.length < 2) return null;

  const smoothed = smoothWindowedTempo(rawWindows, { driftThresholdPct });

  const anchors = [smoothed[0]];
  for (let i = 1; i < smoothed.length; i++) {
    const last = anchors[anchors.length - 1];
    const pctDiff = (Math.abs(smoothed[i].bpm - last.bpm) / last.bpm) * 100;
    if (pctDiff >= driftThresholdPct) anchors.push(smoothed[i]);
  }

  if (anchors.length < 2) return null; // no meaningful drift found

  return anchors.map((a) => ({ time: a.time, bpm: a.bpm }));
}
