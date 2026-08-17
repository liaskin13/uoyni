// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

import DeckWaveformV2 from "../DeckWaveformV2";

// Regression coverage for the drag-resync fix (found + fixed this session
// alongside the gapless loop engine; verified only via live browser QA
// until now, per the coverage audit that flagged it). While dragging the
// waveform to scrub, something outside the drag can move the real
// playhead — loop enforcement forcing a hard seek back to loopRegion.start,
// or the buffer engine engaging mid-drag. Without a resync, the drag's
// local running total (seekedTimeRef) goes stale and the next mousemove
// frame jumps by however far the external code moved the playhead, on top
// of the drag delta. See DeckWaveformV2.jsx's handleMouseMove and the
// DRAG_RESYNC_EPSILON_SEC (0.05s) constant.

function setupMediaAndObserverMocks() {
  // Reduced-motion=true stops the component's rAF draw loop from starting,
  // so tests don't need to mock requestAnimationFrame — same pattern as
  // DeckWaveformV2.beatgrid.test.js.
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
    onSeek: vi.fn(),
    getTime: () => 10,
  };
  const merged = { ...defaults, ...props };
  const utils = render(React.createElement(DeckWaveformV2, merged));
  const canvas = utils.container.querySelector("canvas");
  // jsdom's getBoundingClientRect returns all-zero by default; the drag
  // math divides by rect.width, so it needs a real size.
  canvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 800,
    height: 200,
    right: 800,
    bottom: 200,
  });
  return { ...utils, canvas, onSeek: merged.onSeek };
}

afterEach(() => {
  cleanup();
});

describe("DeckWaveformV2 — drag resync against external playhead moves", () => {
  it("resyncs the running drag total from getTime() when it drifts beyond the epsilon mid-drag", () => {
    setupMediaAndObserverMocks();
    let liveTime = 10;
    const { canvas, onSeek } = renderWaveform({ getTime: () => liveTime });

    fireEvent.mouseDown(canvas, { clientX: 400 });
    // First move: no external drift yet — ordinary drag math applies.
    // barCount defaults to 1000 (no waveformData), zoom=1, BARS_PER_SEC=50
    // => secondsVisible=20; dt = -(dx/800)*20 = -dx/40.
    fireEvent.mouseMove(canvas, { clientX: 390 }); // dx=-10 => dt=+0.25
    expect(onSeek).toHaveBeenLastCalledWith(expect.closeTo(10.25, 5));

    // Something external (loop enforcement) jumps the real playhead far
    // away mid-drag — well beyond the 0.05s resync epsilon.
    liveTime = 50;

    fireEvent.mouseMove(canvas, { clientX: 380 }); // dx=-10 => dt=+0.25
    // Without the resync fix this lands at 10.5 (stale local total + delta).
    // With it, the local total resyncs to the live 50 first.
    expect(onSeek).toHaveBeenLastCalledWith(expect.closeTo(50.25, 5));
  });

  it("does not resync for ordinary sub-epsilon lag between an issued seek and the live playhead", () => {
    setupMediaAndObserverMocks();
    let liveTime = 10;
    const { canvas, onSeek } = renderWaveform({ getTime: () => liveTime });

    fireEvent.mouseDown(canvas, { clientX: 400 });
    fireEvent.mouseMove(canvas, { clientX: 390 }); // -> seekedTimeRef=10.25
    // Playhead lags slightly behind the just-issued seek — normal
    // seek()->audio-element roundtrip latency, under the 0.05s epsilon
    // relative to the drag's own running total (10.25), not the original
    // currentTime prop (10).
    liveTime = 10.27;
    fireEvent.mouseMove(canvas, { clientX: 380 }); // dt=+0.25 again
    // Continues from the local running total (10.25), NOT from liveTime.
    expect(onSeek).toHaveBeenLastCalledWith(expect.closeTo(10.5, 5));
  });
});
