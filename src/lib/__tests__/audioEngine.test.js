// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../config", () => ({
  UPLOAD_WORKER_URL: "https://psc-worker.example.com",
  UPLOAD_SECRET: "test-secret",
}));

vi.mock("../loopEngine", () => ({
  isActive: vi.fn(() => false),
  isReadyFor: vi.fn(() => false),
  getState: vi.fn(() => null),
  start: vi.fn(),
  stop: vi.fn(),
  discard: vi.fn(),
  prepare: vi.fn(() => Promise.resolve()),
  setVolume: vi.fn(),
  resume: vi.fn(),
  pause: vi.fn(),
  seekWithinLoop: vi.fn(),
}));

import * as audioEngine from "../audioEngine";
import * as loopEngine from "../loopEngine";

// ── resolvePlaybackMode — pure, the single highest-leverage test target ────

describe("resolvePlaybackMode", () => {
  it("returns 'element' for a null loop region", () => {
    expect(audioEngine.resolvePlaybackMode(1.5, null, true)).toBe("element");
  });

  it("returns 'element' when start or end is null", () => {
    expect(audioEngine.resolvePlaybackMode(1.5, { start: null, end: 2 }, true)).toBe("element");
    expect(audioEngine.resolvePlaybackMode(1.5, { start: 1, end: null }, true)).toBe("element");
  });

  it("returns 'element' for a malformed region (end <= start)", () => {
    expect(audioEngine.resolvePlaybackMode(1.5, { start: 2, end: 1 }, true)).toBe("element");
    expect(audioEngine.resolvePlaybackMode(1.5, { start: 2, end: 2 }, true)).toBe("element");
  });

  it("returns 'element' when the loop engine isn't ready for this region yet", () => {
    expect(audioEngine.resolvePlaybackMode(1.5, { start: 1, end: 2 }, false)).toBe("element");
  });

  it("returns 'buffer' exactly at the start boundary (inclusive)", () => {
    expect(audioEngine.resolvePlaybackMode(1.0, { start: 1, end: 2 }, true)).toBe("buffer");
  });

  it("returns 'element' exactly at the end boundary (exclusive)", () => {
    expect(audioEngine.resolvePlaybackMode(2.0, { start: 1, end: 2 }, true)).toBe("element");
  });

  it("returns 'buffer' mid-region", () => {
    expect(audioEngine.resolvePlaybackMode(1.5, { start: 1, end: 2 }, true)).toBe("buffer");
  });

  it("returns 'element' before the region starts", () => {
    expect(audioEngine.resolvePlaybackMode(0.5, { start: 1, end: 2 }, true)).toBe("element");
  });

  it("returns 'element' after the region ends", () => {
    expect(audioEngine.resolvePlaybackMode(2.5, { start: 1, end: 2 }, true)).toBe("element");
  });
});

// ── Mode-aware getState/seek/play/pause + enforceLoop — fake <audio> element ─
// jsdom's HTMLMediaElement doesn't implement real playback, so we stub the
// global Audio constructor with a controllable fake (same idea as
// waveformAnalyzer.test.js stubbing global.AudioContext) to drive audioEngine
// through load/play/pause/seek deterministically.

function installFakeAudioElement() {
  const listeners = {};
  const fire = (evt) => (listeners[evt] || []).forEach((fn) => fn());
  const fake = {
    _paused: true,
    _currentTime: 0,
    _duration: 100,
    _ended: false,
    src: "",
    volume: 1,
    crossOrigin: null,
    preload: "",
    readyState: 1,
    get paused() { return this._paused; },
    get currentTime() { return this._currentTime; },
    set currentTime(v) { this._currentTime = v; fire("timeupdate"); },
    get duration() { return this._duration; },
    get ended() { return this._ended; },
    addEventListener: (evt, fn) => { (listeners[evt] ||= []).push(fn); },
    removeEventListener: (evt, fn) => {
      if (!listeners[evt]) return;
      listeners[evt] = listeners[evt].filter((f) => f !== fn);
    },
    load: () => queueMicrotask(() => fire("loadedmetadata")),
    play: vi.fn(function () {
      this._paused = false;
      fire("play");
      return Promise.resolve();
    }),
    pause: vi.fn(function () {
      this._paused = true;
      fire("pause");
    }),
  };
  // Arrow functions can't be used as constructors at all ("not a
  // constructor" under `new`) — must be a plain function that returns the
  // fake object, which `new` then uses in place of `this` per JS semantics.
  global.Audio = vi.fn(function AudioConstructor() { return fake; });
  return fake;
}

describe("audioEngine — mode-aware playback routing", () => {
  // audioEngine.js is an ESM singleton — its internal `audio` element
  // persists across tests within this file unless the module registry is
  // reset and re-imported fresh each time. Shadows the outer static
  // imports for this describe block only.
  let audioEngine, loopEngine, fakeAudio;

  beforeEach(async () => {
    vi.resetModules();
    fakeAudio = installFakeAudioElement();
    // setLoopRegion() only calls loopEngine.prepare() once its internal
    // AudioContext singleton exists — in production that's populated by
    // prewarm() on the first user gesture. A minimal fake stands in here
    // so the prepare-flow tests below can actually exercise that branch.
    global.AudioContext = vi.fn(function () {
      return { state: "running", resume: () => Promise.resolve(), currentTime: 0 };
    });
    loopEngine = await import("../loopEngine");
    loopEngine.isActive.mockReturnValue(false);
    loopEngine.isReadyFor.mockReturnValue(false);
    loopEngine.getState.mockReturnValue(null);
    audioEngine = await import("../audioEngine");
    audioEngine.prewarm();
    await audioEngine.load("https://example.com/track.wav");
    audioEngine.clearLoopRegion();
    // load()/clearLoopRegion() themselves make real calls during setup
    // (load() calls audio.pause() to stop any previous playback; teardown
    // touches the loopEngine mock) — clear call history now so test bodies'
    // toHaveBeenCalled() assertions only see what THEY triggered. Does NOT
    // reset the mockReturnValue() config set above.
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete global.Audio;
    delete global.AudioContext;
  });

  it("getState() falls back to the element's live state when no loop is active", () => {
    fakeAudio._currentTime = 12.5;
    fakeAudio._paused = false;
    const state = audioEngine.getState();
    expect(state).toEqual({ isPlaying: true, duration: 100, currentTime: 12.5 });
  });

  it("getState() delegates to the loop engine when it's active", () => {
    loopEngine.isActive.mockReturnValue(true);
    loopEngine.getState.mockReturnValue({ isPlaying: true, currentTime: 1.42, duration: 100 });
    expect(audioEngine.getState()).toEqual({ isPlaying: true, currentTime: 1.42, duration: 100 });
  });

  it("seek() writes audio.currentTime directly when no loop is active", () => {
    audioEngine.seek(30);
    expect(fakeAudio._currentTime).toBe(30);
  });

  it("seek() clamps to [0, duration]", () => {
    audioEngine.seek(-5);
    expect(fakeAudio._currentTime).toBe(0);
    audioEngine.seek(9999);
    expect(fakeAudio._currentTime).toBe(100);
  });

  it("seek() inside an active loop region repositions the buffer engine, not the element", () => {
    audioEngine.setLoopRegion({ start: 10, end: 12 });
    loopEngine.isActive.mockReturnValue(true);
    const before = fakeAudio._currentTime;
    audioEngine.seek(11);
    expect(loopEngine.seekWithinLoop).toHaveBeenCalledWith(1, expect.any(Object));
    expect(fakeAudio._currentTime).toBe(before); // element untouched
  });

  it("seek() outside an active loop region tears the loop down and seeks the element", () => {
    audioEngine.setLoopRegion({ start: 10, end: 12 });
    loopEngine.isActive.mockReturnValue(true);
    loopEngine.getState.mockReturnValue({ isPlaying: true, currentTime: 10.5, duration: 100 });
    audioEngine.seek(50);
    expect(loopEngine.stop).toHaveBeenCalled();
    expect(fakeAudio._currentTime).toBe(50);
  });

  it("play() delegates to loopEngine.resume() when a loop is active", () => {
    loopEngine.isActive.mockReturnValue(true);
    audioEngine.play();
    expect(loopEngine.resume).toHaveBeenCalled();
    expect(fakeAudio.play).not.toHaveBeenCalled();
  });

  it("play() calls the element normally when no loop is active", () => {
    audioEngine.play();
    expect(fakeAudio.play).toHaveBeenCalled();
    expect(loopEngine.resume).not.toHaveBeenCalled();
  });

  it("pause() delegates to loopEngine.pause() when a loop is active", () => {
    loopEngine.isActive.mockReturnValue(true);
    audioEngine.pause();
    expect(loopEngine.pause).toHaveBeenCalled();
    expect(fakeAudio.pause).not.toHaveBeenCalled();
  });

  it("setVolume() fans out to both the element and the loop engine unconditionally", () => {
    audioEngine.setVolume(0.5);
    expect(fakeAudio.volume).toBe(0.5);
    expect(loopEngine.setVolume).toHaveBeenCalledWith(0.5);
  });

  it("load() clears any active loop region from the previous track", async () => {
    audioEngine.setLoopRegion({ start: 1, end: 2 });
    loopEngine.isActive.mockReturnValue(true);
    await audioEngine.load("https://example.com/other-track.wav");
    expect(loopEngine.stop).toHaveBeenCalled();
    expect(loopEngine.discard).toHaveBeenCalled();
  });

  it("getCurrentUrl() reflects the loaded track's src", () => {
    expect(audioEngine.getCurrentUrl()).toBe("https://example.com/track.wav");
  });

  it("registerAnalyserGraph()/getAnalyserGraph() round-trip the nodes useAudioAnalyzer.js builds", () => {
    const nodes = { analyser: {}, splitter: {}, lAnalyser: {}, rAnalyser: {} };
    audioEngine.registerAnalyserGraph(nodes);
    expect(audioEngine.getAnalyserGraph()).toBe(nodes);
  });

  it("clearLoopRegion() discards the loop engine and drops the region — a later seek into the old bounds goes straight to the element", () => {
    audioEngine.setLoopRegion({ start: 10, end: 12 });
    loopEngine.isActive.mockReturnValue(true);
    audioEngine.clearLoopRegion();
    expect(loopEngine.discard).toHaveBeenCalled();
    // Region is gone — isActive() now legitimately reports false post-clear,
    // so a seek that used to land inside [10,12) just seeks the element.
    loopEngine.isActive.mockReturnValue(false);
    audioEngine.seek(11);
    expect(fakeAudio._currentTime).toBe(11);
    expect(loopEngine.seekWithinLoop).not.toHaveBeenCalled();
  });

  it("setLoopRegion() calls loopEngine.prepare() with the resolved url/region/duration", () => {
    audioEngine.setLoopRegion({ start: 5, end: 7 });
    expect(loopEngine.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.com/track.wav",
        start: 5,
        end: 7,
        fullDuration: 100,
      }),
    );
  });

  it("setLoopRegion() with an invalid region (end <= start) does not call prepare()", () => {
    audioEngine.setLoopRegion({ start: 7, end: 5 });
    expect(loopEngine.prepare).not.toHaveBeenCalled();
  });

  it("engages buffer mode once an in-flight prepare() resolves, if still playing inside the region", async () => {
    let resolvePrepare;
    loopEngine.prepare.mockReturnValue(new Promise((res) => { resolvePrepare = res; }));
    fakeAudio._paused = false;
    fakeAudio._currentTime = 6;
    audioEngine.setLoopRegion({ start: 5, end: 7 });
    // Not ready yet — the synchronous maybeEngageBuffer() call inside
    // setLoopRegion() must not have engaged anything.
    expect(loopEngine.start).not.toHaveBeenCalled();
    loopEngine.isReadyFor.mockReturnValue(true); // as if the awaited prepare() just finished decoding
    resolvePrepare();
    await Promise.resolve();
    await Promise.resolve();
    expect(loopEngine.start).toHaveBeenCalledWith(expect.closeTo(1, 5), expect.any(Object));
  });

  it("a stale prepare() resolution superseded by a newer setLoopRegion() call does not engage", async () => {
    let resolveFirst;
    loopEngine.prepare.mockReturnValueOnce(new Promise((res) => { resolveFirst = res; }));
    fakeAudio._paused = false;
    fakeAudio._currentTime = 6; // inside the FIRST region only
    audioEngine.setLoopRegion({ start: 5, end: 7 });
    audioEngine.setLoopRegion({ start: 10, end: 12 }); // supersedes before the first prepare() resolves
    loopEngine.isReadyFor.mockReturnValue(true);
    resolveFirst(); // the stale, superseded prepare() finally resolves
    await Promise.resolve();
    await Promise.resolve();
    expect(loopEngine.start).not.toHaveBeenCalled();
  });
});

describe("audioEngine.enforceLoop", () => {
  let audioEngine, loopEngine, fakeAudio;

  beforeEach(async () => {
    vi.resetModules();
    fakeAudio = installFakeAudioElement();
    loopEngine = await import("../loopEngine");
    loopEngine.isActive.mockReturnValue(false);
    loopEngine.isReadyFor.mockReturnValue(false);
    loopEngine.getState.mockReturnValue(null);
    audioEngine = await import("../audioEngine");
    await audioEngine.load("https://example.com/track.wav");
    audioEngine.clearLoopRegion();
    // load()/clearLoopRegion() themselves make real calls during setup
    // (load() calls audio.pause() to stop any previous playback; teardown
    // touches the loopEngine mock) — clear call history now so test bodies'
    // toHaveBeenCalled() assertions only see what THEY triggered. Does NOT
    // reset the mockReturnValue() config set above.
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete global.Audio;
  });

  it("does nothing when the region is null", () => {
    audioEngine.enforceLoop(null);
    expect(fakeAudio._currentTime).toBe(0);
  });

  it("does nothing while paused, even past loopRegion.end", () => {
    fakeAudio._paused = true;
    fakeAudio._currentTime = 5;
    audioEngine.enforceLoop({ start: 1, end: 2 });
    expect(fakeAudio._currentTime).toBe(5);
  });

  it("hard-seeks back to start when playing and past end, but the buffer isn't ready (fallback path)", () => {
    fakeAudio._paused = false;
    fakeAudio._currentTime = 2.05;
    loopEngine.isReadyFor.mockReturnValue(false);
    audioEngine.enforceLoop({ start: 1, end: 2 });
    expect(fakeAudio._currentTime).toBe(1);
  });

  it("engages buffer mode instead of hard-seeking once the buffer is ready and currentTime enters the region", () => {
    fakeAudio._paused = false;
    fakeAudio._currentTime = 1.3;
    loopEngine.isReadyFor.mockReturnValue(true);
    audioEngine.enforceLoop({ start: 1, end: 2 });
    expect(loopEngine.start).toHaveBeenCalledWith(expect.closeTo(0.3, 5), expect.any(Object));
    // Never fell through to a hard seek on the element.
    expect(fakeAudio._currentTime).toBe(1.3);
  });

  it("is a no-op once the loop engine is already active — self-quiescing", () => {
    loopEngine.isActive.mockReturnValue(true);
    fakeAudio._paused = false;
    fakeAudio._currentTime = 1.9;
    audioEngine.enforceLoop({ start: 1, end: 2 });
    expect(loopEngine.start).not.toHaveBeenCalled();
    expect(fakeAudio._currentTime).toBe(1.9); // untouched — buffer engine owns time now
  });
});
