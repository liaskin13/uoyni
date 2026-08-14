// @vitest-environment node
import { describe, it, expect } from "vitest";

vi.mock("../../config", () => ({
  UPLOAD_WORKER_URL: "https://psc-worker.example.com",
  UPLOAD_SECRET: "test-secret",
}));

import {
  WAVEFORM_V2_SENTINEL,
  packToBinary,
  unpackFromBinary,
  analyzeAudio,
  computeDownbeatData,
} from "../waveformAnalyzer";
import { phaseWeightedBars } from "./genreFixtures";

// ── WAVEFORM_V2_SENTINEL ──────────────────────────────────────────────────────

describe("WAVEFORM_V2_SENTINEL", () => {
  it('is the string "v2"', () => {
    expect(WAVEFORM_V2_SENTINEL).toBe("v2");
  });
});

// ── packToBinary ──────────────────────────────────────────────────────────────

describe("packToBinary", () => {
  it("returns null for null input", () => {
    expect(packToBinary(null)).toBeNull();
  });

  it("returns null for empty array", () => {
    expect(packToBinary([])).toBeNull();
  });

  it("produces 4 bytes per bar", () => {
    const bars = [
      { bass: 0.5, mid: 0.5, high: 0.5, peak: 0.5 },
      { bass: 1.0, mid: 0.0, high: 1.0, peak: 1.0 },
    ];
    const result = packToBinary(bars);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(8);
  });

  it("maps 0.0 → 0 and 1.0 → 255", () => {
    const bars = [{ bass: 0.0, mid: 1.0, high: 0.0, peak: 1.0 }];
    const bytes = packToBinary(bars);
    expect(bytes[0]).toBe(0);   // bass=0.0
    expect(bytes[1]).toBe(255); // mid=1.0
    expect(bytes[2]).toBe(0);   // high=0.0
    expect(bytes[3]).toBe(255); // peak=1.0
  });

  it("clamps values that would exceed 255 (mid-value sanity)", () => {
    const bars = [{ bass: 0.5, mid: 0.5, high: 0.5, peak: 0.5 }];
    const bytes = packToBinary(bars);
    // 0.5 * 255 = 127.5 → rounds to 128
    expect(bytes[0]).toBe(128);
    expect(bytes[1]).toBe(128);
    expect(bytes[2]).toBe(128);
    expect(bytes[3]).toBe(128);
  });

  it("treats missing band fields as 0", () => {
    const bars = [{ peak: 0.8 }]; // bass/mid/high omitted
    const bytes = packToBinary(bars);
    expect(bytes[0]).toBe(0);   // bass defaulted
    expect(bytes[1]).toBe(0);   // mid defaulted
    expect(bytes[2]).toBe(0);   // high defaulted
    expect(bytes[3]).toBe(Math.round(0.8 * 255));
  });
});

// ── unpackFromBinary ──────────────────────────────────────────────────────────

describe("unpackFromBinary", () => {
  it("returns null for null input", () => {
    expect(unpackFromBinary(null)).toBeNull();
  });

  it("returns null when byte length is not a multiple of 4", () => {
    expect(unpackFromBinary(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(unpackFromBinary(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
  });

  it("returns an array of bars with 0-1 float values", () => {
    const bytes = new Uint8Array([0, 255, 0, 255]);
    const bars = unpackFromBinary(bytes);
    expect(bars).toHaveLength(1);
    expect(bars[0].bass).toBeCloseTo(0 / 255, 5);
    expect(bars[0].mid).toBeCloseTo(255 / 255, 5);
    expect(bars[0].high).toBeCloseTo(0 / 255, 5);
    expect(bars[0].peak).toBeCloseTo(255 / 255, 5);
  });

  it("produces one bar per 4 bytes", () => {
    const bytes = new Uint8Array(40); // 10 bars
    const bars = unpackFromBinary(bytes);
    expect(bars).toHaveLength(10);
  });

  it("all values are between 0 and 1 inclusive", () => {
    const bytes = new Uint8Array(Array.from({ length: 256 }, (_, i) => i % 256));
    const bars = unpackFromBinary(bytes);
    for (const b of bars) {
      expect(b.bass).toBeGreaterThanOrEqual(0);
      expect(b.bass).toBeLessThanOrEqual(1);
      expect(b.mid).toBeGreaterThanOrEqual(0);
      expect(b.mid).toBeLessThanOrEqual(1);
      expect(b.high).toBeGreaterThanOrEqual(0);
      expect(b.high).toBeLessThanOrEqual(1);
      expect(b.peak).toBeGreaterThanOrEqual(0);
      expect(b.peak).toBeLessThanOrEqual(1);
    }
  });
});

// ── pack / unpack round-trip ──────────────────────────────────────────────────

describe("packToBinary / unpackFromBinary round-trip", () => {
  it("recovers original values within uint8 quantization error (±1/255)", () => {
    const original = [
      { bass: 0.0,  mid: 1.0,  high: 0.5,  peak: 0.75 },
      { bass: 0.25, mid: 0.75, high: 0.1,  peak: 1.0  },
      { bass: 1.0,  mid: 0.0,  high: 0.9,  peak: 0.33 },
    ];

    const bytes    = packToBinary(original);
    const recovered = unpackFromBinary(bytes);

    const tol = 1 / 255;
    for (let i = 0; i < original.length; i++) {
      expect(recovered[i].bass).toBeCloseTo(original[i].bass, 2);
      expect(recovered[i].mid).toBeCloseTo(original[i].mid,   2);
      expect(recovered[i].high).toBeCloseTo(original[i].high, 2);
      expect(recovered[i].peak).toBeCloseTo(original[i].peak, 2);
      expect(Math.abs(recovered[i].bass - original[i].bass)).toBeLessThanOrEqual(tol + 1e-9);
      expect(Math.abs(recovered[i].mid  - original[i].mid )).toBeLessThanOrEqual(tol + 1e-9);
      expect(Math.abs(recovered[i].high - original[i].high)).toBeLessThanOrEqual(tol + 1e-9);
      expect(Math.abs(recovered[i].peak - original[i].peak)).toBeLessThanOrEqual(tol + 1e-9);
    }
  });

  it("preserves bar count across round-trip", () => {
    const bars = Array.from({ length: 50000 }, (_, i) => ({
      bass: (i % 256) / 255,
      mid:  ((i + 64) % 256) / 255,
      high: ((i + 128) % 256) / 255,
      peak: ((i + 192) % 256) / 255,
    }));
    const recovered = unpackFromBinary(packToBinary(bars));
    expect(recovered).toHaveLength(50000);
  });
});

// ── analyzeAudio — AudioContext lifecycle ───────────────────────────────────
//
// This test file runs in the node environment (see @vitest-environment above),
// which has no Web Audio API at all — global.fetch/AudioContext are mocked
// directly rather than relying on jsdom. No AudioContext mock pattern existed
// anywhere in this repo before this test; establishing one here.

function makeFakeAudioBuffer() {
  return {
    sampleRate: 44100,
    duration: 1,
    getChannelData: () => new Float32Array(1000).fill(0.1),
  };
}

function mockFetchOk() {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
  });
}

describe("analyzeAudio — AudioContext lifecycle", () => {
  const originalFetch = global.fetch;
  const originalAudioContext = global.AudioContext;

  afterEach(() => {
    global.fetch = originalFetch;
    global.AudioContext = originalAudioContext;
  });

  it("closes the AudioContext after a successful decode", async () => {
    mockFetchOk();
    const close = vi.fn();
    global.AudioContext = vi.fn(function FakeAudioContext() {
      this.decodeAudioData = vi.fn().mockResolvedValue(makeFakeAudioBuffer());
      this.close = close;
    });

    await analyzeAudio("https://example.com/track.mp3", null, 5, 5);

    expect(close).toHaveBeenCalledOnce();
  });

  it("closes the AudioContext even when decode throws", async () => {
    mockFetchOk();
    const close = vi.fn();
    global.AudioContext = vi.fn(function FakeAudioContext() {
      this.decodeAudioData = vi.fn().mockRejectedValue(new Error("corrupt audio data"));
      this.close = close;
    });

    await expect(
      analyzeAudio("https://example.com/track.mp3", null, 5, 5),
    ).rejects.toThrow("corrupt audio data");

    // This is the line that proves the fix — close() must fire in the
    // failure path too, not just the happy path.
    expect(close).toHaveBeenCalledOnce();
  });
});

// ── computeDownbeatData (PR2 Item 5 — flat-tempo vs drift-segment branching) ──
// phaseWeightedBars (bass strongly favors `downbeatPhase` mod 4) is shared
// with beatDetector.test.js — see genreFixtures.js. All calls below use the
// default bpm=120 (0.5s/beat).

describe("computeDownbeatData", () => {
  describe("flat tempo (tempoSegments === null)", () => {
    it("calls detectDownbeatPhase directly on detected.beatTimesSec and surfaces the result at the top level", () => {
      const { bars, beatTimesSec } = phaseWeightedBars({ numBeats: 12, downbeatPhase: 1 });
      const detected = { beatTimesSec };
      const result = computeDownbeatData(bars, detected, null, 6);
      expect(result.detectedDownbeatOffset).toBeCloseTo(beatTimesSec[1], 5);
      expect(result.detectedDownbeatConfidence).toBeGreaterThan(0.5);
      expect(result.tempoSegmentsWithDownbeat).toBeNull();
    });

    it("surfaces both fields as null when detectDownbeatPhase declines to guess", () => {
      const beatTimesSec = Array.from({ length: 12 }, (_, i) => i * 0.5);
      const flatBars = Array.from({ length: 400 }, () => ({ bass: 0.3 }));
      const detected = { beatTimesSec };
      const result = computeDownbeatData(flatBars, detected, null, 6);
      expect(result.detectedDownbeatOffset).toBeNull();
      expect(result.detectedDownbeatConfidence).toBeNull();
    });
  });

  describe("drift present (tempoSegments is an anchor array)", () => {
    it("top-level detectedDownbeatOffset/Confidence stay null — that data lives on the anchors instead", () => {
      const { bars } = phaseWeightedBars({ numBeats: 12, downbeatPhase: 0 });
      const tempoSegments = [{ time: 0, bpm: 120 }];
      const result = computeDownbeatData(bars, { beatTimesSec: [] }, tempoSegments, 6);
      expect(result.detectedDownbeatOffset).toBeNull();
      expect(result.detectedDownbeatConfidence).toBeNull();
    });

    it("an interior anchor's segment end is the NEXT anchor's time, not duration", () => {
      // Anchor 0 spans [0, 5) at 120bpm (10 beats — clears MIN_DOWNBEAT_BEATS=8);
      // anchor 1 spans [5, duration=10) at 120bpm (also 10 beats). Downbeat
      // phase 2 (strong bass) throughout — both anchors should find it, each
      // within its own segment's synthesized grid.
      const { bars } = phaseWeightedBars({ numBeats: 22, downbeatPhase: 2 });
      const tempoSegments = [
        { time: 0, bpm: 120 },
        { time: 5, bpm: 120 },
      ];
      const result = computeDownbeatData(bars, { beatTimesSec: [] }, tempoSegments, 10);
      expect(result.tempoSegmentsWithDownbeat).toHaveLength(2);
      const [first, second] = result.tempoSegmentsWithDownbeat;
      expect(first.downbeatOffset).toBeDefined();
      expect(second.downbeatOffset).toBeDefined();
      // Both anchors preserve their original time/bpm fields alongside the new ones.
      expect(first.time).toBe(0);
      expect(second.time).toBe(5);
    });

    it("the last anchor's segment end falls back to duration when there's no next anchor", () => {
      const { bars } = phaseWeightedBars({ numBeats: 16, downbeatPhase: 3 });
      const tempoSegments = [{ time: 0, bpm: 120 }];
      const result = computeDownbeatData(bars, { beatTimesSec: [] }, tempoSegments, 8);
      // A too-short duration (< 8 beats worth) should yield a grid under
      // MIN_DOWNBEAT_BEATS and no downbeat data on the anchor.
      const resultShort = computeDownbeatData(bars, { beatTimesSec: [] }, tempoSegments, 1.5);
      expect(resultShort.tempoSegmentsWithDownbeat[0].downbeatOffset).toBeUndefined();
      // The full 8s duration gives enough beats to find the phase-3 downbeat.
      expect(result.tempoSegmentsWithDownbeat[0].downbeatOffset).toBeDefined();
    });

    it("an anchor where detection declines to guess is returned unchanged (no extra fields)", () => {
      const flatBars = Array.from({ length: 400 }, () => ({ bass: 0.3 }));
      const tempoSegments = [{ time: 0, bpm: 120 }];
      const result = computeDownbeatData(flatBars, { beatTimesSec: [] }, tempoSegments, 6);
      expect(result.tempoSegmentsWithDownbeat[0]).toEqual({ time: 0, bpm: 120 });
    });
  });
});
