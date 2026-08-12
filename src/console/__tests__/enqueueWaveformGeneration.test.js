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

import { enqueueWaveformGeneration } from "../ArchitectConsole";

describe("enqueueWaveformGeneration", () => {
  it("pushes the track onto the queue ref and triggers the runner", () => {
    const queueRef = { current: [] };
    const runQueueFn = vi.fn();
    const track = { id: "track-1", audio_path: "x.mp3" };

    enqueueWaveformGeneration(track, queueRef, runQueueFn);

    expect(queueRef.current).toEqual([track]);
    expect(runQueueFn).toHaveBeenCalledOnce();
  });

  it("does not call ensureWaveformForTrack directly — only queues and runs", () => {
    // The regression this fix exists to prevent: a direct call bypasses the
    // sequential queue and opens one concurrent AudioContext per track on a
    // multi-file drop. This test asserts the observable contract (push +
    // trigger) rather than reaching into the module for a call spy, since
    // ensureWaveformForTrack isn't itself exported for testing.
    const queueRef = { current: [] };
    const runQueueFn = vi.fn();

    enqueueWaveformGeneration({ id: "a" }, queueRef, runQueueFn);
    enqueueWaveformGeneration({ id: "b" }, queueRef, runQueueFn);

    expect(queueRef.current.map((t) => t.id)).toEqual(["a", "b"]);
    expect(runQueueFn).toHaveBeenCalledTimes(2);
  });

  it("preserves an existing queue rather than overwriting it", () => {
    const existing = { id: "already-queued" };
    const queueRef = { current: [existing] };
    const runQueueFn = vi.fn();

    enqueueWaveformGeneration({ id: "new" }, queueRef, runQueueFn);

    expect(queueRef.current).toEqual([existing, { id: "new" }]);
  });
});
