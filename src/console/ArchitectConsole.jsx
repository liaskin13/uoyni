import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSystem } from "../state/SystemContext";
import "./ArchitectConsole.css";
import InboxPanel from "./InboxPanel";
import DirectLinePanel from "./DirectLinePanel";
import ContextStrip from "./ContextStrip";
// import DeckWaveform from "../components/DeckWaveform"; // kept as fallback
import DeckWaveform from "../components/DeckWaveformV2";
import {
  LOCKBOX_PREFIX,
  VAULT_DISPLAY_NAMES,
  VAULT_ACCENT_COLORS,
  UPLOAD_WORKER_URL,
  UPLOAD_SECRET,
} from "../config";
import {
  tierDefaultsForMember,
  resolveMatrixPerm,
  toggleMatrixPerm,
  commitMatrixState,
  rollbackMatrixState,
} from "./matrixState";
import { fetchAllTracks, getAudioUrl } from "../lib/tracks";
import { generateCode, listCodes, revokeCode } from "../lib/accessCodes";
import {
  generateAndUploadWaveformV2,
  unpackFromBinary,
  saveWaveform,
  WAVEFORM_V2_SENTINEL,
} from "../lib/waveformAnalyzer";
import { onsetEnvelope } from "../lib/beatDetector";
import { zoneSummary } from "../lib/beatGrid";
import { computeHotCuePositions, migrateHotCuesToCueList } from "../lib/hotCueLayout";
import { useValidationSummary, formatValidationSummary } from "../lib/useValidationSummary";
import { BatchUploadQueue } from "../components/BatchUploadQueue";

// D1 stores waveform_data as JSON.stringify(value), so "v2" is stored as '"v2"'.
// This helper checks both the raw sentinel and the JSON-encoded form.
const isV2Sentinel = (waveformData) => {
  if (!waveformData) return false;
  if (waveformData === WAVEFORM_V2_SENTINEL) return true;
  try {
    return JSON.parse(waveformData) === WAVEFORM_V2_SENTINEL;
  } catch {
    return false;
  }
};
import { R2_PUBLIC_URL } from "../config";

const cleanBpm = (str) =>
  String(str ?? "")
    .replace(/\.0+$/, "")
    .trim();

const ALL_CUE_COLORS = [
  // Bank A (1–8) — Serato canonical
  "#e52020",
  "#e56020",
  "#e5a020",
  "#14dc14",
  "#00c8dc",
  "#1464dc",
  "#8c14dc",
  "#e5e5e5",
  // Bank B (9–16) — Extended palette
  "#ff2d78",
  "#ff7700",
  "#e8ff14",
  "#00ff66",
  "#0099ff",
  "#cc00ff",
  "#ff88bb",
  "#44ffee",
  // Bank C (17–24)
  "#ff4444",
  "#ff8844",
  "#ffcc44",
  "#44ff88",
  "#44ccff",
  "#4488ff",
  "#aa44ff",
  "#ffffff",
  // Bank D (25–32)
  "#cc1111",
  "#cc5511",
  "#cc9911",
  "#11cc55",
  "#11aacc",
  "#1155cc",
  "#7711cc",
  "#aaaaaa",
];

// Bank identity glyph: orientation (points down = A/B, points up = C/D) plus
// solid-vs-hollow fill (A/C solid, B/D hollow) — an orthogonal 2-bit encoding
// so bank identity never depends on hue, which is already spent identifying
// each individual cue (ALL_CUE_COLORS). Uses currentColor so it inherits
// exactly the same ghost/occupied color swap the pad's CSS `color` already
// drives — no separate empty/occupied styling needed here.
const CUE_BANK_SHAPE = {
  A: { pointsDown: true, solid: true },
  B: { pointsDown: true, solid: false },
  C: { pointsDown: false, solid: true },
  D: { pointsDown: false, solid: false },
};

function CueBankGlyph({ bank }) {
  const { pointsDown, solid } = CUE_BANK_SHAPE[bank] || CUE_BANK_SHAPE.A;
  const d = pointsDown ? "M6 11 L11 1 L1 1 Z" : "M6 1 L11 11 L1 11 Z";
  return (
    <svg
      className="arch-hotcue-glyph"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
    >
      {solid ? (
        <path d={d} fill="currentColor" />
      ) : (
        <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" />
      )}
    </svg>
  );
}

const LOOP_LENGTH_OPTIONS = [
  { id: "1-32", label: "1/32", type: "note", denominator: 32 },
  { id: "1-16", label: "1/16", type: "note", denominator: 16 },
  {
    id: "1-16-d",
    label: "1/16 D",
    type: "note",
    denominator: 16,
    dotted: true,
  },
  {
    id: "1-16-t",
    label: "1/16 T",
    type: "note",
    denominator: 16,
    triplet: true,
  },
  { id: "1-8", label: "1/8", type: "note", denominator: 8 },
  { id: "1-8-d", label: "1/8 D", type: "note", denominator: 8, dotted: true },
  { id: "1-8-t", label: "1/8 T", type: "note", denominator: 8, triplet: true },
  { id: "1-4", label: "1/4", type: "note", denominator: 4 },
  { id: "1-4-d", label: "1/4 D", type: "note", denominator: 4, dotted: true },
  { id: "1-4-t", label: "1/4 T", type: "note", denominator: 4, triplet: true },
  { id: "1-2", label: "1/2", type: "note", denominator: 2 },
  { id: "0-bar", label: "0 BAR", type: "beats", beats: 4 },
  { id: "1-bar", label: "1 BAR", type: "bars", bars: 1 },
  { id: "2-bars", label: "2 BARS", type: "bars", bars: 2 },
  { id: "4-bars", label: "4 BARS", type: "bars", bars: 4 },
  { id: "8-bars", label: "8 BARS", type: "bars", bars: 8 },
];
import * as audioEngine from "../lib/audioEngine";
import useAudioAnalyzer from "./useAudioAnalyzer";
import AdminSettings from "../admin/AdminSettings";
import PSCWordmark from "../components/PSCWordmark";

const VAULT_ROUTES = [
  {
    id: "venus",
    label: VAULT_DISPLAY_NAMES.venus,
    color: VAULT_ACCENT_COLORS.venus,
  },
  {
    id: "saturn",
    label: VAULT_DISPLAY_NAMES.saturn,
    color: VAULT_ACCENT_COLORS.saturn,
  },
  {
    id: "mercury",
    label: VAULT_DISPLAY_NAMES.mercury,
    color: VAULT_ACCENT_COLORS.mercury,
  },
  {
    id: "earth",
    label: VAULT_DISPLAY_NAMES.earth,
    color: VAULT_ACCENT_COLORS.earth,
  },
];

// Extracted for unit testing — moves a single track to a different vault.
// Throws on any non-2xx response so callers' Promise.all genuinely rejects
// on failure (see the response.ok fix applied to publish/retract this pass).
export async function moveTrackToVault(id, vault) {
  const res = await fetch(`${UPLOAD_WORKER_URL}/tracks/${id}`, {
    method: "PATCH",
    headers: {
      "PSC-Secret": UPLOAD_SECRET,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ vault }),
  });
  if (!res.ok) throw new Error(`Move failed for track ${id}: HTTP ${res.status}`);
}

// Below this, a detected_bpm is stored for reference but never surfaced as
// the track's BPM — show nothing rather than a wrong number (plan D4).
export const DETECTED_BPM_CONFIDENCE_THRESHOLD = 0.6;

// Extracted for unit testing — resolves a track's BPM. Manual entry
// (bpm_display, then bpm) always wins; falls back to the offline detector's
// result only when confidence clears DETECTED_BPM_CONFIDENCE_THRESHOLD.
// Returns null when no valid BPM can be resolved by any path.
export function resolveTrackBpm(track) {
  const source = track?.bpm_display || track?.bpm;
  const parsed = parseFloat(String(source || "").split("-")[0]);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;

  if (
    track?.detected_bpm != null &&
    track?.detected_bpm_confidence >= DETECTED_BPM_CONFIDENCE_THRESHOLD
  ) {
    return track.detected_bpm;
  }
  return null;
}

// Smart Crates — Serato-style dynamic compatibility crate (console-wide
// discoverability audit, 2026-08-16). Serato's real Smart Crates are a full
// arbitrary-field rule builder (genre/comment/year/etc, Match All/Any) —
// this schema (worker/schema.sql) has no genre/comment/year columns, and
// musical_key is unpopulated freeform text for nearly every track (no
// key-detection pipeline exists, unlike BPM which every track runs
// through). Scoped to what's actually real: BPM compatibility is the
// core signal; key is a bonus when it happens to be populated, never a
// hard requirement. ±6% matches the standard CDJ/turntable pitch-fader
// range DJs already think in.
export const SMART_CRATE_BPM_TOLERANCE = 0.06;

export function isBpmCompatible(bpmA, bpmB, tolerance = SMART_CRATE_BPM_TOLERANCE) {
  if (!bpmA || !bpmB) return false;
  const ratio = bpmA / bpmB;
  return ratio >= 1 - tolerance && ratio <= 1 + tolerance;
}

// Exact-match only — not full Camelot-wheel adjacency. Key data is too
// sparse in this library to justify parsing/normalizing arbitrary key
// notation right now; revisit if a real key-detection pipeline ships.
export function isKeyCompatible(keyA, keyB) {
  if (!keyA || !keyB) return null; // unknown — neither match nor mismatch
  return keyA.trim().toUpperCase() === keyB.trim().toUpperCase();
}

// 0 = not BPM-compatible (excluded from the crate). 1 = BPM match only.
// 2 = BPM + key match, ranked first. Reference is typically the loaded
// deck track — the "what can I mix into next" use case.
export function smartCrateScore(track, referenceTrack) {
  if (!track || !referenceTrack || track.id === referenceTrack.id) return 0;
  const bpmMatch = isBpmCompatible(
    resolveTrackBpm(track),
    resolveTrackBpm(referenceTrack),
  );
  if (!bpmMatch) return 0;
  return isKeyCompatible(track.musical_key, referenceTrack.musical_key) ? 2 : 1;
}

// Confidence badge color — 5 discrete 10%-wide bands, reusing the SA's
// already-vetted palette verbatim (useAudioAnalyzer.js:55-82) rather than
// inventing a new confidence-color scale. Discrete bands, not a gradient —
// matches the SA's own discrete-band treatment. Overrides DESIGN.md's prior
// "always neutral" badge rule by explicit owner direction (2026-08-15,
// see DESIGN.md Decisions Log) — do not revert to a flat neutral color.
export function confidenceBadgeColor(confidence) {
  const pct = (confidence ?? 0) * 100;
  if (pct < 60) return "#ff0000";
  if (pct < 70) return "#ff5500";
  if (pct < 80) return "#00ff00";
  if (pct < 90) return "#00ffff";
  return "#6600ff";
}

// Shared CONF badge — used both in track-list rows and the loaded-deck
// header (arch-deck-stats). Hidden entirely (not dimmed) until a detection
// has actually run, per DESIGN.md's "Confidence badge" spec. genreBucket
// drives the tooltip copy (confidenceBadgeTitle) — defaults to "dynamic"
// so callers that haven't threaded genre through yet still get a title.
function ConfBadge({ confidence, genreBucket = "dynamic" }) {
  const color = confidenceBadgeColor(confidence);
  const title = confidenceBadgeTitle(confidence, genreBucket);
  return (
    <span
      className="arch-detected-bpm-badge"
      style={{ borderColor: color, color }}
      aria-label={title}
      title={title}
    >
      CONF {Math.round((confidence ?? 0) * 100)}%
    </span>
  );
}

// New badge (Dynamic Tempo Analysis) — same slot/anatomy as CONF, neutral
// chrome (DESIGN.md "Meters vs. Chrome": a structural readout, not a
// confidence measurement, so it doesn't inherit CONF's color exception).
// Shows only when the track has ≥2 real beatgrid anchors. Mutually
// exclusive with CONF + the octave control — driven by data, not genre.
function ZonesBadge({ zones }) {
  if (!zones) return null;
  const title =
    "Multiple tempo zones detected — this track's rhythm shifts, so there's no single BPM to rate confidence against.";
  return (
    <span className="arch-detected-bpm-badge arch-zones-badge" aria-label={title} title={title}>
      ZONES · {zones.zoneCount} · {Math.round(zones.minBpm)}–{Math.round(zones.maxBpm)} BPM
    </span>
  );
}

// Dynamic Tempo Analysis (CONF-badge/genre plan) — genre vocabulary and
// bucket lookup. Small, deliberately not exhaustive: every entry maps to a
// validated threshold bucket rather than being a freeform/arbitrary field
// (matches why Smart Crates skipped a genre column entirely — see "What
// already exists" in the plan). Unknown/future genres default to "dynamic"
// — D's catalog is the platform's core subject, so the safe default errs
// toward not crying wolf on groove.
export const GENRE_BUCKETS = {
  DYNAMIC: "dynamic",
  BREAKBEAT: "dynamic",
  HOUSE: "static",
  TECHNO: "static",
};

export function bucketForGenre(genre) {
  return GENRE_BUCKETS[genre] ?? "dynamic";
}

// Resolution chain: per-track override, then console-level default, then
// the hardcoded fallback — same "manual value, then fallback" convention
// resolveTrackBpm already uses (track?.bpm_display || track?.bpm).
export function resolveTrackGenre(track, consoleDefaultGenre) {
  return track?.tempo_genre || consoleDefaultGenre || "DYNAMIC";
}

// A segmented track has no single tempo to be confident about or correct
// toward — that's a fact about the track (real measured drift), not a
// genre preference. When this returns non-null, the ZONES badge replaces
// CONF + the octave control for that track, regardless of genre.
export function resolveBeatgridZones(track) {
  return zoneSummary(parseBeatGridPoints(track?.beat_grid_points));
}

// Replaces the flawed `!cleanBpm(bpm_display) && !t.bpm` condition at all 3
// gate sites — that check only trims text, it doesn't distinguish "one
// fixed BPM is manually pinned" from "a manual range like '60-80' is
// annotated" (D's real library rows). A range means CONF/octave-control
// should still be evaluated (there's no single manual BPM overriding
// detection) — this function returns true ONLY for a single resolved BPM.
export function hasCompleteManualBpm(track) {
  const display = cleanBpm(track?.bpm_display);
  if (display && !display.includes("-")) return true;
  return Boolean(track?.bpm);
}

// Octave-correction trigger threshold, split out of
// DETECTED_BPM_CONFIDENCE_THRESHOLD entirely (that constant stays
// evidence-only, gating what BPM number resolveTrackBpm surfaces/uses for
// quantize math — unchanged). Static keeps today's exact behavior
// (validated, working, built for exactly that material). Dynamic requires
// a real, materially lower reading before suggesting a correction — groove
// alone shouldn't trigger it.
export const OCTAVE_CONTROL_CONFIDENCE_THRESHOLD = {
  dynamic: 0.35,
  static: DETECTED_BPM_CONFIDENCE_THRESHOLD,
};

// false whenever real measured drift exists (ZONES badge already wins —
// there's no single tempo to correct toward) or the BPM was already
// manually corrected (a terminal state, not just another confidence
// reading — see handleOctaveCorrect's manually_corrected PATCH below).
// Otherwise compares detected_bpm_confidence against the bucket-selected
// bar.
export function shouldShowOctaveControl(track, genreBucket) {
  if (resolveBeatgridZones(track)) return false;
  if (track?.manually_corrected) return false;
  const bar = OCTAVE_CONTROL_CONFIDENCE_THRESHOLD[genreBucket] ?? OCTAVE_CONTROL_CONFIDENCE_THRESHOLD.dynamic;
  return (track?.detected_bpm_confidence ?? 0) < bar;
}

// Mode-aware CONF badge tooltip copy — dynamic-bucket tracks reading low
// get an honest explanatory line (this is the direct, in-place answer to
// the question that started this whole investigation); static-bucket
// tracks don't get that caveat, since a low reading there is a real
// detection problem, not expected groove.
export function confidenceBadgeTitle(confidence, genreBucket) {
  const pct = Math.round((confidence ?? 0) * 100);
  if (genreBucket === "dynamic" && (confidence ?? 0) < DETECTED_BPM_CONFIDENCE_THRESHOLD) {
    return `Detected BPM confidence: ${pct}%. Lower readings are expected for groove-based material — this measures rhythmic rigidity, not accuracy.`;
  }
  return `Detected BPM confidence: ${pct}%`;
}

// Tempo-genre badge (renamed/redesigned from the raw LIVE-BPM badge) — same
// slot/span-family after the BPM digits. Always shows the track's resolved
// genre when a track is loaded (genre is a track classification, not a
// live measurement, so unlike the old LIVE badge this isn't gated on
// isPlaying). Live-detected BPM number always appends while playing (same
// as the badge it replaces — "—" fallback pre-confidence, unchanged), not
// gated on the 0.3 confidence threshold — L corrected this 2026-08-20,
// don't re-add the confidence gate. Interactive: double-click OR keyboard
// (Enter/Space, it's a real focusable control since the genre bucket now
// gates real behavior — shouldShowOctaveControl — not just a label) cycles
// the vocabulary via onActivate, which the caller pause-gates. dimmed drops
// this badge to 40% opacity when ZONES is active for the same track (the
// authoritative reading in that case) — resolved design-review decision,
// "Genre Dims."
function DynamicGenreBadge({ genre, liveBpm, isPlaying, dimmed, onActivate }) {
  return (
    <span
      className={`arch-stat arch-live-bpm arch-genre-badge${dimmed ? " arch-genre-badge--dim" : ""}`}
      tabIndex={0}
      role="button"
      aria-label={`Tempo genre: ${genre}. Press Enter to cycle.`}
      onDoubleClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate();
        }
      }}
    >
      {genre}
      {isPlaying && (
        <strong style={{ color: "var(--accent-green, #00cc66)", marginLeft: 4 }}>
          {liveBpm ?? "—"}
        </strong>
      )}
      <span className="arch-genre-badge-hint" aria-hidden="true">
        DOUBLE-CLICK TO CYCLE
      </span>
    </span>
  );
}

// T10 — tap-tempo gesture minimum. Fewer taps than this on gesture-finalize
// shows "keep tapping…" instead of computing a BPM.
export const TAP_MIN_TAPS = 4;

// T10 — converts a tap gesture's raw timestamps (ms, any monotonic clock) to
// a BPM, or null if there aren't enough taps yet OR the taps carry no real
// timing signal (e.g. zero-interval — every tap landed on the same
// millisecond, which happens with rapid/duplicate synthetic events). Without
// that guard, a zero-ms median divides 60000/0 = Infinity, which would then
// get PATCHed to the server as bpm_display:"Infinity" — verified as a real,
// reachable bug during /ship's coverage audit, not hypothetical. Outlier
// rejection: any interval outside 50-150% of the running median is discarded
// before averaging, so one fumbled extra/missed tap doesn't skew the result.
// Extracted as a pure function so this math is unit-testable independent of
// the gesture-timing/React-state plumbing in finalizeTapGesture.
export function computeTapTempoBpm(taps) {
  if (!taps || taps.length < TAP_MIN_TAPS) return null;
  const intervals = [];
  for (let i = 1; i < taps.length; i++) intervals.push(taps[i] - taps[i - 1]);
  const sorted = [...intervals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const kept = intervals.filter((iv) => iv >= median * 0.5 && iv <= median * 1.5);
  const use = kept.length ? kept : intervals;
  const avgMs = use.reduce((a, b) => a + b, 0) / use.length;
  if (!(avgMs > 0)) return null; // zero/negative/NaN — no real tempo signal
  return Math.round((60000 / avgMs) * 10) / 10;
}

// T11 — beat-relative onset-envelope window: 2 beats before + 2 beats after
// the hovered time (4 * 60/bpm seconds total), converted to a bar-index
// range and a 0-1 cursor fraction locating hoverTime within that range.
// Extracted as a pure function (all inputs primitives, no DOM/canvas) so the
// window math is unit-testable independent of the canvas-drawing plumbing
// in drawEnvelopeRow. Returns null when there isn't a real window to show
// (bpm/envelope missing, or the computed window is empty).
export function computeEnvelopeWindow({ hoverTime, bpm, envelopeLength, barsPerSec = 50 }) {
  if (hoverTime == null || !bpm || !envelopeLength) return null;
  const beatSec = 60 / bpm;
  const windowStart = Math.max(0, hoverTime - 2 * beatSec);
  const windowEnd = hoverTime + 2 * beatSec;
  const startBar = Math.max(0, Math.floor(windowStart * barsPerSec));
  const endBar = Math.min(envelopeLength, Math.ceil(windowEnd * barsPerSec));
  if (endBar <= startBar) return null;

  const actualStart = startBar / barsPerSec;
  const actualEnd = endBar / barsPerSec;
  const cursorFrac =
    (hoverTime - actualStart) / Math.max(0.0001, actualEnd - actualStart);
  return { startBar, endBar, cursorFrac };
}

// Parses track.beat_grid_points defensively — it's stored as a JSON TEXT
// column (matches cue_labels' pattern) but may already be a parsed array
// depending on caller. Returns [] for null/invalid/malformed input.
export function parseBeatGridPoints(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Extracted for unit testing — position-aware BPM lookup for the multi-point
// beatgrid (Part 3). REGRESSION-CRITICAL: with no grid points, this must
// produce output identical to resolveTrackBpm() for every existing track —
// every track today has no grid points, so this is the plan's
// highest-risk-of-silent-breakage path.
export function resolveBpmAtTime(track, timeSec) {
  const points = parseBeatGridPoints(track?.beat_grid_points)
    .filter((p) => p && Number.isFinite(p.time) && Number.isFinite(p.bpm) && p.bpm > 0)
    .sort((a, b) => a.time - b.time);

  if (points.length === 0) return resolveTrackBpm(track);

  // Before the first anchor: extend it backward — no "no tempo" region,
  // matches rekordbox/Serato's own multi-marker beatgrid convention.
  if (timeSec < points[0].time) return points[0].bpm;

  // Last anchor with time <= timeSec.
  let bpm = points[0].bpm;
  for (const p of points) {
    if (p.time <= timeSec) bpm = p.bpm;
    else break;
  }
  return bpm;
}

// Stricter than detectDownbeatPhase's own MIN_DOWNBEAT_CONTRAST=0.15 (that's
// the floor for "does this exist at all" — a badge-display risk). Acting on
// it to move where a loop starts is higher-stakes than showing a badge, so
// it needs a materially higher bar: more than double the existence floor.
export const QUANTIZE_DOWNBEAT_CONFIDENCE_THRESHOLD = 0.35;

// Extracted for unit testing — mirrors resolveBpmAtTime's exact walk pattern
// (same sorted beat_grid_points array, same "last anchor with time <=
// timeSec" logic) but resolves downbeatOffset/downbeatConfidence instead of
// bpm, and returns 0 (today's unchanged default) when no grid points exist
// or confidence doesn't clear the bar. REGRESSION-CRITICAL, same class as
// resolveBpmAtTime: with no downbeat data at all (every track before this
// ships), this must return 0 — identical to today's behavior.
export function resolveDownbeatOffsetForQuantize(track, timeSec) {
  const points = parseBeatGridPoints(track?.beat_grid_points)
    .filter((p) => p && Number.isFinite(p.time))
    .sort((a, b) => a.time - b.time);

  if (points.length === 0) {
    if ((track?.detected_downbeat_confidence ?? 0) >= QUANTIZE_DOWNBEAT_CONFIDENCE_THRESHOLD) {
      return track.detected_downbeat_offset ?? 0;
    }
    return 0;
  }

  let anchor = points[0];
  for (const p of points) {
    if (p.time <= timeSec) anchor = p;
    else break;
  }
  if ((anchor.downbeatConfidence ?? 0) >= QUANTIZE_DOWNBEAT_CONFIDENCE_THRESHOLD) {
    return anchor.downbeatOffset ?? 0;
  }
  return 0;
}

// Extracted for unit testing — snaps timeSec to the nearest beat boundary.
// bpmAt is a resolver function, not a raw number, so position-aware lookups
// (multi-point beatgrid, Part 3) can slot in later without touching call sites.
// No-ops (returns timeSec unchanged) when bpmAt(timeSec) is falsy.
export function quantizeToBeat(timeSec, bpmAt, offsetSec = 0) {
  const bpm = bpmAt(timeSec);
  if (!bpm) return timeSec;
  const beatSeconds = 60 / bpm;
  return offsetSec + Math.round((timeSec - offsetSec) / beatSeconds) * beatSeconds;
}

// Extracted for unit testing — routes a track through the existing sequential
// waveformQueueRef/runWaveformQueue pipeline instead of calling
// ensureWaveformForTrack directly. Two call sites (handleUpload, loadAndPlay)
// used to bypass the queue, causing one concurrent AudioContext decode per
// track on a multi-file drop. queueRef holds track objects (not bare ids) —
// matches runWaveformQueue's existing shift()+ensureWaveformForTrack(track)
// contract, same shape the initial-load queue already populates it with.
export function enqueueWaveformGeneration(track, queueRef, runQueueFn) {
  queueRef.current.push(track);
  runQueueFn();
}

// Extracted for unit testing — starts a requestAnimationFrame loop that
// drives engine.enforceLoop(loopRegion) at display refresh rate (~16ms)
// while loopActiveRef.current is true. Originally (2026-08-16 quick fix)
// this called engine.seek() directly on every crossing — replaced by a
// thin delegation to audioEngine.js's enforceLoop() once the sample-
// accurate buffer-loop engine shipped: enforceLoop still does that same
// hard-seek as a fallback (before the loop-region audio has finished
// decoding, or permanently for non-WAV tracks), but also hands playback to
// the buffer engine once it's ready — at which point this rAF loop becomes
// a no-op by construction (see enforceLoop's own comment for why). Keeping
// the polling loop itself here, rather than folding it into audioEngine.js,
// is deliberate: audioEngine.js has no React lifecycle to hook rAF
// start/stop into.
export function startLoopEnforcement(
  loopRegion,
  loopActiveRef,
  engine,
  raf = requestAnimationFrame,
  caf = cancelAnimationFrame,
) {
  let rafId;
  const tick = () => {
    if (loopActiveRef.current) engine.enforceLoop(loopRegion);
    rafId = raf(tick);
  };
  rafId = raf(tick);
  return () => caf(rafId);
}

function vaultLabel(id) {
  if (!id) return "—";
  if (id.startsWith(LOCKBOX_PREFIX))
    return `FEATURED · ${id.replace(LOCKBOX_PREFIX, "").toUpperCase()}`;
  return VAULT_DISPLAY_NAMES[id] || "—";
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function parseDurationInput(str) {
  if (!str || !str.trim()) return null;
  const parts = str.trim().split(":").map(Number);
  if (parts.some(isNaN) || parts.length < 1 || parts.length > 3) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] > 0 ? parts[0] : null;
}

function parseWaveformData(rawWaveform) {
  if (!rawWaveform) return null;
  try {
    return typeof rawWaveform === "string"
      ? JSON.parse(rawWaveform)
      : rawWaveform;
  } catch {
    return null;
  }
}

const DIRECT_LINE_KEY = "psc_direct_line";
const DIRECT_LINE_CHANNEL = "psc_direct_line_channel";

const SR_ONLY_STYLE = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

function EventHorizonPanel({ architectArchive, onRestore, onClose }) {
  return (
    <motion.div
      id="arch-event-horizon-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby="arch-archive-title"
      aria-describedby="arch-archive-sub"
      className="arch-event-horizon-panel"
      initial={{ x: "100%", opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: "100%", opacity: 0 }}
      transition={{ type: "spring", stiffness: 120, damping: 22 }}
    >
      <div className="arch-panel-header">
        <span className="arch-panel-dot" />
        <span id="arch-archive-title" className="arch-panel-title">
          ARCHIVE LOG
        </span>
        <span id="arch-archive-sub" className="arch-panel-sub">
          Secure stasis layer — soft-deleted items, restorable
        </span>
        <button
          className="arch-panel-close"
          onClick={onClose}
          aria-label="Close archive log"
        >
          ✕
        </button>
      </div>

      <div className="arch-horizon-entries">
        {architectArchive.length === 0 ? (
          <div className="arch-horizon-empty">— ARCHIVE CLEAR —</div>
        ) : (
          architectArchive.map((item) => (
            <motion.div
              key={item.id}
              className={`arch-horizon-entry ${item.restored ? "restored" : ""}`}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: item.restored ? 0.35 : 1, x: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div className="arch-entry-name">
                {item.label || item.name || item.id}
              </div>
              <div className="arch-entry-meta">
                <span className="arch-entry-origin">
                  {vaultLabel(item.originPlanet)}
                </span>
                <span className="arch-entry-time">
                  {new Date(item.voidedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              {!item.restored && (
                <button
                  className="arch-restore-btn"
                  onClick={() => onRestore(item.id)}
                >
                  RESTORE
                </button>
              )}
              {item.restored && (
                <span className="arch-restored-badge">RESTORED</span>
              )}
            </motion.div>
          ))
        )}
      </div>

      <div className="arch-panel-footer">
        <span className="arch-count">
          {architectArchive.filter((i) => !i.restored).length} SECURED ITEMS
        </span>
        <span className="arch-count">
          {architectArchive.filter((i) => i.restored).length} RESTORED
        </span>
      </div>
    </motion.div>
  );
}

function ArchitectConsole({
  onPowerDown,
  onExplorePlanet,
  onBroadcast,
  onIntake,
  viewer = "L",
  accent = "cyan",
  batchQueue = [],
  onBatchRetry,
  onBatchDismiss,
}) {
  const {
    architectArchive,
    restoreItem,
    unreadCountL,
    members,
    voidItem,
    addMember,
    tracks: vaultTracksState,
  } = useSystem();
  const MATRIX_COMMITTED_KEY = "psc_matrix_committed";
  const MATRIX_HISTORY_KEY = "psc_matrix_history";
  const ARCH_PREFS_KEY = "psc_architect_prefs";
  const ARCH_RUNTIME_KEY = "psc_architect_runtime";
  const [showArchive, setShowArchive] = useState(false);
  const [showInbox, setShowInbox] = useState(false);
  const [showRoster, setShowRoster] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [reachMessages, setReachMessages] = useState(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(DIRECT_LINE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [activeVault, setActiveVault] = useState(null);
  const [activeLibVault, setActiveLibVault] = useState(VAULT_ROUTES[0].id);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [showPowerConfirm, setShowPowerConfirm] = useState(false);
  const [showVoidConfirm, setShowVoidConfirm] = useState(false);
  const [revokeConfirmId, setRevokeConfirmId] = useState(null);
  const [showTrackList, setShowTrackList] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAccessCodes, setShowAccessCodes] = useState(false);
  const [showVaults, setShowVaults] = useState(false);
  const [vaultConfigs, setVaultConfigs] = useState([]);
  const [vaultEdits, setVaultEdits] = useState({});
  const [vaultSaving, setVaultSaving] = useState({});
  const [acTier, setAcTier] = useState("MEMBERS");
  const [acGrantedTo, setAcGrantedTo] = useState("");
  const [acExpiresAt, setAcExpiresAt] = useState("");
  const [acResult, setAcResult] = useState(null);
  const [acCodes, setAcCodes] = useState([]);
  const [acWorking, setAcWorking] = useState(false);
  const [acError, setAcError] = useState(null);
  const [trackListData, setTrackListData] = useState([]);
  const [trackListLoading, setTrackListLoading] = useState(false);
  const [trackLoadError, setTrackLoadError] = useState(null);
  const [sortMode, setSortMode] = useState("recent");
  const [smartCrates, setSmartCrates] = useState(false);
  const [historyEnabled, setHistoryEnabled] = useState(true);
  const [prepareQueue, setPrepareQueue] = useState([]);
  const [selectedTrackId, setSelectedTrackId] = useState(null);
  const [loadedDeckId, setLoadedDeckId] = useState(null);
  const [trackPlayCounts, setTrackPlayCounts] = useState({});
  const [trackHistory, setTrackHistory] = useState([]);
  const [waveformDetail, setWaveformDetail] = useState("high");
  const [trackColorRows, setTrackColorRows] = useState(true);
  const [autoLoopDefault, setAutoLoopDefault] = useState(false);
  const [quantizeEnabled, setQuantizeEnabled] = useState(false);
  // Console-level default tempo genre — applied to tracks with no saved
  // tempo_genre yet (D1). Follows the five-key persisted pattern below,
  // not quantizeEnabled's session-only one.
  const [consoleDefaultGenre, setConsoleDefaultGenre] = useState("DYNAMIC");
  const [selectedTrackIds, setSelectedTrackIds] = useState(new Set());
  const [publishFilter, setPublishFilter] = useState("all");
  const [publishState, setPublishState] = useState({
    status: "idle",
    count: 0,
  });
  const [retractState, setRetractState] = useState({
    status: "idle",
    count: 0,
  });
  const [moveState, setMoveState] = useState({ status: "idle", count: 0 });
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const [voidSelectedState, setVoidSelectedState] = useState({
    status: "idle",
    count: 0,
  });
  const [regenSelectedState, setRegenSelectedState] = useState({
    status: "idle",
    count: 0,
  });
  const [editingTrackId, setEditingTrackId] = useState(null);
  const [editingValues, setEditingValues] = useState({});
  const [rosterShowAdd, setRosterShowAdd] = useState(false);
  const [rosterName, setRosterName] = useState("");
  const [rosterPlanet, setRosterPlanet] = useState("");
  const [rosterTier, setRosterTier] = useState("B");
  const [rosterMoon, setRosterMoon] = useState("");
  const [rosterCode, setRosterCode] = useState("");
  const [rosterFlash, setRosterFlash] = useState(null);
  const [rosterReveal, setRosterReveal] = useState(null);
  const [showMatrix, setShowMatrix] = useState(false);
  const [matrixArmed, setMatrixArmed] = useState(false);
  const [matrixPending, setMatrixPending] = useState({});
  const [matrixCommitted, setMatrixCommitted] = useState({});
  const [matrixHistory, setMatrixHistory] = useState([]);
  const [liveAnnouncement, setLiveAnnouncement] = useState("");
  const [systemStatus, setSystemStatus] = useState(null); // { message, kind: 'success'|'error'|'info' } | null — visible comms-box readout ('info' renders neutral, no CSS rule needed — .arch-comms-lcd.has-status already provides the neutral border/text default)
  const [libSearch, setLibSearch] = useState("");
  // Audio playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [volume, setVolume] = useState(audioEngine.getVolume());
  const [loadedTrack, setLoadedTrack] = useState(null);
  const [regeneratingWaveforms, setRegeneratingWaveforms] = useState({});
  const [waveformProgress, setWaveformProgress] = useState({}); // trackId → 0-100
  const [octaveCorrectError, setOctaveCorrectError] = useState({}); // trackId → transient error-flash flag
  const [genreCycleError, setGenreCycleError] = useState({}); // trackId → transient error-flash flag (mirrors octaveCorrectError)
  const octaveCorrectSeqRef = useRef({}); // trackId → latest fired PATCH sequence number
  const genreCycleSeqRef = useRef({}); // trackId → latest fired PATCH sequence number
  const waveformQueueRef = useRef([]); // pending trackIds for sequential auto-gen
  const waveformQueueRunning = useRef(false);

  // T10 — tap-tempo gesture state (see handleTap/finalizeTapGesture below)
  const tapTimestampsRef = useRef([]);
  const tapIdleTimeoutRef = useRef(null);
  const tapHintTimeoutRef = useRef(null);
  const [tapCount, setTapCount] = useState(0);
  const [tapHintVisible, setTapHintVisible] = useState(false);

  // Hot cues: { trackId: [{ id, time, label, pinned, slot }, ...] }. `slot`
  // (1-32) is the pad a cue was originally set on / is frozen to once pinned
  // (labeled) — it's the fallback address when auto-sort is off, and the
  // permanent address once pinned. When auto-sort is on, an unpinned cue's
  // actual displayed pad is computed fresh by computeHotCuePositions, not
  // read from `slot`.
  const [hotCues, setHotCues] = useState(() => {
    try {
      const stored = localStorage.getItem("psc_hotcues");
      return stored ? migrateHotCuesToCueList(JSON.parse(stored)) : {};
    } catch {
      return {};
    }
  });
  const [autoSortCues, setAutoSortCues] = useState(() => {
    try {
      const stored = localStorage.getItem("psc_hotcue_autosort");
      return stored === null ? true : stored === "true";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("psc_hotcue_autosort", String(autoSortCues));
    } catch (_) {}
  }, [autoSortCues]);
  const [activeCueBank, setActiveCueBank] = useState("A");
  const [editingCueNum, setEditingCueNum] = useState(null); // internal cue number being label-edited
  const [editingCueLabel, setEditingCueLabel] = useState("");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [loopRegion, setLoopRegion] = useState({ start: null, end: null });
  const [selectedLoopLengthId, setSelectedLoopLengthId] = useState("1-4");
  const [loopPanelTrigger, setLoopPanelTrigger] = useState(0);
  const [waveformZoom, setWaveformZoom] = useState(20);
  const [waveformZoomPresets, setWaveformZoomPresets] = useState(null);
  const TIME_WINDOWS_SEC = [64, 32, 16, 8, 4, 2];
  const stepZoom = (dir) => {
    if (!waveformZoomPresets?.length) return;
    const idx = waveformZoomPresets.findIndex((p) => p >= waveformZoom);
    const safeIdx = idx === -1 ? waveformZoomPresets.length - 1 : idx;
    setWaveformZoom(
      waveformZoomPresets[
        Math.max(0, Math.min(waveformZoomPresets.length - 1, safeIdx + dir))
      ],
    );
  };
  const [deckHighResBars, setDeckHighResBars] = useState(null);
  const waveformBarsCache = useRef({}); // trackId → decoded bars array
  const loadedDeckIdRef = useRef(null);
  const loopActiveRef = useRef(false);

  const rafRef = useRef(null);
  const announceTimerRef = useRef(null);
  const systemStatusTimerRef = useRef(null);
  const retractTimerRef = useRef(null);
  const kbRef = useRef({});
  const tabRefs = useRef([]);
  const gliderRef = useRef(null);
  const cursorRef = useRef(null);
  const cursorPos = useRef({ x: -200, y: -200 });
  const selectedTrack = useMemo(
    () => trackListData.find((t) => t.id === selectedTrackId) || null,
    [trackListData, selectedTrackId],
  );
  const deckTrack = selectedTrack || loadedTrack;
  const loadedWaveform = useMemo(
    () => parseWaveformData(loadedTrack?.waveform_data),
    [loadedTrack?.waveform_data],
  );
  const deckWaveform = useMemo(
    () => parseWaveformData(deckTrack?.waveform_data),
    [deckTrack?.waveform_data],
  );
  const loadedWaveformHighData = loadedWaveform?.high || null;
  // High-res binary from R2 takes priority over D1 JSON for the deck waveform
  const deckWaveformHighData = deckHighResBars || deckWaveform?.high || null;
  const deckWaveformLowData = deckWaveform?.low || null;
  const deckTrackHasWaveform =
    Array.isArray(deckWaveformHighData) && deckWaveformHighData.length > 0;
  const deckIsGenerating = !!(deckTrack && regeneratingWaveforms[deckTrack.id]);
  const deckCanSeek = !!(
    loadedTrack &&
    deckTrack &&
    loadedTrack.id === deckTrack.id &&
    audioDuration > 0
  );

  const overviewRef = useRef(null);
  const waveformHoveredRef  = useRef(false);
  const overviewHoveredRef  = useRef(false);

  // T11 — onset-envelope explainability row. Envelope is computed once per
  // track load (onsetEnvelope is O(n) but cheap-once/wasteful-per-hover —
  // see beatDetector.js's header) and cached here, keyed by track id so a
  // fast track switch can't show a stale envelope. Hover time is tracked in
  // a ref, not React state — DeckWaveformV2 reports it on every mousemove,
  // and redrawing the row's own canvas imperatively avoids a React
  // re-render per pixel of mouse movement (same reasoning as this file's
  // other rAF/ref-driven canvases).
  const envelopeCanvasRef = useRef(null);
  const envelopeCacheRef = useRef({ trackId: null, envelope: null });
  const envelopeHoverRef = useRef(null); // hovered time in seconds, or null when idle
  // Backing-store size (CSS width + dpr) last applied to the canvas.
  // drawEnvelopeRow() reassigns canvas.width/height only when this actually
  // changes — reassigning on every call (this row redraws on every native
  // mousemove over the waveform) forces a full canvas reset each time,
  // needlessly expensive at mouse-event rates. Found by /ship's performance
  // specialist, 2026-08-15.
  const envelopeCanvasSizeRef = useRef({ w: 0, dpr: 0 });
  const [overviewStyle, setOverviewStyle] = useState(0); // 0=LAYERS 1=OUTLINE 2=TRACES
  const OVERVIEW_STYLES = ['LAYERS', 'OUTLINE', 'TRACES'];
  const stepOverviewStyle = (dir) =>
    setOverviewStyle(s => (s + dir + OVERVIEW_STYLES.length) % OVERVIEW_STYLES.length);

  const validationSummary = useValidationSummary(); // T13 — settings panel row

  const { vuRef, vuRRef, specRef, energyRef, phiRef, bpmResultRef } = useAudioAnalyzer({
    isPlaying,
    waveformData: deckHighResBars || loadedWaveformHighData,
    currentTime,
    duration: audioDuration,
    hotCues: deckTrack
      ? computeHotCuePositions(hotCues[deckTrack.id] || [], autoSortCues)
      : {},
  });

  const [liveBpm, setLiveBpm] = useState(null);
  useEffect(() => {
    if (!isPlaying) { setLiveBpm(null); return; }
    const id = setInterval(() => {
      const r = bpmResultRef.current;
      setLiveBpm(r.confidence >= 0.3 ? r.bpm : null);
    }, 500);
    return () => clearInterval(id);
  }, [isPlaying, bpmResultRef]);

  // Sync REACH messages for display bar
  useEffect(() => {
    const sync = () => {
      try {
        const parsed = JSON.parse(
          localStorage.getItem(DIRECT_LINE_KEY) || "[]",
        );
        setReachMessages(Array.isArray(parsed) ? parsed : []);
      } catch {}
    };
    const onStorage = (e) => {
      if (e.key === DIRECT_LINE_KEY) sync();
    };
    window.addEventListener("storage", onStorage);
    let channel = null;
    if ("BroadcastChannel" in window) {
      channel = new BroadcastChannel(DIRECT_LINE_CHANNEL);
      channel.onmessage = (e) => {
        if (e?.data?.type === "sync") sync();
      };
    }
    const pollId = window.setInterval(sync, 2000);
    return () => {
      window.removeEventListener("storage", onStorage);
      if (channel) channel.close();
      window.clearInterval(pollId);
    };
  }, []);

  // Run the waveform queue — one track at a time, pauses when audio is playing.
  const runWaveformQueue = useCallback(async () => {
    if (waveformQueueRunning.current) return;
    waveformQueueRunning.current = true;
    while (waveformQueueRef.current.length > 0) {
      // Pause while audio is playing so generation doesn't compete for bandwidth
      if (audioEngine.getState().isPlaying) {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      const track = waveformQueueRef.current.shift();
      if (!track || waveformBarsCache.current[track.id]) continue;
      await ensureWaveformForTrack(track, true);
    }
    waveformQueueRunning.current = false;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-load tracks on mount + listen for upload events
  useEffect(() => {
    const loadTracks = () => {
      fetchAllTracks()
        .then((tracks) => {
          setTrackListData(tracks);
          setTrackLoadError(null);
          // Queue all tracks missing V2 binary for sequential background generation
          const needsWaveform = tracks.filter(
            (t) =>
              !isV2Sentinel(t.waveform_data) &&
              !waveformBarsCache.current[t.id],
          );
          if (needsWaveform.length > 0) {
            waveformQueueRef.current = [...needsWaveform];
            runWaveformQueue();
          }
        })
        .catch((err) => {
          console.error("[PSC] Failed to load tracks:", err);
          setTrackLoadError("VAULT UNAVAILABLE");
        });
    };
    loadTracks();

    // Refresh library + trigger waveform gen for newly uploaded track
    const handleUpload = (e) => {
      loadTracks();
      const newTrack = e?.detail;
      if (newTrack?.id && newTrack.audio_path) {
        enqueueWaveformGeneration(newTrack, waveformQueueRef, runWaveformQueue);
      }
    };
    window.addEventListener("psc:track-uploaded", handleUpload);
    return () => window.removeEventListener("psc:track-uploaded", handleUpload);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const move = (e) => {
      cursorPos.current = { x: e.clientX, y: e.clientY };
      if (cursorRef.current) {
        cursorRef.current.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      }
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, []);

  const announce = (message) => {
    if (!message) return;
    if (announceTimerRef.current) clearTimeout(announceTimerRef.current);
    setLiveAnnouncement("");
    announceTimerRef.current = setTimeout(() => {
      setLiveAnnouncement(message);
    }, 20);
  };

  // Visible comms-box status readout — for action RESULTS only (save/publish/
  // retract/move/void/regen), never for routine transport/navigation feedback.
  // Also fires the screen-reader announcement via announce(). Timing matches
  // the VU meter's clip-indicator hold (DESIGN.md: 1800ms hold + 200ms fade).
  const SYSTEM_STATUS_HOLD_MS = 2000;
  const announceStatus = (message, kind = "success") => {
    if (!message) return;
    announce(message);
    if (systemStatusTimerRef.current) clearTimeout(systemStatusTimerRef.current);
    setSystemStatus({ message, kind });
    systemStatusTimerRef.current = setTimeout(() => {
      setSystemStatus(null);
    }, SYSTEM_STATUS_HOLD_MS);
  };

  // Magnetic glider — moves toward active tab
  const moveGlider = useCallback((idx) => {
    const tab = tabRefs.current[idx];
    const glider = gliderRef.current;
    if (!tab || !glider) return;
    const { offsetLeft, offsetWidth } = tab;
    glider.style.transform = `translateX(${offsetLeft}px) scaleX(${offsetWidth})`;
  }, []);

  const hoverGlider = useCallback(
    (idx) => {
      const activeIdx = VAULT_ROUTES.findIndex((v) => v.id === activeLibVault);
      const activTab = tabRefs.current[activeIdx];
      const hoverTab = tabRefs.current[idx];
      const glider = gliderRef.current;
      if (!activTab || !hoverTab || !glider) return;
      const from = activTab.offsetLeft;
      const to = hoverTab.offsetLeft;
      const pulled = from + (to - from) * 0.4;
      const fromW = activTab.offsetWidth;
      const toW = hoverTab.offsetWidth;
      const pulledW = fromW + (toW - fromW) * 0.4;
      glider.style.transform = `translateX(${pulled}px) scaleX(${pulledW})`;
    },
    [activeLibVault],
  );

  useEffect(() => {
    const idx = VAULT_ROUTES.findIndex((v) => v.id === activeLibVault);
    moveGlider(idx);
  }, [activeLibVault, moveGlider]);

  useEffect(() => {
    try {
      const committed = JSON.parse(
        localStorage.getItem(MATRIX_COMMITTED_KEY) || "{}",
      );
      const history = JSON.parse(
        localStorage.getItem(MATRIX_HISTORY_KEY) || "[]",
      );
      if (committed && typeof committed === "object")
        setMatrixCommitted(committed);
      if (Array.isArray(history)) setMatrixHistory(history);
    } catch (_) {
      setMatrixCommitted({});
      setMatrixHistory([]);
    }
  }, []);

  useEffect(() => {
    try {
      const prefs = JSON.parse(localStorage.getItem(ARCH_PREFS_KEY) || "{}");
      const runtime = JSON.parse(
        localStorage.getItem(ARCH_RUNTIME_KEY) || "{}",
      );
      if (prefs && typeof prefs === "object") {
        if (prefs.waveformDetail) setWaveformDetail(prefs.waveformDetail);
        if (typeof prefs.trackColorRows === "boolean")
          setTrackColorRows(prefs.trackColorRows);
        if (typeof prefs.autoLoopDefault === "boolean")
          setAutoLoopDefault(prefs.autoLoopDefault);
        if (typeof prefs.smartCrates === "boolean")
          setSmartCrates(prefs.smartCrates);
        if (typeof prefs.historyEnabled === "boolean")
          setHistoryEnabled(prefs.historyEnabled);
        if (prefs.consoleDefaultGenre)
          setConsoleDefaultGenre(prefs.consoleDefaultGenre);
      }
      if (runtime && typeof runtime === "object") {
        if (
          runtime.trackPlayCounts &&
          typeof runtime.trackPlayCounts === "object"
        )
          setTrackPlayCounts(runtime.trackPlayCounts);
        if (Array.isArray(runtime.trackHistory))
          setTrackHistory(runtime.trackHistory);
        if (Array.isArray(runtime.prepareQueue))
          setPrepareQueue(runtime.prepareQueue);
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        MATRIX_COMMITTED_KEY,
        JSON.stringify(matrixCommitted),
      );
    } catch (_) {}
  }, [matrixCommitted]);

  useEffect(() => {
    try {
      localStorage.setItem(MATRIX_HISTORY_KEY, JSON.stringify(matrixHistory));
    } catch (_) {}
  }, [matrixHistory]);

  useEffect(() => {
    try {
      localStorage.setItem(
        ARCH_PREFS_KEY,
        JSON.stringify({
          waveformDetail,
          trackColorRows,
          autoLoopDefault,
          smartCrates,
          historyEnabled,
          consoleDefaultGenre,
        }),
      );
    } catch (_) {}
  }, [
    autoLoopDefault,
    historyEnabled,
    smartCrates,
    trackColorRows,
    waveformDetail,
    consoleDefaultGenre,
  ]);

  useEffect(() => {
    try {
      localStorage.setItem(
        ARCH_RUNTIME_KEY,
        JSON.stringify({
          trackPlayCounts,
          trackHistory,
          prepareQueue,
        }),
      );
    } catch (_) {}
  }, [prepareQueue, trackHistory, trackPlayCounts]);

  useEffect(
    () => () => {
      if (announceTimerRef.current) clearTimeout(announceTimerRef.current);
    },
    [],
  );

  // Sync audio engine state → React (RAF loop while playing, listener otherwise)
  useEffect(() => {
    const unsub = audioEngine.onStateChange((state) => {
      setIsPlaying(state.isPlaying);
      setAudioDuration(state.duration);
      setCurrentTime(state.currentTime);
    });
    return unsub;
  }, []);


  const handleVaultSelect = (vaultId) => {
    const next = vaultId === activeVault ? null : vaultId;
    setActiveVault(next);
    announce(
      next ? `${vaultLabel(next)} selected.` : "Vault selection cleared.",
    );
  };

  // ── Audio handlers ──────────────────────────────────────────────────
  const loadAndPlay = async (track) => {
    audioEngine.prewarm(); // synchronous — creates AudioContext inside gesture scope
    const url = getAudioUrl(track.audio_path);
    if (!url) {
      announce("No audio file for this track.");
      return;
    }
    setAudioError(null);
    setAudioLoading(true);
    announce(`Loading ${track.title || "track"}…`);
    try {
      await audioEngine.load(url);
      setSelectedTrackId(track.id);
      setLoadedTrack(track);
      setLoadedDeckId(track.id);
      loadedDeckIdRef.current = track.id;
      setDeckHighResBars(null);
      // A loop set on the PREVIOUS track must not survive onto this one —
      // audioEngine.load() already tore down/discarded its own loop-engine
      // state; this clears the React-side mirror (loop overlay prop, CLR
      // button gate). Found this session: without it, a stale loopRegion
      // could re-arm against a new track's unrelated timeline.
      setLoopRegion({ start: null, end: null });
      loopActiveRef.current = false;
      // T10/T11 — a mid-gesture tap count or a stale hover position from the
      // PREVIOUS track must not bleed into the newly loaded one (coverage
      // audit finding, 2026-08-15): the tap button would otherwise show a
      // leftover "TAP · N" on a fresh track, and the envelope row could
      // briefly draw the old track's data at the old hover position.
      tapTimestampsRef.current = [];
      if (tapIdleTimeoutRef.current) clearTimeout(tapIdleTimeoutRef.current);
      if (tapHintTimeoutRef.current) clearTimeout(tapHintTimeoutRef.current);
      setTapCount(0);
      setTapHintVisible(false);
      envelopeHoverRef.current = null;
      pushTrackHistory(track);
      setTrackPlayCounts((prev) => ({
        ...prev,
        [track.id]: (prev[track.id] || 0) + 1,
      }));
      audioEngine.play();
      announce(`Playing ${track.title || "track"}.`);
      loadWaveformBinaryForDeck(track.id);
      // Direct call, not the shared queue: the queue's pause-while-playing gate
      // (runWaveformQueue) exists to throttle the BACKGROUND backlog, but this is
      // the single track just loaded onto the deck — routing it through that gate
      // would stall its own waveform/BPM/beatgrid generation for as long as it
      // plays. The AudioContext-leak fix this queue was introduced alongside lives
      // in analyzeAudio()'s try/finally, not in queue routing, so bypassing the
      // queue here doesn't reopen it.
      if (!track.waveform_data) ensureWaveformForTrack(track);
    } catch (err) {
      console.error("[PSC] Audio load error:", err);
      setAudioError(err.message);
      announce("Audio load failed.");
    } finally {
      setAudioLoading(false);
    }
  };

  const loadToDeck = async (track) => {
    audioEngine.prewarm();
    const url = getAudioUrl(track.audio_path);
    if (!url) {
      announce("No audio file for this track.");
      return;
    }
    setAudioError(null);
    setAudioLoading(true);
    announce(`Loading ${track.title || "track"} to deck…`);
    try {
      audioEngine.stop();
      await audioEngine.load(url);
      setSelectedTrackId(track.id);
      setLoadedTrack(track);
      setLoadedDeckId(track.id);
      loadedDeckIdRef.current = track.id;
      setDeckHighResBars(null);
      // See loadAndPlay's identical comment — a loop set on the previous
      // track must not survive onto this one.
      setLoopRegion({ start: null, end: null });
      loopActiveRef.current = false;
      // T10/T11 — a mid-gesture tap count or a stale hover position from the
      // PREVIOUS track must not bleed into the newly loaded one (coverage
      // audit finding, 2026-08-15): the tap button would otherwise show a
      // leftover "TAP · N" on a fresh track, and the envelope row could
      // briefly draw the old track's data at the old hover position.
      tapTimestampsRef.current = [];
      if (tapIdleTimeoutRef.current) clearTimeout(tapIdleTimeoutRef.current);
      if (tapHintTimeoutRef.current) clearTimeout(tapHintTimeoutRef.current);
      setTapCount(0);
      setTapHintVisible(false);
      envelopeHoverRef.current = null;
      announce(`${track.title || "Track"} loaded to deck. Press PLAY.`);
      loadWaveformBinaryForDeck(track.id);
    } catch (err) {
      setAudioError(err.message);
      announce("Audio load failed.");
    } finally {
      setAudioLoading(false);
    }
  };

  const handlePlayPause = () => {
    audioEngine.prewarm();
    if (!audioEngine.isLoaded()) {
      // Load selected track if deck is empty
      const track = trackListData.find((t) => t.id === selectedTrackId);
      if (track) {
        loadAndPlay(track);
        return;
      }
      announce("No track loaded. Select a track first.");
      return;
    }
    if (isPlaying) {
      audioEngine.pause();
      announce("Paused.");
    } else {
      audioEngine.play();
      announce(`Playing ${loadedTrack?.title || "track"}.`);
    }
  };

  const handleSeek = (seconds) => {
    if (!audioEngine.isLoaded()) return;
    audioEngine.seek(seconds);
    announce(`Seek to ${formatTime(seconds)}.`);
  };

  const skipTapRef = useRef({ dir: 0, count: 0, timer: null });
  const handleBarSkip = (dir) => {
    if (!audioEngine.isLoaded()) return;
    const t = skipTapRef.current;
    clearTimeout(t.timer);
    if (t.dir !== dir) t.count = 0;
    t.dir = dir;
    t.count++;
    t.timer = setTimeout(() => {
      const bpm = resolveTrackBpm(loadedTrack);
      const barSec = bpm ? (4 * 60) / bpm : 8;
      const bars = t.count >= 2 ? 8 : 4;
      const live = audioEngine.getState();
      const dest = Math.max(0, Math.min(live.currentTime + dir * bars * barSec, live.duration));
      handleSeek(dest);
      announce(`Skip ${dir > 0 ? "forward" : "back"} ${bars} bars.`);
      t.count = 0;
    }, 400);
  };

  const handleCue = () => {
    if (!audioEngine.isLoaded()) {
      announce("No track loaded.");
      return;
    }
    audioEngine.seek(0);
    audioEngine.play();
    announce("Cue.");
  };

  const handleVolumeChange = (e) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    audioEngine.setVolume(v);
  };

  const toggleArchive = () => {
    setShowArchive((prev) => {
      const next = !prev;
      announce(`Archive log ${next ? "opened" : "closed"}.`);
      return next;
    });
  };

  const toggleInbox = () => {
    setShowInbox((prev) => {
      const next = !prev;
      announce(`Vetting inbox ${next ? "opened" : "closed"}.`);
      return next;
    });
  };

  const toggleRoster = () => {
    setShowRoster((prev) => {
      const next = !prev;
      announce(`Roster ${next ? "opened" : "closed"}.`);
      return next;
    });
  };

  const toggleMatrix = () => {
    setShowMatrix((prev) => {
      const next = !prev;
      announce(`Command matrix ${next ? "opened" : "closed"}.`);
      return next;
    });
  };

  const toggleTrackList = async () => {
    const next = !showTrackList;
    setShowTrackList(next);
    announce(`Track registry ${next ? "opened" : "closed"}.`);
    if (next) {
      setTrackListLoading(true);
      const tracks = await fetchAllTracks();
      setTrackListData(tracks);
      setTrackListLoading(false);
    }
  };

  const toggleSettings = () => {
    setShowSettings((prev) => {
      const next = !prev;
      announce(`Settings ${next ? "opened" : "closed"}.`);
      return next;
    });
  };

  const toggleAccessCodes = async () => {
    const next = !showAccessCodes;
    setShowAccessCodes(next);
    announce(`Access codes ${next ? "opened" : "closed"}.`);
    if (next) {
      setAcWorking(true);
      try {
        setAcCodes(await listCodes());
      } catch (_) {
        setAcError("Failed to load codes");
      } finally {
        setAcWorking(false);
      }
    }
  };

  const handleGenerateCode = async () => {
    setAcWorking(true);
    setAcError(null);
    setAcResult(null);
    try {
      const result = await generateCode({
        tier: acTier,
        grantedTo: acGrantedTo || undefined,
        expiresAt: acExpiresAt ? `${acExpiresAt}T00:00:00Z` : undefined,
      });
      setAcResult(result);
      setAcCodes(await listCodes());
    } catch (e) {
      setAcError(e.message || "Failed to generate code");
    } finally {
      setAcWorking(false);
    }
  };

  const handleRevokeCode = async (codeId) => {
    try {
      await revokeCode(codeId);
      setAcCodes((prev) => prev.filter((c) => c.id !== codeId));
    } catch (_) {
      setAcError("Failed to revoke");
    }
  };

  const fetchVaultConfigs = useCallback(async () => {
    try {
      const res = await fetch(`${UPLOAD_WORKER_URL}/vaults`, {
        headers: { "PSC-Secret": UPLOAD_SECRET },
      });
      if (!res.ok) return;
      const data = await res.json();
      setVaultConfigs(data);
      const edits = {};
      data.forEach((v) => {
        edits[v.vault_id] = {
          label: v.label,
          color: v.color ?? "",
          visibility: v.visibility ?? 1,
          copy: v.copy ?? "",
        };
      });
      setVaultEdits(edits);
    } catch (_) {}
  }, []);

  const saveVaultConfig = async (vaultId) => {
    const edit = vaultEdits[vaultId];
    if (!edit) return;
    setVaultSaving((s) => ({ ...s, [vaultId]: true }));
    try {
      await fetch(`${UPLOAD_WORKER_URL}/vaults/${vaultId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "PSC-Secret": UPLOAD_SECRET,
        },
        body: JSON.stringify({
          label: edit.label,
          color: edit.color || null,
          visibility: edit.visibility,
          copy: edit.copy,
        }),
      });
    } catch (_) {}
    setVaultSaving((s) => ({ ...s, [vaultId]: false }));
  };

  const toggleVaults = () => {
    setShowVaults((p) => {
      if (!p) fetchVaultConfigs();
      return !p;
    });
  };

  const [showSignalPanel, setShowSignalPanel] = useState(false);
  const [signalTitle, setSignalTitle] = useState("");
  const [signalLive, setSignalLive] = useState(false);
  const [signalWorking, setSignalWorking] = useState(false);
  const [streamKeyRevealed, setStreamKeyRevealed] = useState(false);

  const SIGNAL_WORKER = "https://psc-upload-worker.psoulc.workers.dev";

  const handleGoLive = async () => {
    setSignalWorking(true);
    try {
      await fetch(`${SIGNAL_WORKER}/signal`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "PSC-Secret": UPLOAD_SECRET,
        },
        body: JSON.stringify({
          is_live: 1,
          title: signalTitle.trim() || "THE SIGNAL",
        }),
      });
      setSignalLive(true);
      setIsBroadcasting(true);
      onBroadcast?.();
      announce("The Signal is live.");
    } catch (_) {
    } finally {
      setSignalWorking(false);
    }
  };

  const handleEndSignal = async () => {
    setSignalWorking(true);
    try {
      await fetch(`${SIGNAL_WORKER}/signal`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "PSC-Secret": UPLOAD_SECRET,
        },
        body: JSON.stringify({ is_live: 0, title: null }),
      });
      setSignalLive(false);
      setIsBroadcasting(false);
      announce("The Signal ended.");
    } catch (_) {
    } finally {
      setSignalWorking(false);
    }
  };

  const handleBroadcast = () => setShowSignalPanel(true);

  // Load high-res waveform binary via the worker proxy (CORS-safe).
  // Returns true if binary was loaded successfully.
  const loadWaveformBinaryForDeck = async (trackId) => {
    if (waveformBarsCache.current[trackId]) {
      setDeckHighResBars(waveformBarsCache.current[trackId]);
      return true;
    }
    try {
      const res = await fetch(
        `${UPLOAD_WORKER_URL}/tracks/${trackId}/waveform-bin`,
      );
      if (!res.ok) return false;
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const bars = unpackFromBinary(bytes);
      if (bars) {
        waveformBarsCache.current[trackId] = bars;
        setDeckHighResBars(bars);
        const presets = TIME_WINDOWS_SEC.map((s) =>
          Math.max(1, Math.round(bars.length / (s * 50))),
        );
        setWaveformZoomPresets(presets);
        setWaveformZoom(presets[1]); // default: 32s window
        return true;
      }
    } catch (err) {
      console.error("[PSC] waveform binary load failed:", err.message);
    }
    return false;
  };

  const ensureWaveformForTrack = async (
    track,
    shouldAnnounce = false,
    force = false,
  ) => {
    if (!track || regeneratingWaveforms[track.id]) return;

    // If track has sentinel, try the binary first — regenerate only if it's missing
    if (!force && waveformBarsCache.current[track.id]) return;
    if (!force && isV2Sentinel(track.waveform_data)) {
      const loaded = await loadWaveformBinaryForDeck(track.id);
      if (loaded) return;
      // Binary missing or unreachable — fall through to regenerate
    }

    const url = getAudioUrl(track.audio_path);
    if (!url) return;

    setRegeneratingWaveforms((prev) => ({ ...prev, [track.id]: true }));
    setWaveformProgress((prev) => ({ ...prev, [track.id]: 0 }));
    if (shouldAnnounce)
      announce(`Analyzing waveform for ${track.title || "track"}…`);

    try {
      const {
        bars,
        duration,
        detectedBpm,
        detectedBeatOffset,
        detectedBpmConfidence,
        tempoSegments,
        detectedDownbeatOffset,
        detectedDownbeatConfidence,
      } = await generateAndUploadWaveformV2(track.id, url, (pct) => {
        setWaveformProgress((prev) => ({ ...prev, [track.id]: pct }));
        if (shouldAnnounce && pct % 25 === 0 && pct > 0) {
          announce(`Waveform ${pct}% — ${track.title || "track"}`);
        }
      });

      waveformBarsCache.current[track.id] = bars;
      if (loadedDeckIdRef.current === track.id) {
        setDeckHighResBars(bars);
        const presets = TIME_WINDOWS_SEC.map((s) =>
          Math.max(1, Math.round(bars.length / (s * 50))),
        );
        setWaveformZoomPresets(presets);
        setWaveformZoom(presets[1]); // default: 32s window
      }
      if (shouldAnnounce)
        announce(`Waveform ready for ${track.title || "track"}.`);
      try {
        // Always persist the raw detection result, even below-confidence-threshold —
        // resolveTrackBpm() gates whether it's *surfaced*, this just stores it (D4/D7).
        await saveWaveform(track.id, WAVEFORM_V2_SENTINEL, duration, {
          waveform_generated_at: new Date().toISOString(),
          waveform_error: null,
          detected_bpm: detectedBpm,
          detected_beat_offset: detectedBeatOffset,
          detected_bpm_confidence: detectedBpmConfidence,
          detected_downbeat_offset: detectedDownbeatOffset,
          detected_downbeat_confidence: detectedDownbeatConfidence,
        });
        if (duration != null) {
          setTrackListData((prev) =>
            prev.map((t) =>
              t.id === track.id
                ? {
                    ...t,
                    duration,
                    waveform_data: WAVEFORM_V2_SENTINEL,
                    detected_bpm: detectedBpm,
                    detected_beat_offset: detectedBeatOffset,
                    detected_bpm_confidence: detectedBpmConfidence,
                    detected_downbeat_offset: detectedDownbeatOffset,
                    detected_downbeat_confidence: detectedDownbeatConfidence,
                  }
                : t,
            ),
          );
        }
      } catch (_) {
        /* non-critical */
      }
      // Auto-seed multi-point beatgrid anchors when the detector found real
      // tempo drift (plan T7) — null means stable tempo, leave beat_grid_points
      // unset entirely rather than writing a spurious single-anchor grid.
      // EXCEPTION: if this track previously had drift-era grid points (from
      // an earlier Regenerate) and now reads as flat, those points — and the
      // per-anchor downbeatOffset/downbeatConfidence they carry — are stale
      // and must be explicitly cleared, or resolveBpmAtTime/
      // resolveDownbeatOffsetForQuantize keep resolving against the old,
      // now-outdated segment data instead of the fresh flat-tempo values.
      if (tempoSegments) {
        handleBeatGridPointsChange(track, tempoSegments);
      } else if (parseBeatGridPoints(track?.beat_grid_points).length > 0) {
        handleBeatGridPointsChange(track, null);
      }
    } catch (err) {
      if (shouldAnnounce) announce(`Waveform failed: ${err.message}`);
      console.error("[PSC] waveform generation failed:", err);
      try {
        await saveWaveform(track.id, track.waveform_data ?? null, null, {
          waveform_error: err.message?.slice(0, 200) ?? "unknown error",
        });
      } catch (_) {
        /* non-critical */
      }
    } finally {
      setRegeneratingWaveforms((prev) => {
        const next = { ...prev };
        delete next[track.id];
        return next;
      });
      setWaveformProgress((prev) => {
        const next = { ...prev };
        delete next[track.id];
        return next;
      });
    }
  };

  const handleTrackSelect = (track) => {
    setSelectedTrackId(track.id);
    setActiveVault(track.vault || null);
    announce(`${track.title || "Track"} selected.`);
  };

  const handleTrackRowKeyDown = (event, track) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleTrackSelect(track);
    }
  };

  const handleTrackDoubleClick = (track) => {
    setSelectedTrackId(track.id);
    setActiveVault(track.vault || null);
    loadAndPlay(track);
  };

  const handleToggleTrackSelection = (e, trackId) => {
    e.stopPropagation();
    setSelectedTrackIds((prev) => {
      const next = new Set(prev);
      next.has(trackId) ? next.delete(trackId) : next.add(trackId);
      return next;
    });
  };

  const handlePublishSelected = async () => {
    const ids = [...selectedTrackIds];
    if (!ids.length) return;
    setPublishState({ status: "pending", count: ids.length });
    try {
      await Promise.all(
        ids.map(async (id) => {
          const res = await fetch(`${UPLOAD_WORKER_URL}/tracks/${id}/publish`, {
            method: "PUT",
            headers: { "PSC-Secret": UPLOAD_SECRET },
          });
          if (!res.ok) throw new Error(`Publish failed for track ${id}: HTTP ${res.status}`);
        }),
      );
      setTrackListData((prev) =>
        prev.map((t) =>
          selectedTrackIds.has(t.id) ? { ...t, is_published: 1 } : t,
        ),
      );
      setSelectedTrackIds(new Set());
      setPublishState({ status: "success", count: ids.length });
      announceStatus(
        `${ids.length} track${ids.length > 1 ? "s" : ""} published to vault.`,
      );
      setTimeout(() => setPublishState({ status: "idle", count: 0 }), 800);
    } catch (err) {
      setPublishState({ status: "error", count: ids.length });
      announceStatus(`Publish failed — ${err.message}`, "error");
    }
  };

  const handleRetractSelected = async () => {
    const ids = [...selectedTrackIds];
    if (!ids.length) return;

    // First click: arm the confirm state with 3s auto-cancel
    if (retractState.status !== "confirm") {
      setRetractState({ status: "confirm", count: ids.length });
      if (retractTimerRef.current) clearTimeout(retractTimerRef.current);
      retractTimerRef.current = setTimeout(() => {
        setRetractState({ status: "idle", count: 0 });
      }, 3000);
      return;
    }

    // Second click (confirmed): execute
    if (retractTimerRef.current) clearTimeout(retractTimerRef.current);
    setRetractState({ status: "pending", count: ids.length });
    try {
      await Promise.all(
        ids.map(async (id) => {
          const res = await fetch(`${UPLOAD_WORKER_URL}/tracks/${id}/retract`, {
            method: "PUT",
            headers: { "PSC-Secret": UPLOAD_SECRET },
          });
          if (!res.ok) throw new Error(`Retract failed for track ${id}: HTTP ${res.status}`);
        }),
      );
      setTrackListData((prev) =>
        prev.map((t) =>
          selectedTrackIds.has(t.id) ? { ...t, is_published: 0 } : t,
        ),
      );
      setSelectedTrackIds(new Set());
      setRetractState({ status: "success", count: ids.length });
      announceStatus(
        `${ids.length} track${ids.length > 1 ? "s" : ""} retracted from vault.`,
      );
      setTimeout(() => setRetractState({ status: "idle", count: 0 }), 800);
    } catch (err) {
      setRetractState({ status: "error", count: ids.length });
      announceStatus(`Retract failed — ${err.message}`, "error");
    }
  };

  const handleMoveSelected = async (targetVault) => {
    const ids = [...selectedTrackIds];
    setShowMoveMenu(false);
    if (!ids.length || !targetVault) return;
    setMoveState({ status: "pending", count: ids.length });
    try {
      await Promise.all(ids.map((id) => moveTrackToVault(id, targetVault)));
      setTrackListData((prev) =>
        prev.map((t) =>
          selectedTrackIds.has(t.id) ? { ...t, vault: targetVault } : t,
        ),
      );
      setSelectedTrackIds(new Set());
      setMoveState({ status: "success", count: ids.length });
      announceStatus(
        `${ids.length} track${ids.length > 1 ? "s" : ""} moved → ${vaultLabel(targetVault)}.`,
      );
      setTimeout(() => setMoveState({ status: "idle", count: 0 }), 800);
    } catch (err) {
      setMoveState({ status: "error", count: ids.length });
      announceStatus(`Move failed — ${err.message}`, "error");
    }
  };

  const handleVoidSelected = async () => {
    const ids = [...selectedTrackIds];
    if (!ids.length) return;
    setVoidSelectedState({ status: "pending", count: ids.length });
    try {
      await Promise.all(
        ids.map(async (id) => {
          const res = await fetch(`${UPLOAD_WORKER_URL}/tracks/${id}/void`, {
            method: "PUT",
            headers: { "PSC-Secret": UPLOAD_SECRET },
          });
          if (!res.ok) throw new Error(`Void failed for track ${id}: HTTP ${res.status}`);
        }),
      );
      setTrackListData((prev) => prev.filter((t) => !selectedTrackIds.has(t.id)));
      setSelectedTrackIds(new Set());
      setVoidSelectedState({ status: "success", count: ids.length });
      announceStatus(
        `${ids.length} track${ids.length > 1 ? "s" : ""} voided.`,
      );
      setTimeout(() => setVoidSelectedState({ status: "idle", count: 0 }), 800);
    } catch (err) {
      setVoidSelectedState({ status: "error", count: ids.length });
      announceStatus(`Void failed — ${err.message}`, "error");
    }
  };

  const handleRegenSelected = async () => {
    const ids = [...selectedTrackIds];
    if (!ids.length) return;
    const tracks = ids
      .map((id) => trackListData.find((t) => t.id === id))
      .filter(Boolean);
    setRegenSelectedState({ status: "pending", count: tracks.length });
    let failures = 0;
    // Sequential, not Promise.all — concurrent waveform generation opens one
    // AudioContext per track and doesn't close them (the exact bug behind
    // this session's earlier "EncodingError: Decoding failed" investigation).
    for (const track of tracks) {
      try {
        await ensureWaveformForTrack(track, false, true);
      } catch (err) {
        failures += 1;
        console.error(`[PSC] regen failed for track ${track.id}:`, err);
      }
    }
    setSelectedTrackIds(new Set());
    if (failures === 0) {
      setRegenSelectedState({ status: "success", count: tracks.length });
      announceStatus(
        `Regenerated waveform${tracks.length > 1 ? "s" : ""} for ${tracks.length} track${tracks.length > 1 ? "s" : ""}.`,
      );
    } else {
      setRegenSelectedState({ status: "error", count: failures });
      announceStatus(
        `Regen failed for ${failures} of ${tracks.length} track${tracks.length > 1 ? "s" : ""}.`,
        "error",
      );
    }
    setTimeout(() => setRegenSelectedState({ status: "idle", count: 0 }), 800);
  };

  const handleEditStart = (e, track) => {
    e.stopPropagation();
    setEditingTrackId(track.id);
    setEditingValues({
      title: track.title || "",
      artist: track.artist || "",
      bpm_display:
        cleanBpm(track.bpm_display) ||
        (track.bpm ? Math.round(track.bpm).toString() : ""),
      duration_display: track.duration ? formatTime(track.duration) : "",
    });
  };

  const handleEditSave = async (trackId) => {
    const vals = editingValues;
    const originalTrack = trackListData.find((t) => t.id === trackId);
    setEditingTrackId((curr) => (curr === trackId ? null : curr));
    setEditingValues({});

    // Convert duration_display ("79:30" or "1:23:45") → duration in seconds
    const patchVals = { ...vals };
    if (patchVals.duration_display !== undefined) {
      const parsed = parseDurationInput(patchVals.duration_display);
      if (parsed != null) patchVals.duration = parsed;
      delete patchVals.duration_display;
    }

    setTrackListData((prev) =>
      prev.map((t) => (t.id === trackId ? { ...t, ...patchVals } : t)),
    );
    fetch(`${UPLOAD_WORKER_URL}/tracks/${trackId}`, {
      method: "PATCH",
      headers: {
        "PSC-Secret": UPLOAD_SECRET,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(patchVals),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`[PSC] edit PATCH ${res.status}`);
        const result = await res.json().catch(() => ({}));
        if (!result.success) throw new Error("[PSC] edit save: D1 returned success=false");
        announceStatus("Saved.");
      })
      .catch((err) => {
        console.error("[PSC] edit save failed:", err);
        if (originalTrack) {
          setTrackListData((prev) =>
            prev.map((t) => (t.id === trackId ? originalTrack : t)),
          );
        }
        announceStatus("Save failed — check console for details.", "error");
      });
  };

  // T10 — tap-tempo manual override. A gesture is a burst of taps with no
  // gap over TAP_IDLE_MS; it finalizes (computes a BPM, or shows the
  // "keep tapping…" hint) on that idle timeout, not on any explicit
  // press-release event. Writes bpm_display via the same optimistic-PATCH
  // pattern as handleEditSave, so the deck header reflects it immediately.
  const TAP_IDLE_MS = 2000;
  const TAP_TEMPO_USAGE_KEY = "psc_tap_tempo_uses";

  const applyTapTempo = useCallback(
    (bpm) => {
      if (!deckTrack) return;
      const trackId = deckTrack.id;
      const originalTrack = trackListData.find((t) => t.id === trackId);
      const bpmStr = String(bpm);

      setTrackListData((prev) =>
        prev.map((t) => (t.id === trackId ? { ...t, bpm_display: bpmStr } : t)),
      );

      // Usage counter (plan D-note: "revisit only if real usage shows the
      // control needs more than this") — same localStorage pattern already
      // used throughout this file (hot cues, matrix history, prefs); no
      // server-side analytics infra exists here to log to instead.
      try {
        const prevCount = parseInt(
          localStorage.getItem(TAP_TEMPO_USAGE_KEY) || "0",
          10,
        );
        localStorage.setItem(
          TAP_TEMPO_USAGE_KEY,
          String((Number.isFinite(prevCount) ? prevCount : 0) + 1),
        );
      } catch {
        // localStorage unavailable — usage counting is best-effort, not
        // load-bearing for the tempo-apply itself.
      }

      fetch(`${UPLOAD_WORKER_URL}/tracks/${trackId}`, {
        method: "PATCH",
        headers: {
          "PSC-Secret": UPLOAD_SECRET,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ bpm_display: bpmStr }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`[PSC] tap-tempo PATCH ${res.status}`);
          const result = await res.json().catch(() => ({}));
          if (!result.success)
            throw new Error("[PSC] tap-tempo save: D1 returned success=false");
          announceStatus(`Tempo set: ${bpm} BPM (tap)`);
        })
        .catch((err) => {
          console.error("[PSC] tap-tempo save failed:", err);
          if (originalTrack) {
            setTrackListData((prev) =>
              prev.map((t) => (t.id === trackId ? originalTrack : t)),
            );
          }
          announceStatus("Tap-tempo save failed — check console for details.", "error");
        });
    },
    [deckTrack, trackListData],
  );

  const finalizeTapGesture = useCallback(() => {
    const taps = tapTimestampsRef.current;
    const bpm = computeTapTempoBpm(taps);
    if (bpm != null) {
      applyTapTempo(bpm);
    } else if (taps.length > 0) {
      setTapHintVisible(true);
      if (tapHintTimeoutRef.current) clearTimeout(tapHintTimeoutRef.current);
      tapHintTimeoutRef.current = setTimeout(() => setTapHintVisible(false), 1500);
    }
    tapTimestampsRef.current = [];
    setTapCount(0);
  }, [applyTapTempo]);

  const handleTap = useCallback(() => {
    if (!deckTrack) return;
    const now = performance.now();
    const taps = tapTimestampsRef.current;
    if (taps.length && now - taps[taps.length - 1] > TAP_IDLE_MS) {
      taps.length = 0; // prior gesture went stale — start a fresh one
    }
    taps.push(now);
    setTapCount(taps.length);
    setTapHintVisible(false);
    if (tapIdleTimeoutRef.current) clearTimeout(tapIdleTimeoutRef.current);
    tapIdleTimeoutRef.current = setTimeout(finalizeTapGesture, TAP_IDLE_MS);
  }, [deckTrack, finalizeTapGesture]);

  // Octave-error correction (plan D8): a one-click fix for the known DP
  // beat-tracker limitation where 90 BPM and 180 BPM fit the rhythm equally
  // well. detected_beat_offset does NOT need re-deriving — the originally
  // detected beat position is still a valid beat on the corrected grid
  // (halving/doubling just changes how many of the grid's beats "count").
  // manually_corrected marks this a terminal state, separate from
  // detected_bpm_confidence (kept an honest measurement, never overloaded
  // to also mean "a human intervened") — shouldShowOctaveControl checks it
  // directly so the button disappears and stays gone, rather than waiting
  // for confidence to cross the threshold again. Sequence-guarded (keyed by
  // track id, not a single global counter — a correction on one track must
  // never be discarded because a different track's correction fired more
  // recently) per eng review OV4: the higher-stakes sibling of the new
  // genre-cycle handler below (writes detected_bpm, which feeds real
  // quantize/loop-length math), so it gets the same protection.
  const handleOctaveCorrect = async (track, factor) => {
    const originalTrack = trackListData.find((t) => t.id === track.id);
    const newBpm = Math.round(track.detected_bpm * factor * 100) / 100;
    const seq = (octaveCorrectSeqRef.current[track.id] || 0) + 1;
    octaveCorrectSeqRef.current[track.id] = seq;

    setTrackListData((prev) =>
      prev.map((t) =>
        t.id === track.id ? { ...t, detected_bpm: newBpm, manually_corrected: true } : t,
      ),
    );

    try {
      const res = await fetch(`${UPLOAD_WORKER_URL}/tracks/${track.id}`, {
        method: "PATCH",
        headers: {
          "PSC-Secret": UPLOAD_SECRET,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ detected_bpm: newBpm, manually_corrected: true }),
      });
      if (seq !== octaveCorrectSeqRef.current[track.id]) return; // superseded — discard silently
      if (!res.ok) throw new Error(`[PSC] octave correct PATCH ${res.status}`);
      const result = await res.json().catch(() => ({}));
      if (!result.success) throw new Error("[PSC] octave correct: D1 returned success=false");
    } catch (err) {
      if (seq !== octaveCorrectSeqRef.current[track.id]) return; // stale — a newer correction already superseded this
      console.error("[PSC] octave correction failed:", err);
      setOctaveCorrectError((prev) => ({ ...prev, [track.id]: true }));
      setTimeout(
        () => setOctaveCorrectError((prev) => ({ ...prev, [track.id]: false })),
        400, // matches DESIGN.md's "long" motion timing for the error flash
      );
      if (originalTrack) {
        setTrackListData((prev) =>
          prev.map((t) => (t.id === track.id ? originalTrack : t)),
        );
      }
      announceStatus("Octave correction failed — check console for details.", "error");
    }
  };

  // Tempo-genre cycling (Dynamic Tempo Analysis) — DYNAMIC → BREAKBEAT →
  // HOUSE → TECHNO → DYNAMIC. Same optimistic-update + rollback shape as
  // handleOctaveCorrect, plus a per-track sequence guard: this is the first
  // control explicitly designed for rapid repeated firing (double-clicking
  // through all 4 values fires several PATCHes in quick succession), so an
  // out-of-order response must never silently overwrite the on-screen
  // (newer) value with a stale one.
  const GENRE_CYCLE_ORDER = ["DYNAMIC", "BREAKBEAT", "HOUSE", "TECHNO"];
  const handleGenreCycle = async (track) => {
    const originalTrack = trackListData.find((t) => t.id === track.id);
    const currentGenre = resolveTrackGenre(track, consoleDefaultGenre);
    const idx = GENRE_CYCLE_ORDER.indexOf(currentGenre);
    const nextGenre = GENRE_CYCLE_ORDER[(idx + 1) % GENRE_CYCLE_ORDER.length];
    const seq = (genreCycleSeqRef.current[track.id] || 0) + 1;
    genreCycleSeqRef.current[track.id] = seq;

    setTrackListData((prev) =>
      prev.map((t) => (t.id === track.id ? { ...t, tempo_genre: nextGenre } : t)),
    );

    try {
      const res = await fetch(`${UPLOAD_WORKER_URL}/tracks/${track.id}`, {
        method: "PATCH",
        headers: {
          "PSC-Secret": UPLOAD_SECRET,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tempo_genre: nextGenre }),
      });
      if (seq !== genreCycleSeqRef.current[track.id]) return; // superseded — discard silently
      if (!res.ok) throw new Error(`[PSC] genre cycle PATCH ${res.status}`);
      const result = await res.json().catch(() => ({}));
      if (!result.success) throw new Error("[PSC] genre cycle: D1 returned success=false");
    } catch (err) {
      if (seq !== genreCycleSeqRef.current[track.id]) return; // stale — a newer cycle already superseded this
      console.error("[PSC] genre cycle failed:", err);
      setGenreCycleError((prev) => ({ ...prev, [track.id]: true }));
      setTimeout(
        () => setGenreCycleError((prev) => ({ ...prev, [track.id]: false })),
        400,
      );
      if (originalTrack) {
        setTrackListData((prev) =>
          prev.map((t) => (t.id === track.id ? originalTrack : t)),
        );
      }
      announceStatus("Genre change failed — check console for details.", "error");
    }
  };

  // Pause-gated entry point for both mouse (double-click) and keyboard
  // (Enter/Space) activation of the genre badge — matches the beatgrid
  // anchor editor's precedent (DESIGN.md:351): the genre bucket feeds
  // shouldShowOctaveControl, so cycling genre mid-playback can make the
  // octave-correction button appear/disappear right under D's hand
  // mid-set. Not an audio-engine risk, but a live-performance mis-click
  // risk DESIGN.md already treats as worth guarding.
  const handleGenreBadgeActivate = (track) => {
    if (isPlaying) {
      announceStatus("Pause to change tempo genre", "info");
      return;
    }
    handleGenreCycle(track);
  };

  // Persists beatgrid anchor changes (drag/insert/keyboard-nudge, all fired
  // from DeckWaveformV2's onBeatGridPointsChange). Optimistic update with
  // rollback on PATCH failure — same pattern as handleOctaveCorrect and
  // handleEditSave. Per the interaction-state spec, the persisted position
  // itself is the success confirmation (no toast); rollback + a brief error
  // flash is the only visible feedback on failure.
  const handleBeatGridPointsChange = async (track, newPoints) => {
    const originalTrack = trackListData.find((t) => t.id === track.id);
    setTrackListData((prev) =>
      prev.map((t) =>
        t.id === track.id ? { ...t, beat_grid_points: newPoints } : t,
      ),
    );

    try {
      const res = await fetch(`${UPLOAD_WORKER_URL}/tracks/${track.id}`, {
        method: "PATCH",
        headers: {
          "PSC-Secret": UPLOAD_SECRET,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ beat_grid_points: newPoints }),
      });
      if (!res.ok) throw new Error(`[PSC] beatgrid PATCH ${res.status}`);
      const result = await res.json().catch(() => ({}));
      if (!result.success) throw new Error("[PSC] beatgrid save: D1 returned success=false");
    } catch (err) {
      console.error("[PSC] beatgrid save failed:", err);
      if (originalTrack) {
        setTrackListData((prev) =>
          prev.map((t) => (t.id === track.id ? originalTrack : t)),
        );
      }
      announceStatus("Beatgrid save failed — check console for details.", "error");
    }
  };

  const handleEditKeyDown = (e, trackId) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleEditSave(trackId);
    }
    if (e.key === "Escape") {
      setEditingTrackId(null);
      setEditingValues({});
    }
  };

  const pushTrackHistory = (track) => {
    if (!historyEnabled) return;
    setTrackHistory((prev) => {
      const next = [track.id, ...prev.filter((id) => id !== track.id)].slice(
        0,
        50,
      );
      return next;
    });
  };

  const handlePrepareSelected = () => {
    if (!selectedTrackId) {
      announce("Select a track before adding to prepare queue.");
      return;
    }
    setPrepareQueue((prev) =>
      prev.includes(selectedTrackId) ? prev : [...prev, selectedTrackId],
    );
    announce("Track added to prepare queue.");
  };

  const handleLoadDeck = () => {
    if (!selectedTrackId) {
      announce("Select a track before loading deck.");
      return;
    }
    const track = trackListData.find((t) => t.id === selectedTrackId);
    if (track) loadToDeck(track);
  };

  const handleNext = () => {
    if (!visibleTracks.length) return;
    const idx = loadedTrack
      ? visibleTracks.findIndex((t) => t.id === loadedTrack.id)
      : -1;
    const next = visibleTracks[idx + 1] ?? visibleTracks[0];
    loadAndPlay(next);
    announce(`Loading ${next.title || "next track"}.`);
  };

  const handlePrev = () => {
    if (!visibleTracks.length) return;
    const idx = loadedTrack
      ? visibleTracks.findIndex((t) => t.id === loadedTrack.id)
      : 0;
    const prev =
      visibleTracks[idx - 1] ?? visibleTracks[visibleTracks.length - 1];
    loadAndPlay(prev);
    announce(`Loading ${prev.title || "previous track"}.`);
  };

  const bankIndex = { A: 0, B: 1, C: 2, D: 3 }[activeCueBank];
  const bankLetters = ["A", "B", "C", "D"];

  // The single source of truth for "which cue is on which pad." Toggle off
  // reproduces the old fixed-slot behavior exactly; toggle on computes
  // position from time order, holding pinned (labeled) cues at their frozen
  // slot. Every pad-lookup below reads from this instead of hotCues directly.
  const activeTrackCuesRaw = loadedTrack ? hotCues[loadedTrack.id] || [] : [];
  const cuePositions = computeHotCuePositions(activeTrackCuesRaw, autoSortCues);

  const handleHotCueClick = (displayNum) => {
    if (!loadedTrack) {
      announce("Load a track before setting hot cues.");
      return;
    }
    const trackId = loadedTrack.id;
    const internalNum = bankIndex * 8 + displayNum;
    const existingCue = cuePositions[internalNum];

    if (existingCue) {
      // Jump to existing cue
      handleSeek(existingCue.time);
      announce(`Jumped to hot cue ${displayNum}.`);
    } else {
      // Set new cue at current time
      const time = quantizeEnabled
        ? quantizeToBeat(currentTime, () => resolveTrackBpm(loadedTrack))
        : currentTime;
      const trackCuesRaw = hotCues[trackId] || [];
      const newCue = {
        id: crypto.randomUUID(),
        time,
        label: "",
        pinned: false,
        slot: internalNum,
      };
      const updatedTrackCues = [...trackCuesRaw, newCue];
      const updated = { ...hotCues, [trackId]: updatedTrackCues };
      setHotCues(updated);
      localStorage.setItem("psc_hotcues", JSON.stringify(updated));

      if (autoSortCues) {
        // Auto-sort may not land the new cue on the pad that was clicked —
        // tell the DJ where it actually ended up.
        const newPositions = computeHotCuePositions(updatedTrackCues, true);
        const landedSlot = Object.entries(newPositions).find(
          ([, cue]) => cue.id === newCue.id,
        )?.[0];
        const landedBank = landedSlot
          ? bankLetters[Math.floor((landedSlot - 1) / 8)]
          : null;
        const landedDisplayNum = landedSlot ? ((landedSlot - 1) % 8) + 1 : null;
        announce(
          landedSlot
            ? `Cue set at ${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")} — now at pad ${landedBank}${landedDisplayNum}.`
            : `Hot cue set at ${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}.`,
        );
      } else {
        announce(
          `Hot cue ${displayNum} set at ${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}.`,
        );
        // Auto-cycle bank if all 8 cues filled — only meaningful in
        // fixed-slot (toggle-off) mode, where a bank is a real accumulation
        // target. In auto-sort mode this doesn't map onto a global
        // chronological list, so it's skipped there.
        const filledInBank = updatedTrackCues.filter(
          (c) => c.slot > bankIndex * 8 && c.slot <= bankIndex * 8 + 8,
        ).length;
        if (filledInBank === 8) {
          const nextBank = bankLetters[(bankIndex + 1) % 4];
          setActiveCueBank(nextBank);
          announce(`Bank full. Advanced to bank ${nextBank}.`);
        }
      }
    }
  };

  const clearHotCue = (displayNum, e) => {
    e.stopPropagation();
    if (!loadedTrack) return;
    const trackId = loadedTrack.id;
    const internalNum = bankIndex * 8 + displayNum;
    const cue = cuePositions[internalNum];
    if (!cue) return;

    const trackCuesRaw = hotCues[trackId] || [];
    const remaining = trackCuesRaw.filter((c) => c.id !== cue.id);
    const updated = { ...hotCues, [trackId]: remaining };
    setHotCues(updated);
    localStorage.setItem("psc_hotcues", JSON.stringify(updated));
    announce(`Hot cue ${displayNum} cleared.`);
  };

  // Loop enforcement — see startLoopEnforcement above for why this is
  // rAF-polled rather than driven by the "timeupdate" listener. Still not
  // sample-accurate (seek() and the loop-point itself aren't guaranteed
  // zero-crossing) — tracked as a follow-up for a true gapless engine.
  useEffect(() => {
    if (loopRegion.start === null || loopRegion.end === null) return;
    loopActiveRef.current = true;
    return startLoopEnforcement(loopRegion, loopActiveRef, audioEngine);
  }, [loopRegion]);

  const handleClearBankCues = () => {
    if (!loadedTrack) {
      announce(`No cues to clear in bank ${activeCueBank}.`);
      return;
    }

    const trackId = loadedTrack.id;
    const trackCuesRaw = hotCues[trackId] || [];
    const idsInBank = new Set(
      Array.from(
        { length: 8 },
        (_, i) => cuePositions[bankIndex * 8 + i + 1]?.id,
      ).filter(Boolean),
    );
    const hasChanges = idsInBank.size > 0;
    const remaining = trackCuesRaw.filter((c) => !idsInBank.has(c.id));

    if (hasChanges) {
      const updated = { ...hotCues, [trackId]: remaining };
      setHotCues(updated);
      localStorage.setItem("psc_hotcues", JSON.stringify(updated));
      announce(`Bank ${activeCueBank} cleared.`);
    } else {
      announce(`No cues in bank ${activeCueBank}.`);
    }
  };

  const handleClearLoop = () => {
    audioEngine.clearLoopRegion();
    setLoopRegion({ start: null, end: null });
    loopActiveRef.current = false;
    announce("Loop cleared.");
  };

  const resolveLoopBeats = (option) => {
    if (option.type === "bars") return (option.bars || 0) * 4;
    if (option.type === "beats") return option.beats || 0;
    let beats = 4 / option.denominator;
    if (option.dotted) beats *= 1.5;
    if (option.triplet) beats *= 2 / 3;
    return beats;
  };

  const handleApplyLoopLength = (option) => {
    if (!audioEngine.isLoaded() || !loadedTrack) return;
    // Position-aware, not resolveTrackBpm's single track-wide value — this
    // MUST resolve the same anchor/segment resolveDownbeatOffsetForQuantize
    // below picks (both mirror the identical "last anchor with time <=
    // timeSec" walk), or the loop-length math (beatSeconds) and the
    // downbeat-offset anchor come from different segments on a drift track,
    // silently mis-quantizing the loop start to a non-downbeat position.
    const bpm = resolveBpmAtTime(loadedTrack, currentTime);
    if (!bpm) {
      announce("BPM unavailable for loop length.");
      return;
    }
    const beats = resolveLoopBeats(option);
    if (!beats) return;
    const beatSeconds = 60 / bpm;
    const start = quantizeEnabled
      ? Math.max(0, quantizeToBeat(currentTime, () => bpm, resolveDownbeatOffsetForQuantize(loadedTrack, currentTime)))
      : currentTime;
    // Clamp to the track's own duration — a loop set near the tail whose
    // end exceeds duration would let the native "ended" event fire before
    // any boundary check gets a chance, silently abandoning the loop.
    // Latent in the enforcement mechanism since it first shipped, closed
    // here while already touching this function.
    const trackDuration = audioEngine.getState().duration;
    const end = trackDuration
      ? Math.min(start + beats * beatSeconds, trackDuration)
      : start + beats * beatSeconds;
    const region = { start, end };
    setLoopRegion(region);
    audioEngine.setLoopRegion(region);
    loopActiveRef.current = true;
    setSelectedLoopLengthId(option.id);
    announce(`Loop ${option.label}.`);
  };

  const filteredTracks = trackListData
    .filter((t) => t.vault === activeLibVault)
    .filter(
      (t) =>
        !libSearch ||
        t.title?.toLowerCase().includes(libSearch.toLowerCase()) ||
        t.artist?.toLowerCase().includes(libSearch.toLowerCase()),
    )
    .filter((t) =>
      publishFilter === "all"
        ? true
        : publishFilter === "staged"
          ? !t.is_published
          : Boolean(t.is_published),
    );

  const visibleTracks = [...filteredTracks].sort((a, b) => {
    if (smartCrates && loadedTrack) {
      const scoreDiff =
        smartCrateScore(b, loadedTrack) - smartCrateScore(a, loadedTrack);
      if (scoreDiff !== 0) return scoreDiff;
    }
    if (sortMode === "bpm-desc")
      return (resolveTrackBpm(b) || 0) - (resolveTrackBpm(a) || 0);
    if (sortMode === "bpm-asc")
      return (resolveTrackBpm(a) || 0) - (resolveTrackBpm(b) || 0);
    return (
      new Date(b.created_at || 0).getTime() -
      new Date(a.created_at || 0).getTime()
    );
  });

  const hasHotCuesForLoadedTrack = !!(
    loadedTrack && activeTrackCuesRaw.length
  );
  const hasCuesInCurrentBank = !!(
    loadedTrack &&
    Array.from(
      { length: 8 },
      (_, i) => cuePositions[bankIndex * 8 + i + 1],
    ).some(Boolean)
  );

  const selectionHasStaged = [...selectedTrackIds].some(
    (id) => !trackListData.find((t) => t.id === id)?.is_published,
  );
  const selectionHasLive = [...selectedTrackIds].some((id) =>
    Boolean(trackListData.find((t) => t.id === id)?.is_published),
  );

  const mixLoudness =
    deckTrack?.lufs_integrated ?? deckTrack?.lufs ?? deckTrack?.loudness_lufs;
  const mixPeak =
    deckTrack?.true_peak_dbtp ?? deckTrack?.peak_db ?? deckTrack?.peak;
  const mixRange =
    deckTrack?.dynamic_range ?? deckTrack?.dr ?? deckTrack?.crest_factor;

  const commandVaultId = activeVault || activeLibVault;

  const handleExplore = () => {
    if (!commandVaultId) return;
    onExplorePlanet?.(commandVaultId);
    announce(`Opening ${vaultLabel(commandVaultId)}.`);
  };

  const handleVoidProtocol = () => {
    if (!commandVaultId) return;
    setShowVoidConfirm(true);
    announce(
      `Void protocol confirmation opened for ${vaultLabel(commandVaultId)}.`,
    );
  };

  const handleRosterAdd = (e) => {
    e.preventDefault();
    if (!rosterName.trim()) return;
    const planet =
      rosterTier === "C"
        ? rosterMoon.trim()
          ? `${LOCKBOX_PREFIX}${rosterMoon.trim().toLowerCase()}`
          : null
        : rosterPlanet || null;
    const code = addMember(
      rosterName.trim(),
      planet,
      "L",
      rosterTier,
      rosterCode || null,
    );
    setRosterFlash({ name: rosterName.trim(), code });
    setRosterName("");
    setRosterPlanet("");
    setRosterMoon("");
    setRosterCode("");
    setRosterTier("B");
    setRosterShowAdd(false);
    announce(`${rosterName.trim()} added to roster with tier ${rosterTier}.`);
  };
  const handleMatrixToggle = (memberId, perm) => {
    if (!matrixArmed) return;
    const member = members.find((m) => m.id === memberId);
    if (!member) return;
    const tierDefaults = tierDefaultsForMember(member.tier);
    const current = resolveMatrixPerm({
      pendingEntry: matrixPending[memberId],
      committedEntry: matrixCommitted[memberId],
      tierDefaults,
      perm,
    });
    const nextValue = !current;
    announce(
      `${member.name || "Member"} ${perm} permission ${nextValue ? "enabled" : "disabled"} (pending).`,
    );
    setMatrixPending((prev) => {
      return toggleMatrixPerm({
        pending: prev,
        committed: matrixCommitted,
        memberId,
        perm,
        tierDefaults,
      });
    });
  };

  const handleMatrixArm = () => {
    setMatrixArmed(true);
    announce("Matrix armed. Permission cells unlocked.");
  };

  const handleMatrixCommit = () => {
    const pendingCount = Object.keys(matrixPending).length;
    const nextState = commitMatrixState({
      history: matrixHistory,
      committed: matrixCommitted,
      pending: matrixPending,
    });
    setMatrixHistory(nextState.history);
    setMatrixCommitted(nextState.committed);
    setMatrixPending(nextState.pending);
    setMatrixArmed(false);
    announce(
      `Matrix committed. ${pendingCount} member ${pendingCount === 1 ? "change" : "changes"} applied.`,
    );
  };

  const handleMatrixDisarm = () => {
    setMatrixPending({});
    setMatrixArmed(false);
    announce("Matrix disarmed. Pending changes cleared.");
  };

  const handleMatrixRollback = () => {
    const nextState = rollbackMatrixState({ history: matrixHistory });
    if (!nextState.didRollback) {
      announce("No rollback snapshot available.");
      return;
    }
    setMatrixCommitted(nextState.committed);
    setMatrixHistory(nextState.history);
    setMatrixPending({});
    setMatrixArmed(false);
    announce("Matrix rolled back to previous committed state.");
  };

  // Effective permission for a member in the matrix (committed overrides tier defaults)
  const matrixPerm = (memberId, perm, tierDefault) => {
    return resolveMatrixPerm({
      pendingEntry: matrixPending[memberId],
      committedEntry: matrixCommitted[memberId],
      tierDefaults: { [perm]: tierDefault },
      perm,
    });
  };

  const confirmVoidProtocol = () => {
    if (!activeVault) return;
    const record = {
      id: `protocol-${Date.now()}`,
      label: `${vaultLabel(activeVault)} PROTOCOL`,
      name: `${vaultLabel(activeVault)} PROTOCOL`,
      metadata: { type: "void-protocol" },
    };
    voidItem(record, activeVault);
    setShowArchive(true);
    setShowVoidConfirm(false);
    announce(`${vaultLabel(activeVault)} protocol moved to archive log.`);
  };

  const handlePowerDown = () => {
    setShowPowerConfirm(true);
    announce("Power down confirmation opened.");
  };

  const handleExitToVaultView = () => {
    setShowPowerConfirm(false);
    if (!commandVaultId) {
      announce("No vault selected.");
      return;
    }
    onExplorePlanet?.(commandVaultId);
    announce(`Opening ${vaultLabel(commandVaultId)}.`);
  };

  const confirmPowerDown = () => {
    announce("Powering down Architect terminal.");
    onPowerDown?.();
  };

  useEffect(() => {
    const onEscape = (event) => {
      if (event.key !== "Escape") return;
      if (showPowerConfirm) {
        setShowPowerConfirm(false);
        announce("Power down confirmation dismissed.");
        return;
      }
      if (showVoidConfirm) {
        setShowVoidConfirm(false);
        announce("Void protocol confirmation dismissed.");
        return;
      }
      if (showArchive) {
        setShowArchive(false);
        announce("Archive log closed.");
        return;
      }
      if (showInbox) {
        setShowInbox(false);
        announce("Vetting inbox closed.");
        return;
      }
      if (showMatrix) {
        setShowMatrix(false);
        announce("Command matrix closed.");
        return;
      }
      if (showRoster) {
        setShowRoster(false);
        announce("Roster closed.");
        return;
      }
      if (showTrackList) {
        setShowTrackList(false);
        announce("Track registry closed.");
        return;
      }
      if (showSettings) {
        setShowSettings(false);
        announce("Settings closed.");
        return;
      }
      if (showAccessCodes) {
        setShowAccessCodes(false);
        announce("Access codes closed.");
      }
    };

    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [
    showAccessCodes,
    showArchive,
    showInbox,
    showMatrix,
    showPowerConfirm,
    showRoster,
    showSettings,
    showTrackList,
    showVoidConfirm,
  ]);

  // Sync latest values into kbRef so the keyboard handler never goes stale
  kbRef.current = {
    editingTrackId,
    editingCueNum,
    currentTime,
    audioDuration,
    handlePlayPause,
    handleLoadDeck,
    handleCue,
    handleHotCueClick,
    handleSeek,
    setShowShortcuts,
    stepZoom,
    waveformHoveredRef,
    overviewHoveredRef,
    stepOverviewStyle,
    loadedTrackBpm: resolveTrackBpm(loadedTrack),
  };

  // Performance keyboard shortcuts — registered once, reads live values via kbRef
  useEffect(() => {
    const onKey = (e) => {
      const kb = kbRef.current;
      if (kb.editingTrackId || kb.editingCueNum) return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      // ? — toggle shortcut legend
      if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        kb.setShowShortcuts((v) => !v);
        return;
      }
      if (e.code === "Space" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        kb.handlePlayPause();
        return;
      }
      if (e.code === "KeyL" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        kb.handleLoadDeck();
        return;
      }
      if (e.code === "Backquote" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        kb.handleCue();
        return;
      }
      const digit = e.code.match(/^Digit([1-8])$/)?.[1];
      if (digit && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        kb.handleHotCueClick(parseInt(digit, 10));
        return;
      }
      if (e.code === "ArrowLeft" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const beatSec = kb.loadedTrackBpm ? 60 / kb.loadedTrackBpm : 0.5;
        kb.handleSeek(Math.max(0, kb.currentTime - beatSec));
        return;
      }
      if (e.code === "ArrowRight" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const beatSec = kb.loadedTrackBpm ? 60 / kb.loadedTrackBpm : 0.5;
        kb.handleSeek(Math.min(kb.audioDuration, kb.currentTime + beatSec));
        return;
      }
      if (e.code === "ArrowUp" && !e.ctrlKey && !e.metaKey) {
        if (kb.overviewHoveredRef.current) {
          e.preventDefault();
          kb.stepOverviewStyle(+1);
        } else if (kb.waveformHoveredRef.current) {
          e.preventDefault();
          kb.stepZoom(+1);
        }
        return;
      }
      if (e.code === "ArrowDown" && !e.ctrlKey && !e.metaKey) {
        if (kb.overviewHoveredRef.current) {
          e.preventDefault();
          kb.stepOverviewStyle(-1);
        } else if (kb.waveformHoveredRef.current) {
          e.preventDefault();
          kb.stepZoom(-1);
        }
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Full-width track overview strip — three switchable render modes
  useEffect(() => {
    const canvas = overviewRef.current;
    if (!canvas) return;
    const bars = deckWaveformHighData;
    const OVERVIEW_H = 32;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.getBoundingClientRect().width || 800;
    canvas.width  = Math.round(w * dpr);
    canvas.height = Math.round(OVERVIEW_H * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    // Black base — required for screen composite
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, OVERVIEW_H);

    if (!bars || bars.length === 0 || !audioDuration || bars[0]?.bass === undefined) {
      // Hot cues + playhead even with no data
    } else {
      const N = bars.length;

      // Precompute per-pixel best bar (used by all three modes)
      const best = new Array(Math.ceil(w));
      const barsPerPx = N / w;
      for (let px = 0; px < w; px++) {
        const bStart = Math.floor(px * barsPerPx);
        const bEnd   = Math.min(Math.ceil((px + 1) * barsPerPx) + 1, N);
        let maxPeak = 0, b = null;
        for (let i = bStart; i < bEnd; i++) {
          if (bars[i] && bars[i].peak > maxPeak) { maxPeak = bars[i].peak; b = bars[i]; }
        }
        best[px] = b;
      }

      ctx.globalCompositeOperation = "screen";

      if (overviewStyle === 0) {
        // ── LAYERS: three filled silhouettes stacked from bottom, screen blend ──
        // Each band fills from the bottom up to its amplitude height.
        // Where all three overlap the bottom → white. Top edge → pure cyan (high).
        for (let px = 0; px < w; px++) {
          const d = best[px]; if (!d) continue;
          const bassH = Math.max(1, Math.round(d.bass * (OVERVIEW_H - 1)));
          const midH  = Math.max(1, Math.round(d.mid  * (OVERVIEW_H - 1)));
          const highH = Math.max(1, Math.round(d.high * (OVERVIEW_H - 1)));
          ctx.fillStyle = "rgba(255,0,0,0.85)";
          ctx.fillRect(px, OVERVIEW_H - bassH, 1, bassH);
          ctx.fillStyle = "rgba(0,255,0,0.85)";
          ctx.fillRect(px, OVERVIEW_H - midH,  1, midH);
          ctx.fillStyle = "rgba(0,255,255,0.85)";
          ctx.fillRect(px, OVERVIEW_H - highH, 1, highH);
        }

      } else if (overviewStyle === 1) {
        // ── OUTLINE: top outline arc per band, screen blend — top half of main wf ──
        const drawOutline = (getAmp, color) => {
          ctx.beginPath();
          let first = true;
          for (let px = 0; px < w; px++) {
            const d = best[px]; if (!d) continue;
            const y = OVERVIEW_H - Math.max(2, Math.round(getAmp(d) * (OVERVIEW_H - 2)));
            if (first) { ctx.moveTo(px, y); first = false; }
            else ctx.lineTo(px, y);
          }
          ctx.strokeStyle = color;
          ctx.lineWidth   = 1.5;
          ctx.stroke();
        };
        drawOutline(d => d.bass, "rgba(255,0,0,0.85)");
        drawOutline(d => d.mid,  "rgba(0,255,0,0.85)");
        drawOutline(d => d.high, "rgba(0,255,255,0.85)");

      } else {
        // ── TRACES: three oscilloscope lines, full-height, screen blend at crossings ──
        const drawTrace = (getAmp, color) => {
          ctx.beginPath();
          let first = true;
          for (let px = 0; px < w; px++) {
            const d = best[px]; if (!d) continue;
            const y = OVERVIEW_H - 1 - Math.round(getAmp(d) * (OVERVIEW_H - 3));
            if (first) { ctx.moveTo(px, y); first = false; }
            else ctx.lineTo(px, y);
          }
          ctx.strokeStyle = color;
          ctx.lineWidth   = 1.5;
          ctx.stroke();
        };
        drawTrace(d => d.bass, "rgba(255,0,0,0.9)");
        drawTrace(d => d.mid,  "rgba(0,255,0,0.9)");
        drawTrace(d => d.high, "rgba(0,255,255,0.9)");
      }

      ctx.globalCompositeOperation = "source-over";
    }

    // Hot cue pins
    const deckCuesRaw = deckTrack ? hotCues[deckTrack.id] || [] : [];
    const deckCuePositions = computeHotCuePositions(deckCuesRaw, autoSortCues);
    Object.entries(deckCuePositions).forEach(([num, cue]) => {
      if (!cue || typeof cue.time !== "number") return;
      const cx = Math.round((cue.time / audioDuration) * w);
      ctx.fillStyle = ALL_CUE_COLORS[parseInt(num, 10) - 1] || "rgba(255,255,255,0.7)";
      ctx.fillRect(cx, 0, 1, OVERVIEW_H);
    });

    // Playhead
    const playheadPx = Math.round((currentTime / audioDuration) * w);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillRect(playheadPx, 0, 2, OVERVIEW_H);
  }, [deckWaveformHighData, currentTime, audioDuration, hotCues, autoSortCues, deckTrack, overviewStyle]);

  const isD = viewer === "D";
  const envelopeIdentityColor = isD ? "#14dc14" : "#00e5ff";

  // Beat-detect (onset-envelope) row visibility — decoupled from waveform
  // hover on purpose (hover already controls zoom via waveformHoveredRef;
  // reusing the same gesture for two different things was the bug this
  // toggle exists to fix). Default OFF so the deck starts collapsed.
  const [beatDetectVisible, setBeatDetectVisible] = useState(false);

  // T11 — recompute the onset envelope once per track load (not per hover —
  // onsetEnvelope is O(n) but wasteful re-run dozens of times/sec while
  // scrubbing), cached keyed by track id so a fast deck switch can't render
  // a stale envelope under the new track's hover.
  useEffect(() => {
    if (!deckTrack || !deckWaveformHighData || deckWaveformHighData.length === 0) {
      envelopeCacheRef.current = { trackId: null, envelope: null };
    } else if (envelopeCacheRef.current.trackId !== deckTrack.id) {
      envelopeCacheRef.current = {
        trackId: deckTrack.id,
        envelope: onsetEnvelope(deckWaveformHighData),
      };
    }
    drawEnvelopeRow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckTrack?.id, deckWaveformHighData]);

  // ENVELOPE_BARS_PER_SEC matches analyzeAudio's barsPerSec (see
  // beatDetector.js's frameRate default / waveformAnalyzer.js's
  // BEAT_DETECTOR_FRAME_RATE) — this file already assumes 50 bars/sec
  // elsewhere (zoom-window math above) without a shared named constant.
  const ENVELOPE_BARS_PER_SEC = 50;
  const ENVELOPE_ROW_H = 24;

  function drawEnvelopeRow() {
    const canvas = envelopeCanvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.getBoundingClientRect().width || 800;
    const ctx = canvas.getContext("2d");
    const prevSize = envelopeCanvasSizeRef.current;
    if (prevSize.w !== w || prevSize.dpr !== dpr) {
      // Only touch the backing store on a genuine size change (mount,
      // window resize) — reassigning canvas.width/height resets the whole
      // bitmap and context transform even when the value is unchanged.
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(ENVELOPE_ROW_H * dpr);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      envelopeCanvasSizeRef.current = { w, dpr };
    }
    ctx.clearRect(0, 0, w, ENVELOPE_ROW_H);

    const drawHint = (text) => {
      ctx.font = "8px 'JetBrains Mono', monospace";
      ctx.fillStyle = "rgba(240,237,232,0.32)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, w / 2, ENVELOPE_ROW_H / 2);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    };

    const hoverTime = envelopeHoverRef.current;
    if (hoverTime == null || !deckTrack) {
      drawHint("HOVER WAVEFORM TO INSPECT ENVELOPE");
      return;
    }

    const { envelope, trackId } = envelopeCacheRef.current;
    const bpm = resolveTrackBpm(deckTrack) ?? deckTrack.detected_bpm ?? null;
    if (!envelope || envelope.length === 0 || trackId !== deckTrack.id || !bpm) {
      drawHint("ENVELOPE UNAVAILABLE");
      return;
    }

    const win = computeEnvelopeWindow({
      hoverTime,
      bpm,
      envelopeLength: envelope.length,
      barsPerSec: ENVELOPE_BARS_PER_SEC,
    });
    if (!win) {
      drawHint("ENVELOPE UNAVAILABLE");
      return;
    }
    const { startBar, endBar, cursorFrac } = win;
    const slice = envelope.slice(startBar, endBar);

    const localMax = Math.max(...slice, 0.0001);
    const barW = w / slice.length;
    ctx.fillStyle = envelopeIdentityColor;
    ctx.globalAlpha = 0.6;
    for (let i = 0; i < slice.length; i++) {
      const barH = (slice[i] / localMax) * (ENVELOPE_ROW_H - 6);
      ctx.fillRect(i * barW, ENVELOPE_ROW_H - barH, Math.max(1, barW - 0.5), barH);
    }
    ctx.globalAlpha = 1;

    // Cursor marker — meaning conveyed by position, not color (matches the
    // main waveform's playhead: rgba(255,255,255,0.9), no glow, precise).
    const cursorX = cursorFrac * w;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cursorX, 0);
    ctx.lineTo(cursorX, ENVELOPE_ROW_H);
    ctx.stroke();
  }

  const handleEnvelopeHover = (time) => {
    // Skip the redraw entirely while collapsed — otherwise this fires on
    // every mousemove into a 0-height, invisible canvas whenever BEAT is
    // off (the default state).
    if (!beatDetectVisible) return;
    envelopeHoverRef.current = time;
    drawEnvelopeRow();
  };

  const handleBeatToggle = () => {
    setBeatDetectVisible((v) => {
      const next = !v;
      // Flipping state alone doesn't repaint the canvas — drawEnvelopeRow()
      // only runs from hover or track-load. Draw immediately on turning on,
      // so the row shows the idle hint right away instead of stale/blank
      // content until the next hover.
      if (next) drawEnvelopeRow();
      return next;
    });
  };

  return (
    <motion.div
      className={`architect-console${isD ? " architect-console--d" : " architect-console--l"}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1.8, ease: [0.05, 0.9, 0.2, 1] }}
    >
      <div className="arch-grain-layer" />
      <PSCWordmark
        onToggle={() => setRailOpen((v) => !v)}
        railOpen={railOpen}
      />
      <div className="arch-cursor-ball" ref={cursorRef} aria-hidden="true" />
      <div
        style={SR_ONLY_STYLE}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {liveAnnouncement}
      </div>

      {/* ── TOP RAIL ─────────────────────────────────────────────────── */}
      <header
        className={`arch-top-rail${isBroadcasting ? " is-broadcasting" : ""}`}
      >
        <div className="arch-top-identity">
          <span className="arch-top-dot" />
          <span className="arch-top-name">
            {viewer === "D" ? "D · GOD MODE" : "L · GOD MODE PLUS"}
          </span>
        </div>

        <nav className="arch-top-actions" aria-label="Architect controls">
          <button
            className={`arch-signal-btn ${isBroadcasting ? "is-live" : ""}`}
            onClick={handleBroadcast}
            aria-label="THE SIGNAL — go live"
          >
            <span className="arch-signal-dot">●</span> SIGNAL
          </button>

          <button
            className="arch-rail-btn arch-exit-btn"
            onClick={handlePowerDown}
          >
            EXIT
          </button>
        </nav>
      </header>

      {/* ── DECK ZONE ────────────────────────────────────────────────── */}
      <section className="arch-deck-zone" aria-label="Deck">
        <div className="arch-deck-meta">
          <div className="arch-deck-title">
            {deckTrack ? deckTrack.title : "NO TRACK LOADED"}
          </div>
          <div className="arch-deck-artist">
            {deckTrack
              ? deckTrack.artist || "METADATA READY"
              : "SELECT A TRACK"}
          </div>
          <div className="arch-deck-stats">
            {deckTrack && (() => {
              const zones = resolveBeatgridZones(deckTrack);
              const genre = resolveTrackGenre(deckTrack, consoleDefaultGenre);
              const bucket = bucketForGenre(genre);
              if (hasCompleteManualBpm(deckTrack)) return null;
              if (zones) return <ZonesBadge zones={zones} />;
              if (deckTrack.detected_bpm == null) return null;
              return (
                <>
                  <ConfBadge confidence={deckTrack.detected_bpm_confidence} genreBucket={bucket} />
                  {shouldShowOctaveControl(deckTrack, bucket) && (
                    <span className="arch-octave-controls">
                      <button
                        type="button"
                        aria-label="Halve detected BPM (octave correction)"
                        className={`god-btn arch-octave-btn ${octaveCorrectError[deckTrack.id] ? "arch-octave-error" : ""}`}
                        onClick={() => handleOctaveCorrect(deckTrack, 0.5)}
                        title="Halve detected BPM (octave correction)"
                      >
                        ½×
                      </button>
                      <button
                        type="button"
                        aria-label="Double detected BPM (octave correction)"
                        className={`god-btn arch-octave-btn ${octaveCorrectError[deckTrack.id] ? "arch-octave-error" : ""}`}
                        onClick={() => handleOctaveCorrect(deckTrack, 2)}
                        title="Double detected BPM (octave correction)"
                      >
                        2×
                      </button>
                    </span>
                  )}
                </>
              );
            })()}
            <span className="arch-stat">
              BPM{" "}
              {deckTrack ? (
                (() => {
                  const raw = deckTrack.bpm ? Math.round(deckTrack.bpm) : null;
                  const display = cleanBpm(deckTrack.bpm_display);
                  const showBoth = display && raw && String(raw) !== display;
                  return (
                    <>
                      <strong style={{ color: "var(--accent-green, #00cc66)" }}>
                        {raw ?? "--"}
                      </strong>
                      {showBoth && (
                        <span
                          style={{
                            color: "rgba(240,237,232,0.7)",
                            marginLeft: 4,
                            fontWeight: 500,
                          }}
                        >
                          {display}
                        </span>
                      )}
                    </>
                  );
                })()
              ) : (
                <strong>--</strong>
              )}
            </span>
            {deckTrack && (
              <DynamicGenreBadge
                genre={resolveTrackGenre(deckTrack, consoleDefaultGenre)}
                liveBpm={liveBpm}
                isPlaying={isPlaying}
                dimmed={Boolean(resolveBeatgridZones(deckTrack))}
                onActivate={() => handleGenreBadgeActivate(deckTrack)}
              />
            )}
            {deckTrack && (
              <button
                type="button"
                className={`god-btn arch-tap-tempo-btn${tapCount > 0 ? " arch-tap-tempo-btn--active" : ""}`}
                onClick={handleTap}
                aria-label="Tap tempo — click on the beat to set BPM manually"
              >
                {tapCount > 0 ? `TAP · ${tapCount}` : "TAP"}
              </button>
            )}
            {tapHintVisible && (
              <span className="arch-stat arch-tap-hint">keep tapping…</span>
            )}
            <button
              type="button"
              className={`god-btn arch-beat-toggle-btn${beatDetectVisible ? " active" : ""}`}
              onClick={handleBeatToggle}
              disabled={!deckTrack}
              aria-pressed={beatDetectVisible}
              title="Show/hide beat-detection readout"
            >
              BEAT
            </button>
            <span
              className={`arch-stat arch-elapsed${isPlaying ? " arch-elapsed--playing" : ""}`}
            >
              {formatTime(deckCanSeek ? currentTime : 0)}
            </span>
            <span className="arch-stat-sep">/</span>
            <span className="arch-stat arch-remaining">
              {deckCanSeek
                ? `-${formatTime(audioDuration - currentTime)}`
                : "READY"}
            </span>
            {audioLoading && (
              <span className="arch-stat arch-loading-tag">LOADING…</span>
            )}
            {audioError && (
              <span className="arch-stat arch-error-tag" title={audioError}>
                ERR
              </span>
            )}
          </div>
        </div>

        {/* Full-width track overview strip */}
        <div
          className="arch-overview-row"
          aria-hidden="true"
          title="Click to seek. Hover here and press ↑↓ to cycle overview render style (LAYERS/OUTLINE/TRACES)."
          style={{ position: "relative" }}
          onMouseEnter={() => { overviewHoveredRef.current = true; }}
          onMouseLeave={() => { overviewHoveredRef.current = false; }}
        >
          <canvas
            ref={overviewRef}
            className="arch-overview-strip"
            onClick={deckCanSeek ? (e) => {
              const rect = overviewRef.current.getBoundingClientRect();
              handleSeek(((e.clientX - rect.left) / rect.width) * audioDuration);
            } : undefined}
            style={{ cursor: deckCanSeek ? "pointer" : "default" }}
          />
          <span style={{
            position: "absolute", top: 2, right: 6,
            fontSize: "8px", letterSpacing: "0.12em",
            color: "rgba(255,255,255,0.5)", pointerEvents: "none",
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            {OVERVIEW_STYLES[overviewStyle]} ↑↓
          </span>
        </div>

        {/* Waveform row — full width (VU moved to analyzer row) */}
        <div className="arch-waveform-row" aria-hidden="true">
          <div className="arch-waveform-col">
            <div
              className="arch-waveform-main"
              title="Hover here and press ↑↓ to zoom the waveform in/out"
              onMouseEnter={() => {
                waveformHoveredRef.current = true;
              }}
              onMouseLeave={() => {
                waveformHoveredRef.current = false;
              }}
            >
              {deckTrack && deckHighResBars && (
                <div
                  style={{
                    position: "absolute",
                    top: 4,
                    right: 6,
                    zIndex: 1,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: "0.45rem",
                    letterSpacing: "0.08em",
                    color: "rgba(255,255,255,0.22)",
                    pointerEvents: "none",
                    userSelect: "none",
                  }}
                >
                  {Math.round(deckHighResBars.length / (waveformZoom * 50))}s ↑↓
                </div>
              )}
              {!deckTrack ? (
                <div className="arch-deck-empty-state">SELECT A TRACK</div>
              ) : (
                <DeckWaveform
                  waveformData={deckWaveformHighData}
                  currentTime={
                    loadedTrack?.id === deckTrack?.id ? currentTime : 0
                  }
                  duration={
                    loadedTrack?.id === deckTrack?.id && audioDuration > 0
                      ? audioDuration
                      : deckTrack.duration || 1
                  }
                  onSeek={deckCanSeek ? handleSeek : null}
                  trackId={deckTrack.id}
                  width={800}
                  height={200}
                  hotCues={computeHotCuePositions(hotCues[deckTrack.id] || [], autoSortCues)}
                  cueColors={ALL_CUE_COLORS}
                  zoom={waveformZoom}
                  loopRegion={loopRegion}
                  isGenerating={deckIsGenerating}
                  generatingPct={waveformProgress[deckTrack.id] ?? null}
                  bpm={resolveTrackBpm(deckTrack)}
                  getTime={loadedTrack?.id === deckTrack?.id ? () => audioEngine.getState().currentTime : null}
                  getIsPlaying={loadedTrack?.id === deckTrack?.id ? () => audioEngine.getState().isPlaying : null}
                  getAudioLatency={loadedTrack?.id === deckTrack?.id ? () => { const ctx = audioEngine.getAudioContext(); return ctx ? (ctx.outputLatency || 0) + (ctx.baseLatency || 0) : 0; } : null}
                  beatGridPoints={parseBeatGridPoints(deckTrack.beat_grid_points)}
                  onBeatGridPointsChange={(pts) => handleBeatGridPointsChange(deckTrack, pts)}
                  identityColor={envelopeIdentityColor}
                  onHoverTime={handleEnvelopeHover}
                />
              )}
            </div>
          </div>
        </div>

        {/* T11 — onset-envelope explainability row. Collapses to 0 height
            when BEAT is off (default); the BEAT toggle in the BPM row
            controls visibility, not waveform hover. */}
        <div
          className={`arch-envelope-row${beatDetectVisible ? " arch-envelope-row--open" : ""}`}
          aria-hidden="true"
        >
          <canvas
            ref={envelopeCanvasRef}
            className="arch-envelope-canvas"
            aria-label="Onset envelope — hover the waveform to inspect detected beat onsets"
          />
        </div>

        {/* Analyzer row — VU L+R (left) + Spectrum Analyzer (center) + Phase Correlation (right) */}
        <div className="arch-analyzer-row" aria-hidden="true">
          <div className="arch-vu-col">
            <canvas ref={vuRef} className="arch-vu-deck arch-vu-deck--l" aria-label="Left channel VU meter (bass frequencies)" />
            <canvas ref={vuRRef} className="arch-vu-deck arch-vu-deck--r" aria-label="Right channel VU meter (high frequencies)" />
          </div>
          <div className="arch-sa-col">
            <canvas ref={specRef} className="arch-spectrum-deck" aria-label="Spectrum analyzer (frequency distribution)" />
          </div>
        </div>
      </section>

      {/* ── TRANSPORT BAR ───────────────────────────────────────────── */}
      <div
        className="arch-transport"
        role="toolbar"
        aria-label="Transport controls"
      >
        {/* Left: hot cues (Serato standard position) */}
        <div className="arch-transport-left">
          <div
            className="arch-hotcues-cluster"
            role="group"
            aria-label="Hot cues"
          >
            <div className="arch-bank-selector-wrap">
              <span className="arch-cue-tag">BANK</span>
              <div className="arch-cue-bank-selector">
                {["A", "B", "C", "D"].map((bank) => {
                  const bIdx = { A: 0, B: 1, C: 2, D: 3 }[bank];
                  const bankOccupancy = Array.from(
                    { length: 8 },
                    (_, i) => !!cuePositions[bIdx * 8 + i + 1],
                  );
                  return (
                    <button
                      key={bank}
                      className={`arch-bank-btn${activeCueBank === bank ? " active" : ""}`}
                      onClick={() => setActiveCueBank(bank)}
                      aria-label={`Switch to cue bank ${bank}`}
                      aria-pressed={activeCueBank === bank}
                      title={`Bank ${bank} — 8 cue slots (dots = occupied)`}
                    >
                      {bank}
                      <span className="arch-bank-dots" aria-hidden="true">
                        {bankOccupancy.map((occupied, i) => (
                          <span
                            key={i}
                            className={`arch-bank-dot${occupied ? " occupied" : ""}`}
                            style={
                              occupied
                                ? { background: ALL_CUE_COLORS[bIdx * 8 + i] }
                                : undefined
                            }
                          />
                        ))}
                      </span>
                    </button>
                  );
                })}
              </div>
              <button
                className="arch-clr-bank-btn"
                disabled={!hasCuesInCurrentBank}
                onClick={handleClearBankCues}
                title={`Clear all hot cues in bank ${activeCueBank}`}
              >
                CLR
              </button>
              <button
                className={`arch-cue-sort-btn${autoSortCues ? " active" : ""}`}
                onClick={() => setAutoSortCues((v) => !v)}
                aria-pressed={autoSortCues}
                title={
                  autoSortCues
                    ? "Cues auto-sort chronologically across all 32 pads (labeled cues stay pinned). Click to turn off."
                    : "Cues stay on the pad they were set on. Click to turn on chronological auto-sort."
                }
              >
                SORT {autoSortCues ? "ON" : "OFF"}
              </button>
            </div>
            <div
              className={`arch-hotcues arch-hotcues--${activeCueBank}`}
              role="group"
              aria-label={`Hot cues bank ${activeCueBank}`}
            >
              {Array.from({ length: 8 }, (_, i) => i + 1).map((displayNum) => {
                const internalNum = bankIndex * 8 + displayNum;
                const cue = cuePositions[internalNum];
                const color = ALL_CUE_COLORS[internalNum - 1];
                const isEditing = editingCueNum === internalNum;

                // Every bank renames on double-click now (matches what D-bank
                // already did) — the old double-click-twice clear-confirm
                // gesture on A/B/C is dropped as fully redundant with the
                // always-visible × clear button.
                const handleDblClick = (e) => {
                  e.stopPropagation();
                  if (!cue) return;
                  setEditingCueNum(internalNum);
                  setEditingCueLabel(cue.label || "");
                };

                const saveCueLabel = () => {
                  if (!loadedTrack || !cue) return;
                  const trackId = loadedTrack.id;
                  const trimmed = editingCueLabel.trim();
                  const trackCuesRaw = hotCues[trackId] || [];
                  const updatedTrackCues = trackCuesRaw.map((c) =>
                    c.id === cue.id
                      ? {
                          ...c,
                          label: trimmed,
                          pinned: !!trimmed,
                          // Freeze at (or release from) the pad currently
                          // showing this cue — pinning locks it here,
                          // un-pinning lets it rejoin the sort next render.
                          slot: internalNum,
                        }
                      : c,
                  );
                  const updated = { ...hotCues, [trackId]: updatedTrackCues };
                  setHotCues(updated);
                  try {
                    localStorage.setItem(
                      "psc_hotcues",
                      JSON.stringify(updated),
                    );
                  } catch (_) {}
                  setEditingCueNum(null);
                };

                return (
                  <button
                    key={displayNum}
                    className={`arch-hotcue${cue ? " has-cue" : ""}`}
                    aria-label={
                      cue
                        ? `Cue ${activeCueBank}${displayNum}${cue.label ? ` — ${cue.label}` : ""} — double-click to name, click to jump`
                        : `Hot cue ${activeCueBank}${displayNum} — empty`
                    }
                    title={
                      cue
                        ? `${activeCueBank}${displayNum}${cue.label ? `: ${cue.label}` : ""} at ${cue.time?.toFixed(1)}s — click to jump`
                        : `${activeCueBank}${displayNum} — click while playing to set`
                    }
                    onClick={() => handleHotCueClick(displayNum)}
                    onDoubleClick={handleDblClick}
                    style={{ "--cue-color": color }}
                  >
                    {cue && !isEditing && (
                      <span
                        className="arch-hotcue-clear"
                        role="button"
                        aria-label={`Clear hot cue ${displayNum}`}
                        onClick={(e) => clearHotCue(displayNum, e)}
                      >
                        ×
                      </span>
                    )}
                    {isEditing ? (
                      <input
                        className="arch-hotcue-input"
                        autoFocus
                        value={editingCueLabel}
                        maxLength={6}
                        onChange={(e) =>
                          setEditingCueLabel(e.target.value.toUpperCase())
                        }
                        onBlur={saveCueLabel}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveCueLabel();
                          if (e.key === "Escape") setEditingCueNum(null);
                          e.stopPropagation();
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <>
                        <CueBankGlyph bank={activeCueBank} />
                        {cue?.label && (
                          <span className="arch-hotcue-label">{cue.label}</span>
                        )}
                        <span className="arch-hotcue-hint" aria-hidden="true">
                          DOUBLE-CLICK TO EDIT
                        </span>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Center: playback controls */}
        <div
          className="arch-transport-cluster"
          role="group"
          aria-label="Playback"
        >
          <button
            className="arch-transport-btn arch-bar-skip-btn"
            aria-label="Skip back (1 tap: 4 bars, 2 taps: 8 bars)"
            title="1 tap: −4 bars · 2 taps: −8 bars"
            onClick={() => handleBarSkip(-1)}
            disabled={!audioEngine.isLoaded()}
          >
            ◄◄
          </button>
          <button
            className={`arch-transport-btn arch-play-btn${isPlaying ? " active" : ""}${audioLoading ? " loading" : ""}`}
            aria-label={isPlaying ? "Pause" : "Play"}
            aria-pressed={isPlaying}
            onClick={handlePlayPause}
            disabled={audioLoading}
          >
            <span className="arch-play-icon">{isPlaying ? "⏸" : "▶"}</span>{" "}
            {isPlaying ? "PAUSE" : "PLAY"}
          </button>
          <button
            className="arch-transport-btn arch-cue-btn"
            aria-label="Cue"
            title="CUE — set cue point when stopped; return to cue when paused"
            onClick={handleCue}
            disabled={audioLoading || !audioEngine.isLoaded()}
          >
            ■ CUE
          </button>
          <button
            className="arch-transport-btn arch-bar-skip-btn"
            aria-label="Skip forward (1 tap: 4 bars, 2 taps: 8 bars)"
            title="1 tap: +4 bars · 2 taps: +8 bars"
            onClick={() => handleBarSkip(+1)}
            disabled={!audioEngine.isLoaded()}
          >
            ►►
          </button>
        </div>

        {/* Track navigation — separate from in-track skip */}
        <div className="arch-track-nav" role="group" aria-label="Track navigation">
          <button
            className="arch-transport-btn arch-skip-btn arch-track-nav-btn"
            aria-label="Previous track"
            onClick={handlePrev}
            disabled={!visibleTracks.length}
          >
            ⏮
          </button>
          <button
            className="arch-transport-btn arch-skip-btn arch-track-nav-btn"
            aria-label="Next track"
            onClick={handleNext}
            disabled={!visibleTracks.length}
          >
            ⏭
          </button>
        </div>

        {/* Right: loop controls — compact single button + CLR */}
        <div className="arch-transport-right">
          <div
            className="arch-loop-controls"
            role="group"
            aria-label="Loop controls"
          >
            <span className="arch-cue-tag">LOOP</span>
            <button
              className={`arch-loop-size-btn${loopRegion.start !== null ? " active" : ""}`}
              disabled={!loadedTrack}
              onClick={() => setLoopPanelTrigger((n) => n + 1)}
              title="Select loop size"
            >
              {(() => {
                const opt = LOOP_LENGTH_OPTIONS.find(
                  (o) => o.id === selectedLoopLengthId,
                );
                return opt ? opt.label : "1/4";
              })()}
            </button>
            {loopRegion.start !== null &&
              loopRegion.end !== null &&
              (() => {
                const bpm = loadedTrack ? resolveTrackBpm(loadedTrack) : null;
                const durSec = loopRegion.end - loopRegion.start;
                if (bpm && bpm > 0) {
                  const bars = (durSec * bpm) / 240;
                  return (
                    <span
                      className="arch-loop-readout"
                      title={`${loopRegion.start.toFixed(1)}→${loopRegion.end.toFixed(1)}s`}
                    >
                      {bars < 1
                        ? `${(bars * 4).toFixed(0)} BEAT${Math.round(bars * 4) !== 1 ? "S" : ""}`
                        : `${bars % 1 === 0 ? bars.toFixed(0) : bars.toFixed(1)} BAR${bars >= 2 ? "S" : ""}`}
                    </span>
                  );
                }
                return (
                  <span className="arch-loop-readout">
                    {`${loopRegion.start.toFixed(1)}→${loopRegion.end.toFixed(1)}s`}
                  </span>
                );
              })()}
            <button
              className="arch-loop-btn"
              disabled={loopRegion.start === null}
              onClick={handleClearLoop}
              title="CLR — clear the active loop region"
            >
              CLR
            </button>
          </div>
          <button
            className="arch-intake-tab-btn"
            onClick={() => onIntake?.()}
            aria-label="Upload music to vault"
          >
            + INTAKE
          </button>
          <button
            className="arch-shortcuts-trigger"
            onClick={() => setShowShortcuts((v) => !v)}
            aria-label="Keyboard shortcuts"
            title="Show keyboard shortcuts"
          >
            ?
          </button>
        </div>
      </div>

      {/* Keyboard shortcut legend — toggled by ? key or the ? button above */}
      {showShortcuts && (
        <div
          className="arch-shortcut-legend"
          role="note"
          aria-label="Keyboard shortcuts"
        >
          SPACE play/pause&nbsp;&nbsp;·&nbsp;&nbsp;L
          load&nbsp;&nbsp;·&nbsp;&nbsp;` cue&nbsp;&nbsp;·&nbsp;&nbsp;1–8
          pads&nbsp;&nbsp;·&nbsp;&nbsp;← → seek 1 beat&nbsp;&nbsp;·&nbsp;&nbsp;↑
          ↓ zoom (hover waveform/overview)&nbsp;&nbsp;·&nbsp;&nbsp;ESC
          dismiss&nbsp;&nbsp;·&nbsp;&nbsp;? close
        </div>
      )}

      {/* ── LOWER ZONE ──────────────────────────────────────────────── */}
      <div className="arch-lower-zone">
        {/* ARCHITECT RAIL — sovereign controls, toggled by PSC wordmark */}
        <aside
          className={`arch-rail${railOpen ? " arch-rail--open" : ""}`}
          aria-label="Architect controls"
          aria-hidden={!railOpen}
        >
          <div className="arch-ops-stack">
            <div className="arch-ops-box" aria-label="Settings">
              <div className="arch-rail-section-label">SETUP</div>
              <button
                className={`arch-rail-toggle arch-ops-toggle ${showSettings ? "active" : ""}`}
                onClick={toggleSettings}
                aria-expanded={showSettings}
              >
                <span className="arch-rail-icon">◌</span>
                SYSTEM SETTINGS
              </button>
            </div>
          </div>

          <div className="arch-rail-divider" />
          <div className="arch-rail-section-label">SOVEREIGN</div>

          <button
            className={`arch-rail-toggle ${showArchive ? "active" : ""}`}
            onClick={toggleArchive}
            aria-expanded={showArchive}
          >
            <span className="arch-rail-icon">◉</span>
            ARCHIVE LOG
            {architectArchive.filter((i) => !i.restored).length > 0 && (
              <span className="arch-badge">
                {architectArchive.filter((i) => !i.restored).length}
              </span>
            )}
          </button>

          <button
            className={`arch-rail-toggle ${showRoster ? "active" : ""}`}
            onClick={toggleRoster}
            aria-expanded={showRoster}
          >
            <span className="arch-rail-icon">◎</span>
            ROSTER
            <span className="arch-badge">{members.length}</span>
          </button>

          <button
            className={`arch-rail-toggle ${showMatrix ? "active" : ""} ${matrixArmed ? "arch-armed" : ""}`}
            onClick={toggleMatrix}
            aria-expanded={showMatrix}
            title="CMD MATRIX — permission grid for member tiers"
          >
            <span className="arch-rail-icon">⊞</span>
            CMD MATRIX
          </button>

          <button
            className={`arch-rail-toggle ${showInbox ? "active" : ""}`}
            onClick={toggleInbox}
            aria-expanded={showInbox}
          >
            <span className="arch-rail-icon">◈</span>
            VETTING INBOX
            {unreadCountL > 0 && (
              <span className="arch-badge">{unreadCountL}</span>
            )}
          </button>

          <button
            className={`arch-rail-toggle ${showAccessCodes ? "active" : ""}`}
            onClick={toggleAccessCodes}
            aria-expanded={showAccessCodes}
          >
            <span className="arch-rail-icon">⊛</span>
            ACCESS CODES
          </button>

          <div className="arch-rail-divider" />
          <div className="arch-rail-section-label">VAULT</div>

          <button
            className={`arch-rail-toggle ${showTrackList ? "active" : ""}`}
            onClick={toggleTrackList}
            aria-expanded={showTrackList}
          >
            <span className="arch-rail-icon">▤</span>
            TRACK REGISTRY
            {trackListData.length > 0 && (
              <span className="arch-badge">{trackListData.length}</span>
            )}
          </button>

          <div className="arch-rail-divider" />
          <div className="arch-rail-section-label">COMMAND</div>

          <button
            className="arch-rail-cmd"
            onClick={handleExplore}
            title="Open this vault directly (same as clicking its tab)"
          >
            OPEN {commandVaultId ? `→ ${vaultLabel(commandVaultId)}` : "VAULT"}
          </button>
          <button
            className="arch-rail-cmd arch-rail-void"
            disabled={!commandVaultId}
            onClick={handleVoidProtocol}
            title="Archive this vault's placeholder record — not related to track VOID in the track browser"
          >
            VOID PROTOCOL
          </button>
        </aside>

        {/* LIBRARY PANEL */}
        <main className="arch-library" aria-label="Vault library">
          {/* Batch upload status panel — drop target lives in the INTAKE modal now;
              this stays visible so background uploads started there are never invisible. */}
          <BatchUploadQueue
            queue={batchQueue}
            onRetry={onBatchRetry}
            onDismiss={onBatchDismiss}
          />

          {/* Unified library row: vault tabs LEFT | action buttons RIGHT | search FAR RIGHT */}
          <div
            className="arch-vault-tabs"
            role="tablist"
            aria-label="Vault selector"
          >
            <span
              className="arch-tab-glider"
              ref={gliderRef}
              aria-hidden="true"
            />
            {VAULT_ROUTES.map((v, i) => {
              const isAddTab = v.id === "earth";
              const count = (vaultTracksState?.[v.id] || []).filter(
                (t) => !t.is_voided,
              ).length;
              return (
                <button
                  key={v.id}
                  ref={(el) => (tabRefs.current[i] = el)}
                  role="tab"
                  className={`arch-vault-tab ${activeLibVault === v.id ? "active" : ""}${isAddTab ? " arch-vault-tab-add" : ""}`}
                  style={{ "--vault-color": v.color }}
                  aria-selected={activeLibVault === v.id}
                  onClick={() => {
                    setActiveLibVault(v.id);
                    setActiveVault(v.id);
                    announce(`Vault folder ${v.label}.`);
                  }}
                  onMouseEnter={() => hoverGlider(i)}
                  onMouseLeave={() =>
                    moveGlider(
                      VAULT_ROUTES.findIndex((r) => r.id === activeLibVault),
                    )
                  }
                >
                  {isAddTab ? (
                    <span className="arch-vault-tab-add-label">
                      + build vault
                    </span>
                  ) : (
                    <>
                      <span className="arch-vault-pip" aria-hidden="true" />
                      {v.label}
                      {count > 0 && (
                        <span className="arch-vault-count">{count}</span>
                      )}
                    </>
                  )}
                </button>
              );
            })}

            {/* Library action buttons — RIGHT side of vault tab row */}
            <div
              className="arch-lib-actions"
              role="toolbar"
              aria-label="Library actions"
            >
              <div className="arch-display-divider" aria-hidden="true" />
              <button
                className={`arch-browser-btn ${smartCrates ? "active" : ""}`}
                onClick={() => setSmartCrates((p) => !p)}
                aria-pressed={smartCrates}
                title={
                  loadedTrack
                    ? "SMART — surface tracks compatible with the loaded track (BPM within 6%, key match when known)"
                    : "SMART — load a track to the deck first, then this surfaces its BPM/key-compatible matches"
                }
              >
                SMART
              </button>
              <button
                className={`arch-browser-btn ${loadedDeckId && selectedTrackId === loadedDeckId ? "active" : ""}`}
                onClick={handleLoadDeck}
                title="LOAD DECK — load selected track to the deck (or double-click a track row)"
              >
                LOAD DECK
              </button>
              <button
                className={`arch-browser-btn ${publishFilter === "staged" ? "active" : ""}`}
                onClick={() =>
                  setPublishFilter((p) => (p === "staged" ? "all" : "staged"))
                }
                title="STAGED — show only unpublished tracks"
              >
                STAGED
              </button>
              <button
                className={`arch-browser-btn ${publishFilter === "live" ? "active" : ""}`}
                onClick={() =>
                  setPublishFilter((p) => (p === "live" ? "all" : "live"))
                }
                title="LIVE — show only published tracks"
              >
                LIVE
              </button>
              <button
                className={`arch-browser-btn ${publishFilter === "all" ? "active" : ""}`}
                onClick={() => setPublishFilter("all")}
                title="HISTORY — show all tracks, newest first"
              >
                HISTORY
              </button>
              <div
                className="arch-display-divider arch-display-divider--major"
                aria-hidden="true"
              />
              {publishState.status === "error" ? (
                <button
                  className="arch-browser-btn arch-publish-btn arch-action-error"
                  onClick={handlePublishSelected}
                  title={`Publish failed for ${publishState.count} track${publishState.count !== 1 ? "s" : ""} — click to retry`}
                >
                  {`RETRY PUBLISH (${publishState.count})`}
                </button>
              ) : (
                <button
                  className="arch-browser-btn arch-publish-btn"
                  onClick={handlePublishSelected}
                  disabled={
                    !selectionHasStaged || publishState.status === "pending"
                  }
                  title={
                    selectedTrackIds.size === 0
                      ? "Select tracks via the checkbox to publish"
                      : undefined
                  }
                >
                  {publishState.status === "pending"
                    ? "PUBLISHING…"
                    : publishState.status === "success"
                      ? `DONE (${publishState.count})`
                      : `PUBLISH${selectedTrackIds.size > 0 ? ` (${selectedTrackIds.size})` : ""}`}
                </button>
              )}
              {retractState.status === "error" ? (
                <button
                  className="arch-browser-btn arch-retract-btn arch-action-error"
                  onClick={handleRetractSelected}
                  title={`Retract failed for ${retractState.count} track${retractState.count !== 1 ? "s" : ""} — click to retry`}
                >
                  {`RETRY RETRACT (${retractState.count})`}
                </button>
              ) : (
                <button
                  className={`arch-browser-btn arch-retract-btn${retractState.status === "confirm" ? " arch-retract-confirm" : ""}`}
                  onClick={handleRetractSelected}
                  disabled={
                    !selectionHasLive || retractState.status === "pending"
                  }
                  title={
                    retractState.status === "confirm"
                      ? "Click again to confirm — auto-cancels in 3s"
                      : "RETRACT — unpublish selected live tracks from vault"
                  }
                >
                  {retractState.status === "pending"
                    ? "RETRACTING…"
                    : retractState.status === "success"
                      ? `DONE (${retractState.count})`
                      : retractState.status === "confirm"
                        ? `CONFIRM RETRACT (${retractState.count})?`
                        : `RETRACT${selectedTrackIds.size > 0 ? ` (${selectedTrackIds.size})` : ""}`}
                </button>
              )}
              <div className="arch-display-divider" aria-hidden="true" />
              <div className="arch-move-menu-wrap">
                <button
                  className={`arch-browser-btn ${showMoveMenu ? "active" : ""}`}
                  onClick={() => setShowMoveMenu((prev) => !prev)}
                  disabled={
                    selectedTrackIds.size === 0 || moveState.status === "pending"
                  }
                  title="MOVE TO — reassign selected tracks to a different vault"
                >
                  {moveState.status === "pending"
                    ? "MOVING…"
                    : moveState.status === "success"
                      ? `DONE (${moveState.count})`
                      : moveState.status === "error"
                        ? `MOVE FAILED (${moveState.count})`
                        : `MOVE TO ▾${selectedTrackIds.size > 0 ? ` (${selectedTrackIds.size})` : ""}`}
                </button>
                {showMoveMenu && (
                  <div className="arch-move-menu" role="menu">
                    {VAULT_ROUTES.filter((v) => v.id !== activeLibVault).map(
                      (v) => (
                        <button
                          key={v.id}
                          className="arch-move-menu-item"
                          role="menuitem"
                          onClick={() => handleMoveSelected(v.id)}
                        >
                          {v.label}
                        </button>
                      ),
                    )}
                  </div>
                )}
              </div>
              <button
                className="arch-browser-btn"
                onClick={handleVoidSelected}
                disabled={
                  selectedTrackIds.size === 0 ||
                  voidSelectedState.status === "pending"
                }
                title="VOID — soft-delete selected tracks (reversible)"
              >
                {voidSelectedState.status === "pending"
                  ? "VOIDING…"
                  : voidSelectedState.status === "success"
                    ? `DONE (${voidSelectedState.count})`
                    : voidSelectedState.status === "error"
                      ? `VOID FAILED (${voidSelectedState.count})`
                      : `VOID${selectedTrackIds.size > 0 ? ` (${selectedTrackIds.size})` : ""}`}
              </button>
              <button
                className="arch-browser-btn"
                onClick={handleRegenSelected}
                disabled={
                  selectedTrackIds.size === 0 ||
                  regenSelectedState.status === "pending"
                }
                title="REGEN — force-regenerate waveforms for selected tracks"
              >
                {regenSelectedState.status === "pending"
                  ? "REGENERATING…"
                  : regenSelectedState.status === "success"
                    ? `DONE (${regenSelectedState.count})`
                    : regenSelectedState.status === "error"
                      ? `REGEN FAILED (${regenSelectedState.count})`
                      : `REGEN${selectedTrackIds.size > 0 ? ` (${selectedTrackIds.size})` : ""}`}
              </button>
              <div className="arch-display-divider" aria-hidden="true" />
              <button
                className="arch-browser-btn"
                onClick={handlePrepareSelected}
                title="PREPARE — queue selected tracks for deck loading (rekordbox-style)"
              >
                PREPARE
                {prepareQueue.length > 0 ? ` (${prepareQueue.length})` : ""}
              </button>
            </div>
          </div>

          {/* Track list — phosphor scan animation (Animation 1) */}
          <div className="arch-track-list" role="table" aria-label="Track list">
            <div className="arch-track-list-head" role="row">
              <span
                role="columnheader"
                className="arch-track-col-check"
                aria-label="Select"
              />
              <span role="columnheader">TITLE</span>
              <span role="columnheader">STATUS</span>
              <span role="columnheader">ARTIST</span>
              <button
                role="columnheader"
                className={`arch-sort-col-btn${sortMode.startsWith("bpm") ? " active" : ""}`}
                onClick={() =>
                  setSortMode((s) =>
                    s === "bpm-desc" ? "bpm-asc" : "bpm-desc",
                  )
                }
                aria-label={`Sort by BPM (${sortMode === "bpm-desc" ? "descending" : sortMode === "bpm-asc" ? "ascending" : "unsorted"})`}
              >
                BPM
                {sortMode === "bpm-desc" && (
                  <span className="arch-sort-indicator">▼</span>
                )}
                {sortMode === "bpm-asc" && (
                  <span className="arch-sort-indicator">▲</span>
                )}
              </button>
              <span role="columnheader">KEY</span>
              <span role="columnheader">LENGTH</span>
              <span role="columnheader">ADDED</span>
              <span role="columnheader">PLAYS</span>
              <span role="columnheader" aria-label="Waveform status">
                WF
              </span>
            </div>
            <div className="arch-track-list-body">
              {trackListLoading ? (
                <div className="arch-lib-empty">QUERYING VAULT…</div>
              ) : trackLoadError ? (
                <div className="arch-lib-empty arch-lib-error">
                  {trackLoadError} —{" "}
                  <button
                    className="arch-lib-retry"
                    onClick={() => {
                      setTrackLoadError(null);
                      fetchAllTracks()
                        .then(setTrackListData)
                        .catch((err) => {
                          console.error("[PSC] Failed to load tracks:", err);
                          setTrackLoadError("VAULT UNAVAILABLE");
                        });
                    }}
                  >
                    RETRY
                  </button>
                </div>
              ) : visibleTracks.length === 0 ? (
                <div className="arch-lib-vault-clear">VAULT CLEAR</div>
              ) : (
                visibleTracks.map((t, i) => {
                  const isLive = Boolean(t.is_published);
                  const isEditing = editingTrackId === t.id;
                  const isSmartMatch =
                    smartCrates &&
                    loadedTrack &&
                    smartCrateScore(t, loadedTrack) > 0;
                  return (
                    <div
                      key={t.id}
                      className={`arch-track-row arch-track-row-${trackColorRows ? t.vault || "generic" : "generic"} ${selectedTrackId === t.id ? "selected" : ""} ${loadedDeckId === t.id ? "loaded" : ""} ${selectedTrackIds.has(t.id) ? "checked" : ""} ${isLive ? "arch-track-live" : "arch-track-staged"}`}
                      role="row"
                      tabIndex={0}
                      aria-selected={selectedTrackId === t.id}
                      title="Click to select. Double-click to load to deck."
                      style={{ "--row-i": i }}
                      onClick={() => handleTrackSelect(t)}
                      onDoubleClick={() => handleTrackDoubleClick(t)}
                      onKeyDown={(event) => handleTrackRowKeyDown(event, t)}
                    >
                      <span
                        className="arch-track-col-check"
                        role="cell"
                        onClick={(e) => handleToggleTrackSelection(e, t.id)}
                      >
                        <span
                          className={`arch-track-checkbox ${selectedTrackIds.has(t.id) ? "is-checked" : ""}`}
                          role="checkbox"
                          tabIndex={0}
                          aria-checked={selectedTrackIds.has(t.id)}
                          aria-label={
                            selectedTrackIds.has(t.id) ? "Deselect" : "Select"
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              handleToggleTrackSelection(event, t.id);
                            }
                          }}
                        />
                      </span>
                      <span className="arch-track-title" role="cell">
                        {isSmartMatch && (
                          <span
                            className="arch-smart-match-badge"
                            title="SMART match — BPM (and key, if known) compatible with the loaded track"
                          >
                            MATCH
                          </span>
                        )}
                        {isEditing ? (
                          <input
                            className="arch-track-edit-input"
                            value={editingValues.title ?? ""}
                            onChange={(e) =>
                              setEditingValues((v) => ({
                                ...v,
                                title: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => handleEditKeyDown(e, t.id)}
                            onBlur={(e) => {
                              if (
                                e.relatedTarget?.classList?.contains(
                                  "arch-track-edit-input",
                                )
                              )
                                return;
                              handleEditSave(t.id);
                            }}
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <span
                            onDoubleClick={(e) => handleEditStart(e, t)}
                            title="Double-click to rename"
                          >
                            {t.title || "—"}
                          </span>
                        )}
                      </span>
                      <span className="arch-track-state" role="cell">
                        <i
                          className={`arch-state-dot arch-pub-dot ${isLive ? "is-live" : "is-staged"}`}
                        />
                        {isLive ? "LIVE" : "STAGED"}
                      </span>
                      <span className="arch-track-artist" role="cell">
                        {isEditing ? (
                          <input
                            className="arch-track-edit-input"
                            value={editingValues.artist ?? ""}
                            onChange={(e) =>
                              setEditingValues((v) => ({
                                ...v,
                                artist: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => handleEditKeyDown(e, t.id)}
                            onBlur={(e) => {
                              if (
                                e.relatedTarget?.classList?.contains(
                                  "arch-track-edit-input",
                                )
                              )
                                return;
                              handleEditSave(t.id);
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <span
                            onDoubleClick={(e) => handleEditStart(e, t)}
                            title="Double-click to edit"
                          >
                            {t.artist || "—"}
                          </span>
                        )}
                      </span>
                      <span className="arch-track-bpm" role="cell">
                        {editingTrackId === t.id ? (
                          <input
                            className="arch-track-edit-input"
                            value={editingValues.bpm_display ?? ""}
                            onChange={(e) =>
                              setEditingValues((v) => ({
                                ...v,
                                bpm_display: e.target.value,
                              }))
                            }
                            onBlur={(e) => {
                              if (
                                e.relatedTarget?.classList?.contains(
                                  "arch-track-edit-input",
                                )
                              )
                                return;
                              handleEditSave(t.id);
                            }}
                            onKeyDown={(e) => handleEditKeyDown(e, t.id)}
                            onClick={(e) => e.stopPropagation()}
                            maxLength={20}
                          />
                        ) : (
                          <>
                            {(() => {
                              if (hasCompleteManualBpm(t)) return null;
                              const zones = resolveBeatgridZones(t);
                              if (zones) return <ZonesBadge zones={zones} />;
                              if (t.detected_bpm == null) return null;
                              const bucket = bucketForGenre(resolveTrackGenre(t, consoleDefaultGenre));
                              return <ConfBadge confidence={t.detected_bpm_confidence} genreBucket={bucket} />;
                            })()}
                            <span
                              onDoubleClick={(e) => handleEditStart(e, t)}
                              className={
                                !hasCompleteManualBpm(t) &&
                                t.detected_bpm != null &&
                                t.detected_bpm_confidence < DETECTED_BPM_CONFIDENCE_THRESHOLD
                                  ? "arch-bpm-unverified"
                                  : undefined
                              }
                            >
                              {cleanBpm(t.bpm_display) ||
                                (t.bpm
                                  ? Math.round(Number(t.bpm))
                                  : resolveTrackBpm(t)
                                    ? Math.round(resolveTrackBpm(t))
                                    : t.detected_bpm != null
                                      ? Math.round(t.detected_bpm)
                                      : "—")}
                            </span>
                            {!hasCompleteManualBpm(t) &&
                              t.detected_bpm != null &&
                              shouldShowOctaveControl(t, bucketForGenre(resolveTrackGenre(t, consoleDefaultGenre))) && (
                                <span className="arch-octave-controls">
                                  <button
                                    type="button"
                                    aria-label="Halve detected BPM (octave correction)"
                                    className={`god-btn arch-octave-btn ${octaveCorrectError[t.id] ? "arch-octave-error" : ""}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOctaveCorrect(t, 0.5);
                                    }}
                                    title="Halve detected BPM (octave correction)"
                                  >
                                    ½×
                                  </button>
                                  <button
                                    type="button"
                                    aria-label="Double detected BPM (octave correction)"
                                    className={`god-btn arch-octave-btn ${octaveCorrectError[t.id] ? "arch-octave-error" : ""}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOctaveCorrect(t, 2);
                                    }}
                                    title="Double detected BPM (octave correction)"
                                  >
                                    2×
                                  </button>
                                </span>
                              )}
                          </>
                        )}
                      </span>
                      <span className="arch-track-key" role="cell">
                        {t.musical_key || "—"}
                      </span>
                      <span className="arch-track-len" role="cell">
                        {isEditing ? (
                          <input
                            className="arch-track-edit-input"
                            value={editingValues.duration_display ?? ""}
                            placeholder="M:SS"
                            onChange={(e) =>
                              setEditingValues((v) => ({
                                ...v,
                                duration_display: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => handleEditKeyDown(e, t.id)}
                            onBlur={(e) => {
                              if (e.relatedTarget?.classList?.contains("arch-track-edit-input")) return;
                              handleEditSave(t.id);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            maxLength={8}
                          />
                        ) : (
                          <span onDoubleClick={(e) => handleEditStart(e, t)} title="Double-click to edit">
                            {t.duration ? formatTime(t.duration) : "—:——"}
                          </span>
                        )}
                      </span>
                      <span className="arch-track-date" role="cell">
                        {t.created_at
                          ? new Date(t.created_at).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "2-digit",
                            })
                          : "—"}
                      </span>
                      <span className="arch-track-plays" role="cell">
                        {trackPlayCounts[t.id] || 0}
                      </span>
                      <span
                        className="arch-track-wf-status"
                        role="cell"
                        title="Waveform status"
                      >
                        {regeneratingWaveforms[t.id] ? (
                          <span
                            style={{
                              color: "rgba(240,237,232,0.5)",
                              fontSize: "0.55rem",
                              fontFamily: "'Chakra Petch', monospace",
                              letterSpacing: "0.08em",
                            }}
                            title="Waveform generating"
                          >
                            {waveformProgress[t.id] != null
                              ? `${waveformProgress[t.id]}%`
                              : "…"}
                          </span>
                        ) : waveformBarsCache.current[t.id] ||
                          isV2Sentinel(t.waveform_data) ? (
                          <span
                            style={{
                              color: "rgba(0,204,102,0.7)",
                              fontSize: "0.55rem",
                            }}
                            title="Waveform ready (V2)"
                          >
                            ▪
                          </span>
                        ) : t.waveform_data &&
                          t.waveform_data !== WAVEFORM_V2_SENTINEL ? (
                          <span
                            style={{
                              color: "rgba(240,237,232,0.3)",
                              fontSize: "0.55rem",
                            }}
                            title="V1 only — V2 queued"
                          >
                            ▫
                          </span>
                        ) : (
                          <span
                            style={{
                              color: "rgba(240,237,232,0.2)",
                              fontSize: "0.55rem",
                            }}
                            title="No waveform generated yet"
                          >
                            —
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </main>
      </div>

      {/* ── CONTEXT STRIP ────────────────────────────────────────────── */}
      <ContextStrip
        viewer={viewer}
        reachMessages={reachMessages}
        onVaults={toggleVaults}
        onRoster={toggleRoster}
        loopSizeOptions={LOOP_LENGTH_OPTIONS}
        selectedLoopSizeId={selectedLoopLengthId}
        onSelectLoopSize={(opt) => handleApplyLoopLength(opt)}
        externalLoopOpen={loopPanelTrigger}
        libSearch={libSearch}
        onSearchChange={setLibSearch}
        matchCount={libSearch ? filteredTracks.length : null}
        systemStatus={systemStatus}
      />

      {/* ── PANELS (overlays from right) ──────────────────────────────── */}
      <AnimatePresence>
        {showRoster && (
          <motion.div
            id="arch-roster-zone"
            className="arch-panel-overlay"
            role="dialog"
            aria-label="Roster"
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 120, damping: 22 }}
          >
            <div className="arch-panel-header">
              <span className="arch-panel-dot" />
              <span className="arch-panel-title">ROSTER</span>
              <span className="arch-panel-sub">{members.length} MEMBERS</span>
              <button
                className="arch-panel-close"
                onClick={toggleRoster}
                aria-label="Close roster"
              >
                ✕
              </button>
            </div>

            {rosterFlash && (
              <div className="arch-roster-flash">
                <span className="arch-roster-flash-name">
                  {rosterFlash.name}
                </span>
                <span className="arch-roster-flash-code">
                  {rosterFlash.code}
                </span>
                <span className="arch-roster-flash-sub">
                  TRANSMIT TO MEMBER — THEN DISMISS
                </span>
                <button
                  className="arch-roster-flash-dismiss"
                  onClick={() => setRosterFlash(null)}
                >
                  DISMISS
                </button>
              </div>
            )}

            <div className="arch-panel-body">
              <table className="arch-data-table">
                <thead>
                  <tr>
                    <th>TIER</th>
                    <th>HANDLE</th>
                    <th>DOMAIN</th>
                    <th>CODE</th>
                    <th>REGISTERED</th>
                  </tr>
                </thead>
                <tbody>
                  {members.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="arch-table-empty">
                        — NO MEMBERS REGISTERED —
                      </td>
                    </tr>
                  ) : (
                    members.map((m) => (
                      <tr key={m.id}>
                        <td className="arch-cell-tier">{m.tier}</td>
                        <td className="arch-cell-handle">{m.name}</td>
                        <td className="arch-cell-domain">
                          {vaultLabel(m.planet)}
                        </td>
                        <td
                          className="arch-cell-code"
                          onMouseEnter={() => setRosterReveal(m.id)}
                          onMouseLeave={() => setRosterReveal(null)}
                          onFocus={() => setRosterReveal(m.id)}
                          onBlur={() => setRosterReveal(null)}
                          tabIndex={0}
                          role="button"
                          aria-pressed={rosterReveal === m.id}
                          aria-label={`Member ${m.name} access code`}
                          title="Hover or focus to reveal this member's access code"
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setRosterReveal((p) =>
                                p === m.id ? null : m.id,
                              );
                            }
                            if (e.key === "Escape") setRosterReveal(null);
                          }}
                        >
                          {rosterReveal === m.id ? m.code : "••••"}
                        </td>
                        <td className="arch-cell-date">
                          {new Date(m.createdAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "2-digit",
                          })}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="arch-panel-footer-actions">
              {!rosterShowAdd ? (
                <button
                  className="arch-panel-action-btn"
                  onClick={() => setRosterShowAdd(true)}
                >
                  + ADD MEMBER
                </button>
              ) : (
                <form className="arch-add-form" onSubmit={handleRosterAdd}>
                  <input
                    className="arch-form-input"
                    placeholder="HANDLE"
                    value={rosterName}
                    onChange={(e) => setRosterName(e.target.value)}
                    maxLength={64}
                    autoFocus
                    required
                  />
                  <div className="arch-tier-toggle">
                    <button
                      type="button"
                      className={`arch-tier-btn ${rosterTier === "B" ? "active" : ""}`}
                      onClick={() => setRosterTier("B")}
                    >
                      COLLECTIVE
                    </button>
                    <button
                      type="button"
                      className={`arch-tier-btn ${rosterTier === "C" ? "active" : ""}`}
                      onClick={() => setRosterTier("C")}
                    >
                      FEATURED ARTIST
                    </button>
                  </div>
                  {rosterTier === "B" ? (
                    <select
                      className="arch-form-select"
                      value={rosterPlanet}
                      onChange={(e) => setRosterPlanet(e.target.value)}
                    >
                      <option value="">— NO DOMAIN —</option>
                      {VAULT_ROUTES.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="arch-form-input"
                      placeholder="FEATURED TAG"
                      value={rosterMoon}
                      onChange={(e) =>
                        setRosterMoon(e.target.value.toUpperCase())
                      }
                      maxLength={32}
                      required
                    />
                  )}
                  <input
                    className="arch-form-input"
                    placeholder="SET CODE (e.g. 2112)"
                    value={rosterCode}
                    onChange={(e) =>
                      setRosterCode(
                        e.target.value.replace(/\D/g, "").slice(0, 8),
                      )
                    }
                    maxLength={8}
                  />
                  <div className="arch-form-actions">
                    <button
                      type="submit"
                      className="arch-form-commit"
                      disabled={
                        !rosterName.trim() ||
                        (rosterTier === "C" && !rosterMoon.trim())
                      }
                    >
                      COMMIT
                    </button>
                    <button
                      type="button"
                      className="arch-form-cancel"
                      onClick={() => setRosterShowAdd(false)}
                    >
                      CANCEL
                    </button>
                  </div>
                </form>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showMatrix && (
          <motion.div
            id="arch-matrix-zone"
            className="arch-panel-overlay"
            role="dialog"
            aria-label="CMD Matrix"
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 120, damping: 22 }}
          >
            <div className="arch-panel-header">
              <span className="arch-panel-dot" />
              <span className="arch-panel-title">CMD MATRIX</span>
              <span className="arch-panel-sub">
                PERMISSION GRID — ARM TO EDIT
              </span>
              <div className="arch-matrix-interlocks">
                {!matrixArmed ? (
                  <button
                    className="arch-matrix-arm"
                    onClick={handleMatrixArm}
                    title="Arm this grid for editing — must arm before any permission change applies"
                  >
                    ARM
                  </button>
                ) : (
                  <>
                    <button
                      className="arch-matrix-commit"
                      onClick={handleMatrixCommit}
                      disabled={Object.keys(matrixPending).length === 0}
                      title="Commit the armed permission changes"
                    >
                      COMMIT
                    </button>
                    <button
                      className="arch-matrix-cancel"
                      onClick={handleMatrixDisarm}
                      title="Discard armed, uncommitted changes — nothing is saved"
                    >
                      CANCEL
                    </button>
                  </>
                )}
                <button
                  className="arch-matrix-rollback"
                  onClick={handleMatrixRollback}
                  disabled={matrixHistory.length === 0}
                  title="Revert the most recent committed change"
                >
                  ROLLBACK
                </button>
              </div>
              <button
                className="arch-panel-close"
                onClick={toggleMatrix}
                aria-label="Close matrix"
              >
                ✕
              </button>
            </div>

            <div className="arch-panel-body">
              <table className="arch-data-table">
                <thead>
                  <tr>
                    <th>HANDLE</th>
                    <th>TIER</th>
                    <th>DOMAIN</th>
                    <th>VOID</th>
                    <th>TUNE</th>
                    <th>COMMENT</th>
                  </tr>
                </thead>
                <tbody>
                  {members.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="arch-table-empty">
                        — NO MEMBERS —
                      </td>
                    </tr>
                  ) : (
                    members.map((m) => {
                      const tierVoid = m.tier === "A" || m.tier === "B";
                      const tierTune = m.tier === "A" || m.tier === "B";
                      const tierComment =
                        m.tier === "A" || m.tier === "B" || m.tier === "C";
                      return (
                        <tr
                          key={m.id}
                          className={
                            matrixPending[m.id] ? "arch-row-pending" : ""
                          }
                        >
                          <td className="arch-cell-handle">{m.name}</td>
                          <td className="arch-cell-tier">{m.tier}</td>
                          <td className="arch-cell-domain">
                            {vaultLabel(m.planet)}
                          </td>
                          {["void", "tune", "comment"].map((perm, i) => {
                            const defaults = [tierVoid, tierTune, tierComment];
                            const active = resolveMatrixPerm({
                              pendingEntry: matrixPending[m.id],
                              committedEntry: matrixCommitted[m.id],
                              tierDefaults: { [perm]: defaults[i] },
                              perm,
                            });
                            const hasPending =
                              matrixPending[m.id]?.[perm] !== undefined;
                            return (
                              <td key={perm}>
                                <button
                                  className={`arch-matrix-cell ${active ? "arch-cell-on" : "arch-cell-off"} ${hasPending ? "arch-cell-pending" : ""} ${!matrixArmed ? "arch-cell-locked" : ""}`}
                                  onClick={() => handleMatrixToggle(m.id, perm)}
                                  disabled={!matrixArmed}
                                  aria-pressed={active}
                                  aria-label={`${m.name} ${perm} ${active ? "enabled" : "disabled"}`}
                                >
                                  {active ? "●" : "○"}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSettings && viewer !== "D" && (
          <AdminSettings
            onClose={toggleSettings}
            members={members}
            waveformDetail={waveformDetail}
            setWaveformDetail={setWaveformDetail}
            trackColorRows={trackColorRows}
            setTrackColorRows={setTrackColorRows}
            quantizeEnabled={quantizeEnabled}
            handleQuantizeToggle={() => setQuantizeEnabled((p) => !p)}
            autoLoopDefault={autoLoopDefault}
            setAutoLoopDefault={setAutoLoopDefault}
            smartCrates={smartCrates}
            setSmartCrates={setSmartCrates}
            historyEnabled={historyEnabled}
            setHistoryEnabled={setHistoryEnabled}
            consoleDefaultGenre={consoleDefaultGenre}
            cycleConsoleDefaultGenre={() =>
              setConsoleDefaultGenre(
                (p) =>
                  GENRE_CYCLE_ORDER[
                    (GENRE_CYCLE_ORDER.indexOf(p) + 1) % GENRE_CYCLE_ORDER.length
                  ],
              )
            }
          />
        )}
        {showSettings && viewer === "D" && (
          <motion.div
            className="arch-panel-overlay"
            role="dialog"
            aria-label="Settings"
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 120, damping: 22 }}
          >
            <div className="arch-panel-header">
              <span className="arch-panel-dot" />
              <span className="arch-panel-title">PREFERENCES</span>
              <span className="arch-panel-sub">DISPLAY · PLAYBACK · VAULT</span>
              <button
                className="arch-panel-close"
                onClick={toggleSettings}
                aria-label="Close settings"
              >
                ✕
              </button>
            </div>
            <div className="arch-panel-body arch-settings-body">
              <section className="arch-settings-section">
                <h4 className="arch-settings-title">DISPLAY</h4>
                <div
                  className="arch-settings-row"
                  title="Color-code track rows by vault (mixes/original music/live sets)"
                >
                  <span>Track Color Rows</span>
                  <button
                    className={`arch-settings-toggle ${trackColorRows ? "active" : ""}`}
                    onClick={() => setTrackColorRows((p) => !p)}
                    aria-pressed={trackColorRows}
                  >
                    {trackColorRows ? "ON" : "OFF"}
                  </button>
                </div>
              </section>
              <section className="arch-settings-section">
                <h4 className="arch-settings-title">PLAYBACK</h4>
                <div
                  className="arch-settings-row"
                  title="Snap hot-cue placement and beatgrid edits to the nearest beat"
                >
                  <span>Quantize</span>
                  <button
                    className={`arch-settings-toggle ${quantizeEnabled ? "active" : ""}`}
                    onClick={() => setQuantizeEnabled((p) => !p)}
                    aria-pressed={quantizeEnabled}
                  >
                    {quantizeEnabled ? "ON" : "OFF"}
                  </button>
                </div>
                <div
                  className="arch-settings-row"
                  title="Reserved for a future default loop size — not yet wired to a behavior"
                >
                  <span>Auto Loop Default</span>
                  <button
                    className={`arch-settings-toggle ${autoLoopDefault ? "active" : ""}`}
                    onClick={() => setAutoLoopDefault((p) => !p)}
                    aria-pressed={autoLoopDefault}
                  >
                    {autoLoopDefault ? "ON" : "OFF"}
                  </button>
                </div>
              </section>
              <section className="arch-settings-section">
                <h4 className="arch-settings-title">VAULT</h4>
                <div
                  className="arch-settings-row"
                  title="Surfaces BPM/key-compatible tracks first in the library, relative to the loaded deck track. Same toggle as the SMART button in the track browser."
                >
                  <span>Smart Crates</span>
                  <button
                    className={`arch-settings-toggle ${smartCrates ? "active" : ""}`}
                    onClick={() => setSmartCrates((p) => !p)}
                    aria-pressed={smartCrates}
                  >
                    {smartCrates ? "ENABLED" : "DISABLED"}
                  </button>
                </div>
                <div
                  className="arch-settings-row"
                  title="Log played tracks to your recently-played history"
                >
                  <span>Track History</span>
                  <button
                    className={`arch-settings-toggle ${historyEnabled ? "active" : ""}`}
                    onClick={() => setHistoryEnabled((p) => !p)}
                    aria-pressed={historyEnabled}
                  >
                    {historyEnabled ? "ENABLED" : "DISABLED"}
                  </button>
                </div>
              </section>
              <section className="arch-settings-section">
                <h4 className="arch-settings-title">BEAT DETECTION</h4>
                <div
                  className="arch-settings-row"
                  title="Applied to tracks with no per-track genre override yet (double-click the DYNAMIC/genre badge on a loaded track to set one)"
                >
                  <span>Default Tempo Genre</span>
                  <button
                    type="button"
                    className="god-btn arch-settings-cycle-btn"
                    onClick={() =>
                      setConsoleDefaultGenre(
                        (p) =>
                          GENRE_CYCLE_ORDER[
                            (GENRE_CYCLE_ORDER.indexOf(p) + 1) % GENRE_CYCLE_ORDER.length
                          ],
                      )
                    }
                  >
                    {consoleDefaultGenre}
                  </button>
                </div>
                <div className="arch-settings-row">
                  <span>Validation Suite</span>
                  <span className="arch-settings-value">
                    {formatValidationSummary(validationSummary)}
                  </span>
                </div>
              </section>
            </div>
          </motion.div>
        )}

        {showVaults && (
          <motion.div
            className="arch-panel-overlay"
            role="dialog"
            aria-label="Vault Configuration"
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 120, damping: 22 }}
          >
            <div className="arch-panel-header">
              <span className="arch-panel-dot" />
              <span className="arch-panel-title">VAULTS</span>
              <span className="arch-panel-sub">
                LABEL · COLOR · VISIBILITY · COPY
              </span>
              <button
                className="arch-panel-close"
                onClick={toggleVaults}
                aria-label="Close vault config"
              >
                ✕
              </button>
            </div>
            <div className="arch-panel-body arch-settings-body">
              {vaultConfigs.length === 0 && (
                <p className="arch-settings-empty">Loading vaults…</p>
              )}
              {vaultConfigs.map((vc) => {
                const edit = vaultEdits[vc.vault_id] ?? {};
                const saving = vaultSaving[vc.vault_id] ?? false;
                return (
                  <section
                    key={vc.vault_id}
                    className="arch-settings-section arch-vault-config-section"
                  >
                    <h4 className="arch-settings-title">
                      {vc.vault_id.toUpperCase()}
                    </h4>
                    <div className="arch-settings-row">
                      <span>Label</span>
                      <input
                        className="arch-vault-config-input"
                        value={edit.label ?? ""}
                        onChange={(e) =>
                          setVaultEdits((s) => ({
                            ...s,
                            [vc.vault_id]: {
                              ...s[vc.vault_id],
                              label: e.target.value,
                            },
                          }))
                        }
                        placeholder="MIXES"
                      />
                    </div>
                    <div className="arch-settings-row">
                      <span>
                        Color{" "}
                        <span style={{ opacity: 0.4 }}>(blank = none)</span>
                      </span>
                      <input
                        className="arch-vault-config-input"
                        value={edit.color ?? ""}
                        onChange={(e) =>
                          setVaultEdits((s) => ({
                            ...s,
                            [vc.vault_id]: {
                              ...s[vc.vault_id],
                              color: e.target.value,
                            },
                          }))
                        }
                        placeholder="#14dc14"
                        style={edit.color ? { color: edit.color } : {}}
                      />
                    </div>
                    <div className="arch-settings-row">
                      <span>Visible to listeners</span>
                      <button
                        className={`arch-settings-toggle${edit.visibility ? " active" : ""}`}
                        onClick={() =>
                          setVaultEdits((s) => ({
                            ...s,
                            [vc.vault_id]: {
                              ...s[vc.vault_id],
                              visibility: edit.visibility ? 0 : 1,
                            },
                          }))
                        }
                        aria-pressed={Boolean(edit.visibility)}
                      >
                        {edit.visibility ? "ON" : "OFF"}
                      </button>
                    </div>
                    <div className="arch-settings-row arch-settings-row--copy">
                      <span>Copy line</span>
                      <input
                        className="arch-vault-config-input arch-vault-config-copy"
                        value={edit.copy ?? ""}
                        onChange={(e) =>
                          setVaultEdits((s) => ({
                            ...s,
                            [vc.vault_id]: {
                              ...s[vc.vault_id],
                              copy: e.target.value,
                            },
                          }))
                        }
                        placeholder="Sub-headline shown to listeners"
                      />
                    </div>
                    <div className="arch-settings-row">
                      <button
                        className="arch-vault-config-save god-btn"
                        onClick={() => saveVaultConfig(vc.vault_id)}
                        disabled={saving}
                      >
                        {saving ? "SAVING…" : "SAVE"}
                      </button>
                    </div>
                  </section>
                );
              })}
            </div>
          </motion.div>
        )}

        {showAccessCodes && (
          <motion.div
            className="arch-panel-overlay"
            role="dialog"
            aria-label="Access Codes"
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 120, damping: 22 }}
          >
            <div className="arch-panel-header">
              <span className="arch-panel-dot" />
              <span className="arch-panel-title">ACCESS CODES</span>
              <span className="arch-panel-sub">GRANT · REVOKE · MANAGE</span>
              <button
                className="arch-panel-close"
                onClick={() => setShowAccessCodes(false)}
                aria-label="Close access codes"
              >
                ✕
              </button>
            </div>
            <div className="arch-panel-body arch-ac-body">
              <section className="arch-settings-section">
                <h4 className="arch-settings-title">GENERATE</h4>
                <div className="arch-ac-tier-row">
                  {["MASTERS", "MUSES", "MEMBERS"].map((t) => (
                    <button
                      key={t}
                      className={`arch-ac-tier-btn${acTier === t ? " active" : ""}`}
                      onClick={() => setAcTier(t)}
                      title={`Choose ${t} as the tier this code grants`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <div className="arch-settings-row">
                  <span>Granted To</span>
                  <input
                    className="arch-ac-input"
                    placeholder="PUMP"
                    value={acGrantedTo}
                    onChange={(e) => setAcGrantedTo(e.target.value)}
                  />
                </div>
                <div className="arch-settings-row">
                  <span>Expires</span>
                  <input
                    className="arch-ac-input"
                    type="date"
                    value={acExpiresAt}
                    onChange={(e) => setAcExpiresAt(e.target.value)}
                  />
                </div>
                <button
                  className="arch-ac-generate"
                  disabled={acWorking}
                  onClick={handleGenerateCode}
                  title="Generate a new access code for the selected tier"
                >
                  {acWorking ? "GENERATING..." : "GENERATE CODE"}
                </button>
                {acResult && (
                  <div className="arch-ac-result">
                    <span className="arch-ac-result-url">{acResult.url}</span>
                    <button
                      className="arch-ac-copy"
                      onClick={() =>
                        navigator.clipboard.writeText(acResult.url)
                      }
                      title="Copy this code's URL to clipboard"
                    >
                      COPY
                    </button>
                  </div>
                )}
                {acError && <p className="arch-ac-error">{acError}</p>}
              </section>
              <section className="arch-settings-section">
                <h4 className="arch-settings-title">ACTIVE CODES</h4>
                {acCodes.length === 0 && !acWorking && (
                  <p className="arch-ac-empty">NO CODES ISSUED</p>
                )}
                {acCodes.map((c) => (
                  <div key={c.id} className="arch-ac-code-row">
                    <div className="arch-ac-code-info">
                      <span className="arch-ac-code-tier">{c.tier}</span>
                      {c.granted_to && (
                        <span className="arch-ac-code-name">
                          {c.granted_to}
                        </span>
                      )}
                      {c.expires_at && (
                        <span className="arch-ac-code-exp">
                          {c.expires_at.slice(0, 10)}
                        </span>
                      )}
                    </div>
                    <button
                      className="arch-ac-revoke"
                      onClick={() => setRevokeConfirmId(c.id)}
                      title="Revoke this code — immediate and cannot be undone"
                    >
                      REVOKE
                    </button>
                  </div>
                ))}
              </section>
            </div>
          </motion.div>
        )}

        {showArchive && (
          <>
            <motion.div
              className="arch-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowArchive(false)}
            />
            <EventHorizonPanel
              architectArchive={architectArchive}
              onRestore={restoreItem}
              onClose={() => setShowArchive(false)}
            />
          </>
        )}
        {showInbox && (
          <div id="arch-inbox-panel">
            <InboxPanel viewer={viewer} onClose={() => setShowInbox(false)} />
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showTrackList && (
          <motion.div
            id="arch-track-list-zone"
            className="arch-panel-overlay"
            role="dialog"
            aria-label="Track Registry"
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 120, damping: 22 }}
          >
            <div className="arch-panel-header">
              <span className="arch-panel-dot" />
              <span className="arch-panel-title">TRACK REGISTRY</span>
              <span className="arch-panel-sub">
                {trackListLoading ? "…" : `${trackListData.length} TRACKS`}
              </span>
              <button
                className="arch-panel-close"
                onClick={toggleTrackList}
                aria-label="Close track registry"
              >
                ✕
              </button>
            </div>
            <div className="arch-panel-body">
              <table className="arch-data-table">
                <thead>
                  <tr>
                    <th>TITLE</th>
                    <th>ARTIST</th>
                    <th>BPM</th>
                    <th>VAULT</th>
                    <th>INGESTED</th>
                  </tr>
                </thead>
                <tbody>
                  {trackListLoading ? (
                    <tr>
                      <td colSpan={5} className="arch-table-empty">
                        QUERYING VAULT…
                      </td>
                    </tr>
                  ) : trackLoadError ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="arch-table-empty arch-lib-error"
                      >
                        {trackLoadError} —{" "}
                        <button
                          className="arch-lib-retry"
                          onClick={() => {
                            setTrackLoadError(null);
                            fetchAllTracks()
                              .then(setTrackListData)
                              .catch((err) => {
                                console.error(
                                  "[PSC] Failed to load tracks:",
                                  err,
                                );
                                setTrackLoadError("VAULT UNAVAILABLE");
                              });
                          }}
                        >
                          RETRY
                        </button>
                      </td>
                    </tr>
                  ) : trackListData.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="arch-table-empty">
                        — NO TRACKS IN VAULT —
                      </td>
                    </tr>
                  ) : (
                    trackListData.map((t) => (
                      <tr key={t.id}>
                        <td className="arch-cell-handle">{t.title}</td>
                        <td className="arch-cell-domain">{t.artist || "—"}</td>
                        <td className="arch-cell-tier">{t.bpm || "—"}</td>
                        <td className="arch-cell-domain">
                          {vaultLabel(t.vault)}
                        </td>
                        <td className="arch-cell-date">
                          {t.created_at
                            ? new Date(t.created_at).toLocaleDateString(
                                "en-US",
                                {
                                  month: "short",
                                  day: "numeric",
                                  year: "2-digit",
                                },
                              )
                            : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── CONFIRM DIALOGS ───────────────────────────────────────────── */}
      <AnimatePresence>
        {showVoidConfirm && (
          <motion.div
            className="arch-confirm-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div
              className="arch-confirm-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="arch-void-title"
              aria-describedby="arch-void-msg"
            >
              <div id="arch-void-title" className="arch-confirm-title">
                INITIATE VOID PROTOCOL?
              </div>
              <div id="arch-void-msg" className="arch-confirm-msg">
                Move {vaultLabel(activeVault)} protocol record into secured
                archive.
              </div>
              <div className="arch-confirm-btns">
                <button
                  className="arch-confirm-yes"
                  onClick={confirmVoidProtocol}
                >
                  CONFIRM
                </button>
                <button
                  className="arch-confirm-no"
                  onClick={() => setShowVoidConfirm(false)}
                >
                  CANCEL
                </button>
              </div>
            </div>
          </motion.div>
        )}
        {revokeConfirmId && (
          <motion.div
            className="arch-confirm-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div
              className="arch-confirm-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="arch-revoke-title"
              aria-describedby="arch-revoke-msg"
            >
              <div id="arch-revoke-title" className="arch-confirm-title">
                REVOKE THIS CODE?
              </div>
              <div id="arch-revoke-msg" className="arch-confirm-msg">
                Immediate and cannot be undone. Anyone holding this code
                loses access right away.
              </div>
              <div className="arch-confirm-btns">
                <button
                  className="arch-confirm-yes"
                  onClick={() => {
                    handleRevokeCode(revokeConfirmId);
                    setRevokeConfirmId(null);
                  }}
                >
                  CONFIRM
                </button>
                <button
                  className="arch-confirm-no"
                  onClick={() => setRevokeConfirmId(null)}
                >
                  CANCEL
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {showPowerConfirm && (
          <motion.div
            className="arch-confirm-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div
              className="arch-confirm-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="arch-power-title"
              aria-describedby="arch-power-msg"
            >
              <div id="arch-power-title" className="arch-confirm-title">
                EXIT OPTIONS
              </div>
              <div id="arch-power-msg" className="arch-confirm-msg">
                Choose a destination for this session.
              </div>
              <div className="arch-confirm-btns">
                <button
                  className="arch-confirm-no"
                  onClick={handleExitToVaultView}
                >
                  VAULT VIEW
                </button>
                <button className="arch-confirm-yes" onClick={confirmPowerDown}>
                  EXIT SYSTEM
                </button>
                <button
                  className="arch-confirm-no"
                  onClick={() => setShowPowerConfirm(false)}
                >
                  CANCEL
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* The Signal panel */}
      <AnimatePresence>
        {showSignalPanel && (
          <motion.div
            className="signal-panel-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowSignalPanel(false);
            }}
          >
            <motion.div
              className="signal-panel"
              initial={{ scale: 0.92, y: 16 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.92, y: 16 }}
              transition={{ duration: 0.25 }}
            >
              <div className="signal-panel-header">
                <span className="signal-panel-title">THE SIGNAL</span>
                {signalLive && (
                  <span className="signal-panel-live-badge">
                    <span className="signal-live-dot" aria-hidden="true" /> LIVE
                  </span>
                )}
              </div>

              <div className="signal-panel-field">
                <label className="signal-panel-label">BROADCAST TITLE</label>
                <input
                  className="signal-panel-input"
                  value={signalTitle}
                  onChange={(e) => setSignalTitle(e.target.value)}
                  placeholder="SOUL PLEASANT LIVE SESSION"
                  maxLength={64}
                  disabled={signalLive}
                  spellCheck={false}
                />
              </div>

              <div className="signal-panel-field">
                <label className="signal-panel-label">
                  OBS SETTINGS (D ONLY)
                </label>
                <div className="signal-panel-mono">
                  <div>SERVER: rtmps://live.cloudflare.com:443/live/</div>
                  <div
                    className="signal-panel-key-row"
                    role="button"
                    tabIndex={0}
                    onClick={() => setStreamKeyRevealed((v) => !v)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setStreamKeyRevealed((v) => !v);
                      }
                    }}
                    aria-label={
                      streamKeyRevealed
                        ? "Stream key revealed — click to hide"
                        : "Stream key hidden — click to reveal"
                    }
                    title={
                      streamKeyRevealed
                        ? "Click to hide"
                        : "Click to reveal stream key"
                    }
                    style={{ cursor: "pointer" }}
                  >
                    KEY:{" "}
                    {streamKeyRevealed
                      ? "dede7aa1a5039f9d121f59e924369990"
                      : "●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●"}
                  </div>
                </div>
              </div>

              <div className="signal-panel-actions">
                {!signalLive ? (
                  <button
                    className="signal-panel-go"
                    onClick={handleGoLive}
                    disabled={signalWorking}
                  >
                    {signalWorking ? "CONNECTING…" : "GO LIVE"}
                  </button>
                ) : (
                  <button
                    className="signal-panel-end"
                    onClick={handleEndSignal}
                    disabled={signalWorking}
                  >
                    {signalWorking ? "ENDING…" : "END SIGNAL"}
                  </button>
                )}
                <button
                  className="signal-panel-close"
                  onClick={() => setShowSignalPanel(false)}
                >
                  {signalLive ? "MINIMISE" : "CANCEL"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {isBroadcasting && !showSignalPanel && (
        <button
          className="arch-broadcast-pulse"
          role="status"
          onClick={() => setShowSignalPanel(true)}
          aria-label="The Signal is live — click to manage"
        >
          <span className="signal-live-dot" aria-hidden="true" /> THE SIGNAL IS
          LIVE
        </button>
      )}
    </motion.div>
  );
}

export default ArchitectConsole;
