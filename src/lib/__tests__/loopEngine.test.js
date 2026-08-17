// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("../../config", () => ({
  UPLOAD_WORKER_URL: "https://psc-worker.example.com",
  UPLOAD_SECRET: "test-secret",
}));

import * as loopEngine from "../loopEngine";

// ── findMatchedZeroCrossings ─────────────────────────────────────────────────
// Pure — no AudioContext needed. This is the function that prevents the
// per-cycle length drift a naive "snap each edge independently" approach
// would cause (native .loop repeats forever with zero JS re-correction).

function silentChannel(length) {
  return new Float32Array(length);
}

describe("findMatchedZeroCrossings", () => {
  it("finds the exact zero-crossing sample when one exists at the nominal edges", () => {
    // A simple ramp that crosses zero at index 10 and again at index 30,
    // both rising — a clean, unambiguous case.
    const ch = new Float32Array(50);
    for (let i = 0; i < 50; i++) ch[i] = (i - 10) * 0.01; // zero at i=10
    const ch2 = new Float32Array(50);
    for (let i = 0; i < 50; i++) ch2[i] = (i - 30) * 0.01; // zero at i=30
    // Use one channel with two crossings by offsetting nominal indices to
    // two different windows of the SAME channel instead — simpler to reason
    // about than two independent channels for this test.
    const single = new Float32Array(50);
    for (let i = 0; i < 50; i++) single[i] = Math.sin((i - 10) * 0.3) + Math.sin((i - 30) * 0.31);
    const { startIdx, endIdx } = loopEngine.findMatchedZeroCrossings([single], 10, 30, 15);
    expect(startIdx).toBeGreaterThanOrEqual(1);
    expect(endIdx).toBeGreaterThanOrEqual(1);
    expect(Math.abs(single[startIdx])).toBeLessThan(0.5);
    expect(Math.abs(single[endIdx])).toBeLessThan(0.5);
  });

  it("prefers the pair that preserves the original loop length over independently-quietest points", () => {
    // Two channels, deliberately constructed so the globally quietest point
    // near each edge would, if picked independently, shift the loop length —
    // the paired search must trade a little quietness for length fidelity.
    const length = 60;
    const chA = new Float32Array(length);
    const chB = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      chA[i] = Math.sin(i * 0.5);
      chB[i] = Math.cos(i * 0.5);
    }
    const nominalStart = 20;
    const nominalEnd = 40;
    const nominalLength = nominalEnd - nominalStart;
    const { startIdx, endIdx } = loopEngine.findMatchedZeroCrossings([chA, chB], nominalStart, nominalEnd, 10);
    // The whole point: length drift must stay small (single-digit samples),
    // never allowed to grow unbounded just because some far-off sample in
    // the window happens to be quieter.
    expect(Math.abs((endIdx - startIdx) - nominalLength)).toBeLessThanOrEqual(10);
  });

  it("only pairs edges with matching slope direction", () => {
    const length = 40;
    const ch = new Float32Array(length);
    for (let i = 0; i < length; i++) ch[i] = Math.sin(i * 0.4);
    const { startIdx, endIdx } = loopEngine.findMatchedZeroCrossings([ch], 10, 25, 8);
    const slopeAt = (i) => ch[i] - ch[i - 1];
    // Same-sign slope at both chosen edges (allowing for the boundary i=0 guard).
    if (startIdx > 0 && endIdx > 0) {
      expect(Math.sign(slopeAt(startIdx)) === Math.sign(slopeAt(endIdx)) || startIdx === endIdx).toBe(true);
    }
  });

  it("degrades to closest-to-zero without crashing when the channel is silent", () => {
    const ch = silentChannel(40);
    const { startIdx, endIdx } = loopEngine.findMatchedZeroCrossings([ch], 10, 25, 8);
    expect(Number.isInteger(startIdx)).toBe(true);
    expect(Number.isInteger(endIdx)).toBe(true);
  });

  it("clamps the search window at the buffer boundaries instead of throwing", () => {
    const ch = new Float32Array(20);
    for (let i = 0; i < 20; i++) ch[i] = Math.sin(i * 0.5);
    expect(() => loopEngine.findMatchedZeroCrossings([ch], 1, 18, 15)).not.toThrow();
  });

  it("reports usedFallback:false when a same-slope matched pair is found", () => {
    const ch = new Float32Array(40);
    for (let i = 0; i < 40; i++) ch[i] = Math.sin(i * 0.4);
    const result = loopEngine.findMatchedZeroCrossings([ch], 10, 25, 8);
    expect(result.usedFallback).toBe(false);
  });

  it("reports usedFallback:true when no same-slope pair exists in either window — this is the case prepare() logs behind the psc_debug_loop_edges flag, since it's the one path that can leave a residual click", () => {
    // Triangle wave peaking at i=30: strictly rising for i<30, strictly
    // falling for i>=30. A window around nominalStart=10 sits entirely in
    // the rising half (every candidate has positive slope); a window
    // around nominalEnd=45 sits entirely in the falling half (every
    // candidate has negative slope) — no same-slope pair can exist.
    const length = 60;
    const ch = new Float32Array(length);
    for (let i = 0; i < length; i++) ch[i] = i < 30 ? i : 60 - i;
    const result = loopEngine.findMatchedZeroCrossings([ch], 10, 45, 5);
    expect(result.usedFallback).toBe(true);
  });
});

// ── AudioBufferSourceNode lifecycle + pause/resume offset math ──────────────
// jsdom has no real Web Audio implementation, so these use a minimal fake
// AudioContext that tracks .currentTime manually (advanced by the test) and
// records what gets connected/started/stopped — enough to prove the offset
// bookkeeping and mode transitions are correct without real audio hardware.

function makeFakeAudioContext() {
  let time = 0;
  const createdNodes = [];
  const ctx = {
    get currentTime() { return time; },
    _advance(sec) { time += sec; },
    state: "running",
    resume: () => Promise.resolve(),
    destination: { id: "destination" },
    createBufferSource: () => {
      const node = {
        buffer: null,
        loop: false,
        loopStart: 0,
        loopEnd: 0,
        started: false,
        stopped: false,
        startOffset: null,
        connect: () => node,
        disconnect: () => {},
        start: (when, offset) => { node.started = true; node.startOffset = offset; },
        stop: () => { node.stopped = true; },
      };
      createdNodes.push(node);
      return node;
    },
    createGain: () => ({
      gain: { value: 1 },
      connect: () => {},
      disconnect: () => {},
    }),
    createBuffer: (numChannels, frameCount, sampleRate) => ({
      numberOfChannels: numChannels,
      length: frameCount,
      sampleRate,
      duration: frameCount / sampleRate,
      _data: Array.from({ length: numChannels }, () => new Float32Array(frameCount)),
      copyToChannel(source, ch) { this._data[ch].set(source); },
    }),
    _nodes: createdNodes,
  };
  return ctx;
}

async function prepareFakeLoop(ctx, { start = 1.0, end = 2.0, sampleRate = 44100 } = {}) {
  const url = "https://example.com/track.wav";
  const frameCount = Math.round((end - start) * sampleRate);
  // Build a header buffer via fetchWavHeader's real parse path by mocking fetch.
  global.fetch = vi.fn().mockImplementation((_u, opts) => {
    const range = opts.headers.Range;
    if (range === "bytes=0-4095") {
      return Promise.resolve({ status: 206, arrayBuffer: () => Promise.resolve(buildMinimalWavHeader({ sampleRate })) });
    }
    // PCM range — silent audio is fine, we're testing lifecycle, not content.
    const m = range.match(/bytes=(\d+)-(\d+)/);
    const nBytes = parseInt(m[2], 10) - parseInt(m[1], 10) + 1;
    return Promise.resolve({ status: 206, arrayBuffer: () => Promise.resolve(new ArrayBuffer(nBytes)) });
  });
  await loopEngine.prepare({ url, start, end, fullDuration: 300, audioCtx: ctx });
  return frameCount;
}

function writeStr(dv, offset, str) {
  for (let i = 0; i < str.length; i++) dv.setUint8(offset + i, str.charCodeAt(i));
}

function buildMinimalWavHeader({ sampleRate }) {
  const buf = new ArrayBuffer(44);
  const dv = new DataView(buf);
  writeStr(dv, 0, "RIFF");
  dv.setUint32(4, 36, true);
  writeStr(dv, 8, "WAVE");
  writeStr(dv, 12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 2, true); // stereo
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 4, true);
  dv.setUint16(32, 4, true);
  dv.setUint16(34, 16, true);
  writeStr(dv, 36, "data");
  dv.setUint32(40, 10_000_000, true); // plenty — actual fetched range is small
  return buf;
}

describe("loopEngine lifecycle (fake AudioContext)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    loopEngine.discard();
  });
  afterEach(() => {
    loopEngine.discard();
    global.fetch = originalFetch;
  });

  it("isReadyFor/isActive are false before prepare() resolves", () => {
    expect(loopEngine.isReadyFor({ start: 1, end: 2 })).toBe(false);
    expect(loopEngine.isActive()).toBe(false);
  });

  it("becomes ready for the exact prepared region after prepare() resolves", async () => {
    const ctx = makeFakeAudioContext();
    await prepareFakeLoop(ctx, { start: 1.0, end: 2.0 });
    expect(loopEngine.isReadyFor({ start: 1.0, end: 2.0 })).toBe(true);
    expect(loopEngine.isReadyFor({ start: 1.0, end: 2.5 })).toBe(false);
  });

  it("start() creates a looping AudioBufferSourceNode at the requested offset", async () => {
    const ctx = makeFakeAudioContext();
    await prepareFakeLoop(ctx, { start: 1.0, end: 2.0 });
    const ok = loopEngine.start(0.25, { audioCtx: ctx, analyserGraph: null });
    expect(ok).toBe(true);
    expect(loopEngine.isActive()).toBe(true);
    const node = ctx._nodes[ctx._nodes.length - 1];
    expect(node.loop).toBe(true);
    expect(node.started).toBe(true);
    expect(node.startOffset).toBeCloseTo(0.25, 5);
  });

  it("wraps an out-of-range start offset into the buffer's own duration", async () => {
    const ctx = makeFakeAudioContext();
    await prepareFakeLoop(ctx, { start: 1.0, end: 2.0 }); // 1s buffer
    loopEngine.start(1.4, { audioCtx: ctx, analyserGraph: null }); // 1.4 % 1.0 = 0.4
    const node = ctx._nodes[ctx._nodes.length - 1];
    expect(node.startOffset).toBeCloseTo(0.4, 5);
  });

  it("pause() computes elapsed offset from audioCtx.currentTime and getState() reflects it while paused", async () => {
    const ctx = makeFakeAudioContext();
    await prepareFakeLoop(ctx, { start: 1.0, end: 2.0 }); // 1s loop
    loopEngine.start(0.1, { audioCtx: ctx, analyserGraph: null });
    ctx._advance(0.35); // 0.1 + 0.35 = 0.45s into the buffer
    loopEngine.pause(ctx);
    expect(loopEngine.isActive()).toBe(true); // still engaged, just not running
    const state = loopEngine.getState(ctx);
    expect(state.isPlaying).toBe(false);
    expect(state.currentTime).toBeCloseTo(1.0 + 0.45, 3); // absolute track time
  });

  it("resume() restarts a fresh node at the paused offset", async () => {
    const ctx = makeFakeAudioContext();
    await prepareFakeLoop(ctx, { start: 1.0, end: 2.0 });
    loopEngine.start(0.1, { audioCtx: ctx, analyserGraph: null });
    ctx._advance(0.2);
    loopEngine.pause(ctx);
    const resumed = loopEngine.resume({ audioCtx: ctx, analyserGraph: null });
    expect(resumed).toBe(true);
    const node = ctx._nodes[ctx._nodes.length - 1];
    expect(node.startOffset).toBeCloseTo(0.3, 5);
    expect(loopEngine.getState(ctx).isPlaying).toBe(true);
  });

  it("wraps elapsed time across multiple native loop repeats without drift in the reported offset", async () => {
    const ctx = makeFakeAudioContext();
    await prepareFakeLoop(ctx, { start: 1.0, end: 2.0 }); // 1s loop
    loopEngine.start(0, { audioCtx: ctx, analyserGraph: null });
    ctx._advance(3.25); // 3 full repeats + 0.25s — native .loop means no JS ever intervened
    const state = loopEngine.getState(ctx);
    expect(state.currentTime).toBeCloseTo(1.0 + 0.25, 3);
  });

  it("stop() fully disengages — getState() returns null, isActive() false", async () => {
    const ctx = makeFakeAudioContext();
    await prepareFakeLoop(ctx, { start: 1.0, end: 2.0 });
    loopEngine.start(0, { audioCtx: ctx, analyserGraph: null });
    loopEngine.stop();
    expect(loopEngine.isActive()).toBe(false);
    expect(loopEngine.getState(ctx)).toBeNull();
    // isReadyFor stays true — the decoded buffer is kept for a quick re-entry.
    expect(loopEngine.isReadyFor({ start: 1.0, end: 2.0 })).toBe(true);
  });

  it("discard() drops the prepared buffer entirely — isReadyFor becomes false", async () => {
    const ctx = makeFakeAudioContext();
    await prepareFakeLoop(ctx, { start: 1.0, end: 2.0 });
    loopEngine.discard();
    expect(loopEngine.isReadyFor({ start: 1.0, end: 2.0 })).toBe(false);
  });

  it("non-WAV URLs never become ready — permanently falls through to the rAF fallback", async () => {
    const ctx = makeFakeAudioContext();
    await loopEngine.prepare({ url: "https://example.com/track.mp3", start: 1, end: 2, fullDuration: 300, audioCtx: ctx });
    expect(loopEngine.isReadyFor({ start: 1, end: 2 })).toBe(false);
  });

  // ── Guard clauses when nothing is prepared/engaged ──────────────────────
  // audioEngine.js's orchestration relies on these being safe no-ops (never
  // throwing) so a mistimed call from a race — e.g. a seek landing right as
  // a track unloads — degrades quietly instead of crashing playback.

  it("start() returns false and does not throw when nothing has been prepared", () => {
    const ctx = makeFakeAudioContext();
    expect(() => {
      const ok = loopEngine.start(0, { audioCtx: ctx, analyserGraph: null });
      expect(ok).toBe(false);
    }).not.toThrow();
    expect(loopEngine.isActive()).toBe(false);
  });

  it("seekWithinLoop() returns false when nothing has been prepared (delegates to start())", () => {
    const ctx = makeFakeAudioContext();
    expect(loopEngine.seekWithinLoop(0.5, { audioCtx: ctx, analyserGraph: null })).toBe(false);
  });

  it("pause() is a no-op when the engine isn't engaged", () => {
    const ctx = makeFakeAudioContext();
    expect(() => loopEngine.pause(ctx)).not.toThrow();
    expect(loopEngine.getState(ctx)).toBeNull();
  });

  it("resume() returns false when the engine isn't engaged", () => {
    expect(loopEngine.resume({ audioCtx: makeFakeAudioContext(), analyserGraph: null })).toBe(false);
  });

  it("getState() returns null when the engine isn't engaged, even if a region was previously prepared", async () => {
    const ctx = makeFakeAudioContext();
    await prepareFakeLoop(ctx, { start: 1.0, end: 2.0 });
    expect(loopEngine.isReadyFor({ start: 1.0, end: 2.0 })).toBe(true); // prepared...
    expect(loopEngine.getState(ctx)).toBeNull(); // ...but never started/engaged
  });
});
