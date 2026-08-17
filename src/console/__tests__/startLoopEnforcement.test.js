// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

vi.mock("../../config", () => ({
  UPLOAD_WORKER_URL: "https://psc-worker.example.com",
  UPLOAD_SECRET: "test-secret",
  VAULT_DISPLAY_NAMES: { saturn: "ORIGINAL MUSIC", venus: "MIXES", mercury: "LIVE SETS", earth: "SONIC ARCH" },
  VAULT_ACCENT_COLORS: { saturn: "#fff", venus: "#fff", mercury: "#fff", earth: "#fff" },
  LOCKBOX_PREFIX: "lockbox_",
  R2_PUBLIC_URL: "https://r2.example.com",
}));

import { startLoopEnforcement } from "../ArchitectConsole";

// Fake engine: currentTime advances in real (ms) time regardless of whether
// anything "notified" — mirrors the real HTMLAudioElement, where .currentTime
// is always live but the "timeupdate" event that used to drive this check
// only fires every 15-250ms (WHATWG spec). enforceLoop() here reproduces
// just the hard-seek fallback path of audioEngine.js's real enforceLoop —
// enough to prove startLoopEnforcement still drives it every rAF frame;
// the buffer-mode-engage half of the real enforceLoop is covered directly
// in src/lib/__tests__/audioEngine.test.js, not duplicated here.
function makeFakeEngine({ startAt = 0 } = {}) {
  let t = startAt;
  let playing = true;
  const seekCalls = [];
  return {
    enforceLoop: (loopRegion) => {
      if (playing && t >= loopRegion.end) {
        seekCalls.push({ at: t, to: loopRegion.start });
        t = loopRegion.start;
      }
    },
    advance: (ms) => { t += ms / 1000; },
    setPlaying: (v) => { playing = v; },
    seekCalls,
  };
}

// Manual rAF stub: each call to the returned "raf" queues the callback;
// tests drive frames explicitly with runFrame() instead of real timers, so
// the assertions are about per-frame reaction, not wall-clock flakiness.
function makeManualRaf() {
  let pending = null;
  return {
    raf: (cb) => { pending = cb; return 1; },
    caf: () => { pending = null; },
    runFrame: () => { const cb = pending; pending = null; if (cb) cb(); },
  };
}

describe("startLoopEnforcement", () => {
  it("seeks back to loopRegion.start on the very next frame after crossing loopRegion.end", () => {
    const engine = makeFakeEngine({ startAt: 1.99 });
    const loopActiveRef = { current: true };
    const { raf, caf, runFrame } = makeManualRaf();

    startLoopEnforcement({ start: 1.0, end: 2.0 }, loopActiveRef, engine, raf, caf);

    // First frame: still before loopRegion.end — no seek yet.
    runFrame();
    expect(engine.seekCalls).toEqual([]);

    // Advance past the boundary by one display-refresh frame (~16ms) — well
    // under the 15-250ms (measured ~265ms avg) window the old
    // timeupdate-driven code relied on and would have missed this crossing
    // within. The next rAF frame must still catch it.
    engine.advance(16);
    runFrame();

    expect(engine.seekCalls).toEqual([{ at: expect.closeTo(2.006, 2), to: 1.0 }]);
  });

  it("does not seek while paused, even past loopRegion.end", () => {
    const engine = makeFakeEngine({ startAt: 2.5 });
    engine.setPlaying(false);
    const loopActiveRef = { current: true };
    const { raf, caf, runFrame } = makeManualRaf();

    startLoopEnforcement({ start: 1.0, end: 2.0 }, loopActiveRef, engine, raf, caf);
    runFrame();

    expect(engine.seekCalls).toEqual([]);
  });

  it("does not seek once loopActiveRef.current is cleared (CLR button)", () => {
    const engine = makeFakeEngine({ startAt: 2.5 });
    const loopActiveRef = { current: false };
    const { raf, caf, runFrame } = makeManualRaf();

    startLoopEnforcement({ start: 1.0, end: 2.0 }, loopActiveRef, engine, raf, caf);
    runFrame();

    expect(engine.seekCalls).toEqual([]);
  });

  it("stops polling once the returned cleanup function is called", () => {
    const engine = makeFakeEngine({ startAt: 2.5 });
    const loopActiveRef = { current: true };
    const { raf, caf, runFrame } = makeManualRaf();
    const cafSpy = vi.fn(caf);

    const stop = startLoopEnforcement({ start: 1.0, end: 2.0 }, loopActiveRef, engine, raf, cafSpy);
    stop();

    expect(cafSpy).toHaveBeenCalledOnce();
    // No further frame was queued after cleanup — driving one is a no-op.
    runFrame();
    expect(engine.seekCalls).toEqual([]);
  });
});
