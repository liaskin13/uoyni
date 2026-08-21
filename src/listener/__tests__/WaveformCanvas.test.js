// @vitest-environment jsdom
//
// Regression test for a real crash the 2026-08-21 guest-flow re-audit caught:
// handleMainClick's useCallback deps array referenced performSeekFromEvent
// before that const was declared three lines later — a temporal-dead-zone
// ReferenceError on every single render. No test existed for this component
// at all, which is exactly how it went undetected. Not a hypothetical: this
// is the component WaveformImg falls back to whenever a track has no
// pre-rendered PNG (or the image fails to load), which is a real, tracked
// gap per TODOS.md, not a rare edge case.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

import { WaveformCanvas } from "../ListenerVaultView";

function setupObserverMock() {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

describe("WaveformCanvas", () => {
  it("mounts without throwing (onSeek present — this is the exact path that crashed)", () => {
    setupObserverMock();
    const track = { id: "t1", waveform_data: null };
    expect(() => {
      render(
        React.createElement(WaveformCanvas, {
          track,
          currentTime: 0,
          duration: 120,
          onSeek: vi.fn(),
        }),
      );
    }).not.toThrow();
    cleanup();
  });

  it("mounts without throwing in ghost (paused, static-bars) mode", () => {
    setupObserverMock();
    const track = { id: "t2", waveform_data: null };
    expect(() => {
      render(
        React.createElement(WaveformCanvas, {
          track,
          currentTime: 0,
          duration: 120,
          ghost: true,
          onSeek: vi.fn(),
        }),
      );
    }).not.toThrow();
    cleanup();
  });

  it("mounts without throwing with onSeek absent", () => {
    setupObserverMock();
    const track = { id: "t3", waveform_data: null };
    expect(() => {
      render(
        React.createElement(WaveformCanvas, {
          track,
          currentTime: 0,
          duration: 120,
        }),
      );
    }).not.toThrow();
    cleanup();
  });
});
