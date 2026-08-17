// Sample-accurate, gapless loop playback for a small (loop-length) slice of
// audio, decoded once and repeated natively via AudioBufferSourceNode.loop —
// zero JS involvement per repeat cycle, which is what makes this genuinely
// gapless (as opposed to the JS-polling seek-based fallback in
// ArchitectConsole.jsx's startLoopEnforcement). Orchestrated by
// audioEngine.js, which decides WHEN this engine should own playback; this
// module owns only the mechanics: fetch+decode the slice, snap the loop
// edges to a matching pair of zero-crossings, and manage the
// AudioBufferSourceNode/GainNode lifecycle — including manual pause/resume
// bookkeeping, since buffer source nodes have no native pause.
//
// Deliberately has NO import of audioEngine.js (no circular dependency,
// zero coupling): every AudioContext/analyser-graph value it needs is
// passed in explicitly by the caller on each call.
//
// WAV-only: matches every existing precedent in this codebase (chunked
// waveform analysis is WAV-only for the same 800MB+ OOM-avoidance reason).
// Non-WAV tracks make prepare() a no-op and isReadyFor() permanently false,
// so they fall through forever to the already-shipped rAF hard-seek
// fallback in ArchitectConsole.jsx — not a regression, just a scope boundary.

import { fetchWavHeader, fetchWavPcmRange } from "./waveformAnalyzer";

const ZERO_CROSSING_SEARCH_SEC = 0.01; // ±10ms search window per edge
const DECODE_PAD_SEC = 0.02; // extra slice fetched each side so the search window always has real samples, even right at start=0 or end=duration

// Live-tunable, no redeploy needed — same pattern as DeckWaveformV2.jsx's
// psc_beat_offset_bars. In the browser console:
// localStorage.setItem('psc_debug_loop_edges', '1')
// Clear with: localStorage.removeItem('psc_debug_loop_edges')
function isEdgeLoggingEnabled() {
  try {
    return localStorage.getItem("psc_debug_loop_edges") === "1";
  } catch (_) {
    return false;
  }
}

let _preparedFor = null; // { url, start, end }
let _prepared = false;
let _prepareError = null;
let _audioBuffer = null; // decoded, edge-snapped AudioBuffer — spans exactly the loop
let _fullDuration = 0;

let _sourceNode = null;
let _gainNode = null;
let _startedAtCtxTime = 0; // audioCtx.currentTime when the current node was started
let _startedAtBufferOffset = 0; // seconds into _audioBuffer where playback began
let _pausedOffset = null; // seconds into _audioBuffer, set on pause() — null while running
let _engaged = false; // true from start() until stop()/discard() — independent of running vs paused
let _volume = 1;

// Finds a matched pair of zero-crossing sample indices near nominalStartIdx
// and nominalEndIdx — pure, exported for direct unit testing.
//
// Independently snapping each edge to ITS OWN nearest zero-crossing changes
// the loop's length by a few ms — and since native .loop repeats forever
// with zero JS re-correction per cycle, that error compounds every single
// cycle. At 128 BPM a 2-beat loop (~0.94s) held for 100s (~106 cycles) with
// even ~5ms/cycle drift accumulates to ~500ms against a second deck. So
// this searches candidates near BOTH edges, then picks the pair that (a)
// crosses in the same slope direction (independently-snapped opposite-slope
// edges leave a derivative "kink" — subtler than a click, still audible on
// transient material) and (b) minimizes the loop-length delta from the
// original nominal length, with combined quietness as a tie-break.
export function findMatchedZeroCrossings(channels, nominalStartIdx, nominalEndIdx, searchWindow) {
  const length = channels[0].length;
  const clampIdx = (i) => Math.max(1, Math.min(length - 1, i));

  const magAt = (i) => {
    let m = 0;
    for (const ch of channels) {
      const v = Math.abs(ch[i]);
      if (v > m) m = v;
    }
    return m;
  };
  const slopeAt = (i) => {
    let best = 0, bestMag = -1;
    for (const ch of channels) {
      const d = ch[i] - ch[i - 1];
      const m = Math.abs(d);
      if (m > bestMag) { bestMag = m; best = d; }
    }
    return best >= 0 ? 1 : -1;
  };

  const candidatesNear = (center) => {
    const lo = clampIdx(center - searchWindow);
    const hi = clampIdx(center + searchWindow);
    const list = [];
    for (let i = lo; i <= hi; i++) {
      list.push({ idx: i, mag: magAt(i), slope: slopeAt(i) });
    }
    list.sort((a, b) => a.mag - b.mag);
    return list;
  };

  const startCandidates = candidatesNear(nominalStartIdx);
  const endCandidates = candidatesNear(nominalEndIdx);
  const nominalLength = nominalEndIdx - nominalStartIdx;

  // Bound the pair search to the quietest few candidates on each side —
  // keeps this O(K^2) instead of O(searchWindow^2), plenty for a ±10ms window.
  const topStart = startCandidates.slice(0, Math.min(8, startCandidates.length));
  const topEnd = endCandidates.slice(0, Math.min(8, endCandidates.length));

  let best = null;
  for (const s of topStart) {
    for (const e of topEnd) {
      if (s.slope !== e.slope) continue;
      const lengthDelta = Math.abs((e.idx - s.idx) - nominalLength);
      const combinedMag = s.mag + e.mag;
      if (
        !best ||
        lengthDelta < best.lengthDelta ||
        (lengthDelta === best.lengthDelta && combinedMag < best.combinedMag)
      ) {
        best = { startIdx: s.idx, endIdx: e.idx, lengthDelta, combinedMag };
      }
    }
  }
  if (!best) {
    // No same-slope pair in-window (pathological/very short window) —
    // degrade to closest-to-zero independently rather than fail the loop.
    // This is the one case where a residual click is still possible (the
    // splice may not land on a true zero-crossing) — usedFallback lets the
    // caller log it, so a post-deploy "still clicks" report has a concrete
    // loop point to point at instead of a guess.
    best = { startIdx: startCandidates[0].idx, endIdx: endCandidates[0].idx };
    return { startIdx: best.startIdx, endIdx: best.endIdx, usedFallback: true };
  }
  return { startIdx: best.startIdx, endIdx: best.endIdx, usedFallback: false };
}

export function isReadyFor(region) {
  return !!(
    _prepared && _preparedFor && region &&
    _preparedFor.start === region.start && _preparedFor.end === region.end
  );
}

// True from start() until stop()/discard() — independent of whether the
// underlying node is currently running or paused. This is what
// audioEngine.js checks to know "who owns playback right now."
export function isActive() {
  return _engaged;
}

export function getPrepareError() {
  return _prepareError;
}

export async function prepare({ url, start, end, fullDuration, audioCtx }) {
  if (!url || !/\.wav$/i.test(url) || !audioCtx) {
    discard();
    return;
  }
  if (
    _preparedFor && _preparedFor.url === url &&
    _preparedFor.start === start && _preparedFor.end === end
  ) {
    return; // already prepared, or an identical prepare() is already in flight
  }
  const region = { url, start, end };
  _preparedFor = region;
  _prepared = false;
  _prepareError = null;
  _fullDuration = fullDuration;
  try {
    const header = await fetchWavHeader(url);
    const padStart = Math.max(0, start - DECODE_PAD_SEC);
    const padEnd = Math.min(fullDuration, end + DECODE_PAD_SEC);
    const startByte = header.dataOffset + Math.floor(padStart * header.sampleRate) * header.frameSize;
    const endByte = header.dataOffset + Math.ceil(padEnd * header.sampleRate) * header.frameSize - 1;
    const { channels } = await fetchWavPcmRange(url, header, startByte, endByte);

    const nominalStartIdx = Math.round((start - padStart) * header.sampleRate);
    const nominalEndIdx = Math.round((end - padStart) * header.sampleRate);
    const searchWindow = Math.max(1, Math.round(ZERO_CROSSING_SEARCH_SEC * header.sampleRate));
    const { startIdx, endIdx, usedFallback } = findMatchedZeroCrossings(
      channels, nominalStartIdx, nominalEndIdx, searchWindow,
    );
    if (usedFallback && isEdgeLoggingEnabled()) {
      console.warn(
        "[loopEngine] no true zero-crossing pair found within the search window — " +
          "degraded to closest-to-zero, a residual click at this loop point is possible.",
        { url, start, end, snappedStartIdx: startIdx, snappedEndIdx: endIdx },
      );
    }

    const frameCount = endIdx - startIdx;
    if (frameCount <= 0) throw new Error("loop region resolved to zero-length after edge snapping");
    const buffer = audioCtx.createBuffer(channels.length, frameCount, header.sampleRate);
    for (let ch = 0; ch < channels.length; ch++) {
      buffer.copyToChannel(channels[ch].subarray(startIdx, endIdx), ch);
    }

    // A newer prepare() may have superseded this one while we were awaiting.
    if (_preparedFor !== region) return;
    _audioBuffer = buffer;
    _prepared = true;
  } catch (err) {
    if (_preparedFor === region) _prepareError = err;
  }
}

function connectNode(node, audioCtx, analyserGraph) {
  const gain = audioCtx.createGain();
  gain.gain.value = _volume;
  node.connect(gain);
  gain.connect(audioCtx.destination);
  if (analyserGraph) {
    gain.connect(analyserGraph.analyser);
    gain.connect(analyserGraph.splitter);
  }
  return gain;
}

function teardownNode() {
  if (_sourceNode) {
    try { _sourceNode.stop(); } catch (_) {}
    try { _sourceNode.disconnect(); } catch (_) {}
  }
  try { _gainNode?.disconnect(); } catch (_) {}
  _sourceNode = null;
  _gainNode = null;
}

export function start(offsetIntoLoop, { audioCtx, analyserGraph }) {
  if (!_prepared || !_audioBuffer || !audioCtx) return false;
  teardownNode(); // never leak a running node
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  const node = audioCtx.createBufferSource();
  node.buffer = _audioBuffer;
  node.loop = true;
  node.loopStart = 0;
  node.loopEnd = _audioBuffer.duration;
  const gain = connectNode(node, audioCtx, analyserGraph);
  const dur = _audioBuffer.duration;
  const wrapped = ((offsetIntoLoop % dur) + dur) % dur;
  node.start(0, wrapped);
  _sourceNode = node;
  _gainNode = gain;
  _startedAtCtxTime = audioCtx.currentTime;
  _startedAtBufferOffset = wrapped;
  _pausedOffset = null;
  _engaged = true;
  return true;
}

// Buffer source nodes can't seek in place — reposition by tearing down and
// starting a fresh node at the new offset. Still gapless in the sense that
// matters here: this only happens on an explicit user seek (hot cue, drag,
// arrow key), never mid-cycle of the native loop repeat itself.
export function seekWithinLoop(offsetIntoLoop, opts) {
  return start(offsetIntoLoop, opts);
}

function currentBufferOffset(audioCtx) {
  if (!_audioBuffer) return 0;
  if (_pausedOffset != null) return _pausedOffset;
  if (!_sourceNode || !audioCtx) return 0;
  const dur = _audioBuffer.duration;
  const elapsed = audioCtx.currentTime - _startedAtCtxTime;
  const raw = _startedAtBufferOffset + elapsed;
  return ((raw % dur) + dur) % dur;
}

export function pause(audioCtx) {
  if (!_engaged || !_sourceNode) return;
  const offset = currentBufferOffset(audioCtx);
  teardownNode();
  _pausedOffset = offset;
}

export function resume(opts) {
  if (!_engaged || _pausedOffset == null) return false;
  const offset = _pausedOffset;
  _pausedOffset = null;
  return start(offset, opts);
}

export function stop() {
  teardownNode();
  _pausedOffset = null;
  _engaged = false;
}

export function discard() {
  stop();
  _preparedFor = null;
  _prepared = false;
  _prepareError = null;
  _audioBuffer = null;
  _fullDuration = 0;
}

export function getState(audioCtx) {
  if (!_engaged || !_preparedFor) return null;
  const offset = currentBufferOffset(audioCtx);
  return {
    isPlaying: _sourceNode !== null,
    currentTime: _preparedFor.start + offset,
    duration: _fullDuration,
  };
}

export function setVolume(v) {
  _volume = v;
  if (_gainNode) _gainNode.gain.value = v;
}
