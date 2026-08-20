// Shared multi-point beatgrid math for the waveform renderers
// (DeckWaveformV2.jsx, DeckWaveform.jsx) and the console's anchor editor.
// Keeping this in one place avoids duplicating the bar/phrase-continuity
// fix across both renderers.

/**
 * Builds a beat-index-continuous segment list from beatgrid anchor points.
 *
 * Each segment carries `beatsAtStart` — the accumulated beat count from the
 * first anchor through this segment's start. Without this, naively
 * restarting beat-index-from-0 at every tempo-change anchor desyncs bar/
 * phrase numbering exactly at the moment a DJ needs it most (the tempo
 * change itself). Matches rekordbox/Serato's own multi-marker beatgrid
 * behavior — bar count is continuous from the first marker.
 *
 * With no points (today's flat-BPM tracks — the overwhelming majority),
 * returns a single synthetic segment at time=0 so the caller's draw loop
 * needs no special-casing — this is what keeps the single-segment path
 * byte-identical to the pre-multi-point-grid rendering.
 *
 * @param {{time:number, bpm:number}[]} points
 * @param {number|null} flatBpm fallback when points is empty
 * @returns {{time:number, bpm:number, beatsAtStart:number}[]}
 */
export function buildGridSegments(points, flatBpm) {
  if (!points || points.length === 0) {
    if (!flatBpm || flatBpm <= 0) return [];
    return [{ time: 0, bpm: flatBpm, beatsAtStart: 0 }];
  }

  const sorted = [...points]
    .filter((p) => p && Number.isFinite(p.time) && Number.isFinite(p.bpm) && p.bpm > 0)
    .sort((a, b) => a.time - b.time);
  if (sorted.length === 0) {
    if (!flatBpm || flatBpm <= 0) return [];
    return [{ time: 0, bpm: flatBpm, beatsAtStart: 0 }];
  }

  const segments = [];
  let beatsAtStart = 0;
  for (let i = 0; i < sorted.length; i++) {
    segments.push({ time: sorted[i].time, bpm: sorted[i].bpm, beatsAtStart });
    if (i < sorted.length - 1) {
      const secPerBeat = 60 / sorted[i].bpm;
      beatsAtStart += (sorted[i + 1].time - sorted[i].time) / secPerBeat;
    }
  }
  return segments;
}

/**
 * Finds the segment covering timeSec (the last segment whose `time` is
 * <= timeSec, or the first segment if timeSec is before it — extended
 * backward, matching resolveBpmAtTime's before-first-anchor convention).
 * Returns null if segments is empty.
 */
export function segmentAt(segments, timeSec) {
  if (!segments || segments.length === 0) return null;
  if (timeSec < segments[0].time) return segments[0];
  let found = segments[0];
  for (const s of segments) {
    if (s.time <= timeSec) found = s;
    else break;
  }
  return found;
}

/**
 * Clamps a proposed drag time for points[index] to stay strictly between its
 * neighbors (or track start/end for the first/last anchor) — prevents
 * crossing/reordering the array. points must already be sorted by time
 * (buildGridSegments sorts internally, but drag operates on the raw points
 * array directly, so callers must sort before indexing).
 */
export function clampAnchorTime(points, index, proposedTime, trackDuration) {
  const EPSILON = 0.01; // seconds — keeps strictly-between, never touching
  const prev = index > 0 ? points[index - 1].time : 0;
  const next = index < points.length - 1 ? points[index + 1].time : trackDuration;
  const lo = index > 0 ? prev + EPSILON : 0;
  const hi = index < points.length - 1 ? next - EPSILON : trackDuration;
  return Math.max(lo, Math.min(hi, proposedTime));
}

/**
 * Finds the index of an anchor point within toleranceSec of timeSec, or -1.
 * Used to hit-test a click/drag-start against existing anchors before
 * falling through to "empty space" behavior (insert).
 */
export function hitTestAnchor(points, timeSec, toleranceSec) {
  if (!points || points.length === 0) return -1;
  let bestIdx = -1;
  let bestDist = Infinity;
  points.forEach((p, i) => {
    const dist = Math.abs(p.time - timeSec);
    if (dist <= toleranceSec && dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  });
  return bestIdx;
}

/**
 * Summarizes a track's beatgrid anchor points into the ZONES badge's
 * "N zones, lo-hi BPM" reading. `< 2` points means "one flat tempo the
 * whole way" (per buildGridSegments's backward-extension convention), not
 * a single zone — returns null so the caller falls through to normal
 * CONF/octave-control logic instead of showing a false "1 zone" badge.
 *
 * @param {{time:number, bpm:number}[]|null} points
 * @returns {{zoneCount:number, minBpm:number, maxBpm:number}|null}
 */
export function zoneSummary(points) {
  if (!points || points.length < 2) return null;
  const valid = points.filter((p) => p && Number.isFinite(p.bpm) && p.bpm > 0);
  if (valid.length < 2) return null;
  const bpms = valid.map((p) => p.bpm);
  return {
    zoneCount: valid.length,
    minBpm: Math.min(...bpms),
    maxBpm: Math.max(...bpms),
  };
}

/**
 * Snaps timeSec to the nearest beat boundary of the segment covering it —
 * used for double-click anchor insertion. We snap to the existing grid's
 * beat boundaries rather than a raw detected transient: a new tempo-change
 * anchor should slot cleanly into the surrounding beat cadence, and this
 * reuses quantizeToBeat's already-tested math instead of requiring a
 * separate persisted onset-times array.
 */
export function snapToGridBeat(segments, timeSec) {
  const seg = segmentAt(segments, timeSec);
  if (!seg) return timeSec;
  const secPerBeat = 60 / seg.bpm;
  return seg.time + Math.round((timeSec - seg.time) / secPerBeat) * secPerBeat;
}
