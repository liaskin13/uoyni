// Streaming audio engine — a native HTMLAudioElement handles playback for
// almost the whole track. When an active loop region is WAV-decoded and
// ready (see loopEngine.js), playback inside that region hands off to a
// sample-accurate Web Audio AudioBufferSourceNode instead, so the loop
// repeats natively with zero JS involvement per cycle — genuinely gapless,
// not just a fast JS-driven seek. Everywhere outside an active loop region,
// the HTMLAudioElement is unchanged from before.
//
// getState()/seek()/play()/pause()/setVolume() are mode-aware: they
// transparently delegate to whichever engine currently owns playback, so
// none of the ~15 existing call sites across the console (bar-skip, hot-cue
// jump, arrow-key seek, waveform click/drag, etc. — all funnel through
// ArchitectConsole.jsx's handleSeek) need to know or care which one is
// active.

import * as loopEngine from "./loopEngine";

let audio = null;
let _volume = 0.85;
let stateListeners = [];

// Kept for Safari compat — creates AudioContext in gesture scope. Shared by
// useAudioAnalyzer.js's live FFT tap AND, now, the loop engine's buffer
// playback — both must use this same context (a second context would desync
// output-latency compensation used elsewhere).
let _audioCtx = null;

// Registered once by useAudioAnalyzer.js after it creates its analyser
// graph, so the loop engine's buffer source can feed the same VU/spectrum/
// phase-correlation meters instead of going silent during a loop.
let _analyserGraph = null; // { analyser, splitter, lAnalyser, rAnalyser }

// The currently-applied loop region, or null. Kept here (in addition to
// ArchitectConsole's own React state, which drives the loop-region overlay
// prop into DeckWaveformV2) because playback-routing decisions need to be
// made synchronously from plain function calls, not from React state.
let _loopRegion = null;

function getAudio() {
  if (!audio) {
    audio = new Audio();
    audio.volume = _volume;
    audio.preload = "metadata";
    audio.addEventListener("ended", () => notifyListeners());
    audio.addEventListener("pause", () => notifyListeners());
    audio.addEventListener("play", () => notifyListeners());
    audio.addEventListener("timeupdate", () => notifyListeners());
    audio.addEventListener("durationchange", () => notifyListeners());
  }
  return audio;
}

function notifyListeners() {
  const state = getState();
  stateListeners.forEach((fn) => {
    try { fn(state); } catch (e) { console.error("[audioEngine] listener error:", e); }
  });
}

export function getState() {
  if (loopEngine.isActive()) {
    const s = loopEngine.getState(_audioCtx);
    if (s) return s;
  }
  const a = audio;
  const dur = a ? (isFinite(a.duration) ? a.duration : 0) : 0;
  return {
    isPlaying: a ? !a.paused && !a.ended : false,
    duration: dur,
    currentTime: a ? a.currentTime : 0,
  };
}

export function onStateChange(fn) {
  stateListeners.push(fn);
  return () => {
    stateListeners = stateListeners.filter((f) => f !== fn);
  };
}

export async function load(url) {
  const a = getAudio();
  // A stale loop region from the previous track is not just cosmetic once
  // the loop engine holds real per-track resources (a decoded AudioBuffer
  // tied to a specific URL, byte offsets computed against a specific WAV
  // header) — reusing it against a new track would play the wrong audio.
  teardownActiveLoop();
  loopEngine.discard();
  _loopRegion = null;
  a.pause();
  a.crossOrigin = "anonymous";
  a.src = url;
  a.currentTime = 0;
  notifyListeners();

  await new Promise((resolve, reject) => {
    const onMeta = () => { cleanup(); resolve(); };
    const onErr = () => {
      console.error("[audioEngine] load error:", url);
      cleanup();
      reject(new Error(`Audio load failed: ${url}`));
    };
    const cleanup = () => {
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("error", onErr);
    };
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("error", onErr);
    a.load();
  });

  notifyListeners();
}

export function play() {
  const a = getAudio();
  if (!a.src) return;
  if (_audioCtx?.state === 'suspended') _audioCtx.resume();
  if (loopEngine.isActive()) {
    loopEngine.resume({ audioCtx: _audioCtx, analyserGraph: _analyserGraph });
    notifyListeners();
    return;
  }
  a.play().catch((e) => console.warn("[audioEngine] play blocked:", e.message));
}

export function pause() {
  if (loopEngine.isActive()) {
    loopEngine.pause(_audioCtx);
    notifyListeners();
    return;
  }
  if (!audio) return;
  audio.pause();
}

export function stop() {
  teardownActiveLoop();
  if (!audio) return;
  audio.pause();
  audio.currentTime = 0;
  notifyListeners();
}

export function seek(seconds) {
  if (!audio) return;
  const clamped = Math.max(0, Math.min(seconds, audio.duration || 0));
  if (
    loopEngine.isActive() && _loopRegion &&
    clamped >= _loopRegion.start && clamped < _loopRegion.end
  ) {
    // Landing inside the same active loop region — reposition within the
    // buffer engine, no need to hand back to the <audio> element at all.
    loopEngine.seekWithinLoop(clamped - _loopRegion.start, {
      audioCtx: _audioCtx, analyserGraph: _analyserGraph,
    });
    notifyListeners();
    return;
  }
  if (loopEngine.isActive()) teardownActiveLoop();
  audio.currentTime = clamped;
  notifyListeners();
  maybeEngageBuffer();
}

export function setVolume(v) {
  _volume = Math.max(0, Math.min(1, v));
  if (audio) audio.volume = _volume;
  loopEngine.setVolume(_volume); // no-op if no active gain node — fanned out unconditionally so a volume change right at a mode transition is never lost
}

export function getVolume() {
  return _volume;
}

export function isLoaded() {
  return !!(audio && audio.src && audio.readyState >= 1);
}

// Creates/resumes the shared AudioContext inside user gesture scope.
// Must be called from a click handler so the context starts RUNNING, not suspended.
// useAudioAnalyzer reads this same context via getAudioContext() — sharing prevents
// the "new context created outside gesture scope → suspended → silence" bug.
export function prewarm() {
  if (!_audioCtx) {
    try {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (_) {}
  }
  if (_audioCtx?.state === 'suspended') {
    _audioCtx.resume().catch(() => {});
  }
}

// Returns the shared AudioContext singleton for the live FFT side-chain tap
// and the loop engine's buffer playback — both must share this one context.
export function getAudioContext() {
  return _audioCtx;
}

// Not used — waveform-driven meters in useAudioAnalyzer.js don't need this.
export function getAnalyser() {
  return null;
}

// Returns the module-level HTMLAudioElement singleton, or null if not yet created.
// Used by useAudioAnalyzer's live FFT side-chain tap (createMediaElementSource).
export function getAudioElement() {
  return audio;
}

// Called once by useAudioAnalyzer.js right after it builds its analyser
// graph, so the loop engine's buffer source can connect into the SAME
// VU/spectrum/phase-correlation chain rather than the meters going dark
// while a loop plays.
export function registerAnalyserGraph(nodes) {
  _analyserGraph = nodes;
}

export function getAnalyserGraph() {
  return _analyserGraph;
}

export function getCurrentUrl() {
  return audio ? audio.src : null;
}

// Pure — the single source of truth for "who owns time X right now."
// Exported for direct unit testing; this is the highest-leverage test target
// in the whole loop-engine feature.
export function resolvePlaybackMode(targetTimeSec, loopRegion, loopEngineReady) {
  if (!loopRegion || loopRegion.start == null || loopRegion.end == null) return "element";
  if (loopRegion.end <= loopRegion.start) return "element";
  if (!loopEngineReady) return "element";
  return targetTimeSec >= loopRegion.start && targetTimeSec < loopRegion.end ? "buffer" : "element";
}

function engageBufferMode(offsetIntoLoop) {
  const a = getAudio();
  a.pause();
  loopEngine.start(offsetIntoLoop, { audioCtx: _audioCtx, analyserGraph: _analyserGraph });
  notifyListeners();
}

function teardownActiveLoop() {
  if (!loopEngine.isActive()) return;
  const state = loopEngine.getState(_audioCtx);
  const wasPlaying = state ? state.isPlaying : false;
  const absTime = state ? state.currentTime : (_loopRegion ? _loopRegion.start : 0);
  loopEngine.stop();
  const a = getAudio();
  a.currentTime = Math.max(0, Math.min(absTime, a.duration || 0));
  if (wasPlaying) a.play().catch((e) => console.warn("[audioEngine] play blocked:", e.message));
  notifyListeners();
}

// If a loop region is set, the buffer is ready for it, and we're currently
// playing at a time inside it, hand playback to the buffer engine. Called
// right after setLoopRegion() (so applying a loop that's already decoded —
// e.g. re-entering a region just cleared — engages immediately) and again
// once an in-flight prepare() resolves.
function maybeEngageBuffer() {
  if (!_loopRegion || !audio) return;
  if (loopEngine.isActive()) return;
  const ct = audio.currentTime;
  const playing = !audio.paused && !audio.ended;
  if (!playing) return;
  const mode = resolvePlaybackMode(ct, _loopRegion, loopEngine.isReadyFor(_loopRegion));
  if (mode === "buffer") engageBufferMode(ct - _loopRegion.start);
}

export function setLoopRegion(region) {
  teardownActiveLoop();
  const valid = region && region.start != null && region.end != null && region.end > region.start;
  _loopRegion = valid ? { start: region.start, end: region.end } : null;
  if (!_loopRegion) return;
  const url = getCurrentUrl();
  if (url && audio && _audioCtx) {
    const appliedRegion = _loopRegion;
    loopEngine
      .prepare({ url, start: appliedRegion.start, end: appliedRegion.end, fullDuration: audio.duration, audioCtx: _audioCtx })
      .then(() => {
        if (_loopRegion === appliedRegion) maybeEngageBuffer();
      });
  }
  maybeEngageBuffer();
}

export function clearLoopRegion() {
  teardownActiveLoop();
  loopEngine.discard();
  _loopRegion = null;
}

// Called every rAF tick from ArchitectConsole's startLoopEnforcement.
// Handles both the safety-net hard-seek (before the buffer is ready, or
// permanently for non-WAV/unsupported tracks) and the buffer-mode entry
// trigger. Self-quiescing: once buffer mode is engaged, getState() reports
// a currentTime wrapped within the loop region — it structurally can never
// reach loopRegion.end again, so this becomes a no-op automatically without
// any explicit "pause enforcement while in buffer mode" coordination.
export function enforceLoop(loopRegion) {
  if (!loopRegion || loopRegion.start == null || loopRegion.end == null) return;
  const { currentTime: ct, isPlaying: playing } = getState();
  if (!playing) return;
  if (loopEngine.isActive()) return;
  if (ct >= loopRegion.end) {
    seek(loopRegion.start);
    return;
  }
  if (resolvePlaybackMode(ct, loopRegion, loopEngine.isReadyFor(loopRegion)) === "buffer") {
    engageBufferMode(ct - loopRegion.start);
  }
}
