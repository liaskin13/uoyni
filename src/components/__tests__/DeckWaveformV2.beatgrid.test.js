// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

import DeckWaveformV2 from "../DeckWaveformV2";

// Regression test for a REAL, previously-unverified safety mechanism: the
// beatgrid anchor editor (drag/insert/keyboard-nudge) must be blocked while
// the deck is playing — this is the entire reason it exists (avoids audible
// glitches from loop/quantize math recalculating mid-playback, per TODOS.md
// and the plan's D15/pause-gate decision). Ship's coverage audit found this
// had zero verification despite being the feature's stated safety rationale.

function setupMediaAndObserverMocks() {
  // Reduced-motion=true stops the component's rAF draw loop from starting,
  // so tests don't need to mock requestAnimationFrame — one synchronous
  // draw() call happens on mount and then the loop never schedules again.
  window.matchMedia = vi.fn(() => ({
    matches: true,
    media: "",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

function renderWaveform(props = {}) {
  const defaults = {
    waveformData: null,
    currentTime: 10,
    duration: 240,
    trackId: "track-1",
    width: 800,
    height: 200,
    bpm: 120,
    beatGridPoints: [
      { time: 10, bpm: 120 },
      { time: 40, bpm: 140 },
    ],
    onBeatGridPointsChange: vi.fn(),
    getIsPlaying: () => false,
  };
  const merged = { ...defaults, ...props };
  const utils = render(React.createElement(DeckWaveformV2, merged));
  const canvas = utils.container.querySelector("canvas");
  // jsdom's getBoundingClientRect returns all-zero by default; xToTime()
  // divides by rect.width, so double-click/drag tests need a real size.
  canvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 800,
    height: 200,
    right: 800,
    bottom: 200,
  });
  return { ...utils, canvas, onBeatGridPointsChange: merged.onBeatGridPointsChange };
}

beforeEach(() => {
  setupMediaAndObserverMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DeckWaveformV2 — pause-required safety gate (previously unverified)", () => {
  it("blocks keyboard arrow-nudge while playing — never calls onBeatGridPointsChange", () => {
    const { canvas, onBeatGridPointsChange } = renderWaveform({
      getIsPlaying: () => true,
    });
    // Select an anchor first via '[' / ']', then attempt to nudge it.
    fireEvent.keyDown(canvas, { key: "]" });
    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    expect(onBeatGridPointsChange).not.toHaveBeenCalled();
  });

  it("allows keyboard arrow-nudge while paused — calls onBeatGridPointsChange", () => {
    const { canvas, onBeatGridPointsChange } = renderWaveform({
      getIsPlaying: () => false,
    });
    fireEvent.keyDown(canvas, { key: "]" }); // select first anchor
    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    expect(onBeatGridPointsChange).toHaveBeenCalledTimes(1);
  });

  it("blocks double-click insert while playing — never calls onBeatGridPointsChange", () => {
    const { canvas, onBeatGridPointsChange } = renderWaveform({
      getIsPlaying: () => true,
    });
    fireEvent.doubleClick(canvas, { clientX: 400, clientY: 20 });
    expect(onBeatGridPointsChange).not.toHaveBeenCalled();
  });

  it("allows double-click insert while paused — calls onBeatGridPointsChange", () => {
    const { canvas, onBeatGridPointsChange } = renderWaveform({
      getIsPlaying: () => false,
      beatGridPoints: [{ time: 10, bpm: 120 }], // sparse grid, empty space to insert into
    });
    fireEvent.doubleClick(canvas, { clientX: 600, clientY: 20 });
    expect(onBeatGridPointsChange).toHaveBeenCalledTimes(1);
  });
});

describe("DeckWaveformV2 — keyboard anchor navigation", () => {
  it("'[' and ']' cycle the selected anchor without mutating the grid", () => {
    const { canvas, onBeatGridPointsChange } = renderWaveform();
    fireEvent.keyDown(canvas, { key: "]" });
    fireEvent.keyDown(canvas, { key: "]" });
    fireEvent.keyDown(canvas, { key: "[" });
    // Cycling alone never calls the change callback — only a nudge does.
    expect(onBeatGridPointsChange).not.toHaveBeenCalled();
  });

  it("ArrowRight nudges the selected anchor forward by one beat", () => {
    const { canvas, onBeatGridPointsChange } = renderWaveform({
      beatGridPoints: [{ time: 10, bpm: 120 }, { time: 40, bpm: 140 }],
    });
    fireEvent.keyDown(canvas, { key: "]" }); // selects index 0 (time: 10, bpm 120 -> 0.5s/beat)
    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    const updated = onBeatGridPointsChange.mock.calls[0][0];
    expect(updated[0].time).toBeCloseTo(10.5, 5);
  });

  it("ArrowLeft nudges the selected anchor backward by one beat", () => {
    const { canvas, onBeatGridPointsChange } = renderWaveform({
      beatGridPoints: [{ time: 10, bpm: 120 }, { time: 40, bpm: 140 }],
    });
    fireEvent.keyDown(canvas, { key: "]" });
    fireEvent.keyDown(canvas, { key: "ArrowLeft" });
    const updated = onBeatGridPointsChange.mock.calls[0][0];
    expect(updated[0].time).toBeCloseTo(9.5, 5);
  });

  it("Shift+ArrowRight nudges by one bar (4 beats) instead of one beat", () => {
    const { canvas, onBeatGridPointsChange } = renderWaveform({
      beatGridPoints: [{ time: 10, bpm: 120 }, { time: 40, bpm: 140 }],
    });
    fireEvent.keyDown(canvas, { key: "]" });
    fireEvent.keyDown(canvas, { key: "ArrowRight", shiftKey: true });
    const updated = onBeatGridPointsChange.mock.calls[0][0];
    expect(updated[0].time).toBeCloseTo(12.0, 5); // 10 + 4*0.5s
  });

  it("clamps the nudge so an anchor can never cross its neighbor", () => {
    // Anchor 0 at time:10, neighbor at time:10.6 — one beat forward (0.5s)
    // would land at 10.5, still valid; two more nudges would try to cross.
    const { canvas, onBeatGridPointsChange } = renderWaveform({
      beatGridPoints: [{ time: 10, bpm: 120 }, { time: 10.6, bpm: 120 }],
    });
    fireEvent.keyDown(canvas, { key: "]" });
    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    const lastCall = onBeatGridPointsChange.mock.calls.at(-1)[0];
    expect(lastCall[0].time).toBeLessThan(10.6);
  });

  it("does nothing when no anchor is selected yet", () => {
    const { canvas, onBeatGridPointsChange } = renderWaveform();
    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    expect(onBeatGridPointsChange).not.toHaveBeenCalled();
  });

  it("does nothing when there are no grid points at all", () => {
    const { canvas, onBeatGridPointsChange } = renderWaveform({ beatGridPoints: [] });
    fireEvent.keyDown(canvas, { key: "]" });
    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    expect(onBeatGridPointsChange).not.toHaveBeenCalled();
  });
});

describe("DeckWaveformV2 — double-click insert", () => {
  it("does not insert on top of an existing anchor (hit-test blocks it)", () => {
    // No waveformData -> xToTime falls back to a synthetic 1000-bar timeline
    // with the full track visible (early playback position clamps the
    // viewport to start=0), so screen-x maps linearly to time: time =
    // (clientX / width) * duration. For the anchor at time:10 out of a
    // 240s track at 800px width: clientX = (10/240)*800 ≈ 33.
    const { canvas, onBeatGridPointsChange } = renderWaveform({
      currentTime: 10,
      duration: 240,
      beatGridPoints: [{ time: 10, bpm: 120 }],
    });
    fireEvent.doubleClick(canvas, { clientX: 33, clientY: 20 });
    expect(onBeatGridPointsChange).not.toHaveBeenCalled();
  });

  it("does nothing when onBeatGridPointsChange is not provided (read-only mode)", () => {
    const { canvas } = renderWaveform({ onBeatGridPointsChange: undefined });
    expect(() =>
      fireEvent.doubleClick(canvas, { clientX: 600, clientY: 20 }),
    ).not.toThrow();
  });
});
