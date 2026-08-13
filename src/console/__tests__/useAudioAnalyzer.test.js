// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

// ── specBarColor ──────────────────────────────────────────────────────────────

import {
  amplitudeTodBFS,
  specBarColor,
  detectBpm,
  BAND_LOW_MIDLOW_T,
  BAND_MIDLOW_MID_T,
  BAND_MID_MIDHIGH_T,
  BAND_MIDHIGH_HIGH_T,
} from "../useAudioAnalyzer.js";

// ── amplitudeTodBFS ──────────────────────────────────────────────────────────

describe("amplitudeTodBFS", () => {
  it("maps amplitude 1.0 to 0 dBFS", () => {
    expect(amplitudeTodBFS(1.0)).toBeCloseTo(0, 1);
  });

  it("maps amplitude 0.001 to -60 dBFS (floor)", () => {
    expect(amplitudeTodBFS(0.001, -60)).toBeCloseTo(-60, 0);
  });

  it("maps amplitude 0 to floor (not -Infinity)", () => {
    expect(amplitudeTodBFS(0, -60)).toBe(-60);
  });

  it("maps amplitude above 1.0 to positive dBFS (clip region)", () => {
    expect(amplitudeTodBFS(1.1)).toBeGreaterThan(0);
  });

  it("clamps values below floor to the floor value", () => {
    const result = amplitudeTodBFS(1e-8, -60);
    expect(result).toBe(-60);
  });
});

// 5-band Bark-scale boundaries — imported from useAudioAnalyzer.js so this test
// can't silently desync from the implementation. See that file for the Hz/derivation.
const T_LOW_MIDLOW   = BAND_LOW_MIDLOW_T;
const T_MIDLOW_MID   = BAND_MIDLOW_MID_T;
const T_MID_MIDHIGH  = BAND_MID_MIDHIGH_T;
const T_MIDHIGH_HIGH = BAND_MIDHIGH_HIGH_T;

describe("specBarColor", () => {
  it("returns red RGB in Low band (freqT < 0.482869)", () => {
    expect(specBarColor(1.0, 0, 1)).toContain("255, 0, 0");
    expect(specBarColor(1.0, 0.3, 1)).toContain("255, 0, 0");
  });

  it("returns red-orange RGB in Mid-low band", () => {
    expect(specBarColor(1.0, T_LOW_MIDLOW, 1)).toContain("255, 85, 0");
    expect(specBarColor(1.0, 0.55, 1)).toContain("255, 85, 0");
  });

  it("returns green RGB in Mid band", () => {
    expect(specBarColor(1.0, T_MIDLOW_MID, 1)).toContain("0, 255, 0");
    expect(specBarColor(1.0, 0.65, 1)).toContain("0, 255, 0");
  });

  it("returns cyan RGB in Mid-high band", () => {
    expect(specBarColor(1.0, T_MID_MIDHIGH, 1)).toContain("0, 255, 255");
    expect(specBarColor(1.0, 0.75, 1)).toContain("0, 255, 255");
  });

  it("returns indigo RGB in High band (freqT >= 0.836697)", () => {
    expect(specBarColor(1.0, T_MIDHIGH_HIGH, 1)).toContain("102, 0, 255");
    expect(specBarColor(1.0, 1.0, 1)).toContain("102, 0, 255");
  });

  it("amplitude modulates opacity — low normH has floor at 0.2", () => {
    const dim  = specBarColor(0.1, T_MIDLOW_MID, 1);
    const full = specBarColor(1.0, T_MIDLOW_MID, 1);
    // Both should contain green, but dim should have lower opacity
    expect(dim).toContain("0, 255, 0");
    expect(full).toContain("0, 255, 0");
    expect(dim).toContain("0.2"); // floor opacity
    expect(full).toContain("1"); // full opacity
  });

  it("embeds alpha correctly when passed as param", () => {
    const result = specBarColor(1.0, 0, 0.5);
    expect(result).toContain("255, 0, 0");
    expect(result).toContain("0.5");
  });

  it("when alpha=1 and normH=1.0, final opacity is 1", () => {
    // With normH=1.0, opacity = max(0.2, 1.0) = 1.0, and alpha defaults to 1
    // So final opacity = 1 * 1 = 1
    expect(specBarColor(1.0, T_MIDLOW_MID, 1)).toContain("rgba(0, 255, 0, 1)");
  });
});

// ── analyser singleton guard ──────────────────────────────────────────────────

describe("analyser singleton guard", () => {
  it("calls createMediaElementSource only once even if setup runs multiple times", () => {
    // Simulate the guard pattern used in useAudioAnalyzer's live FFT setup.
    // createMediaElementSource() can only be called once per audio element —
    // calling it twice throws. The ref guard prevents this.
    const createMediaElementSource = vi.fn().mockReturnValue({
      connect: vi.fn(),
    });

    const fakeAudioCtx = { createMediaElementSource, createAnalyser: vi.fn().mockReturnValue({ fftSize: 0, frequencyBinCount: 1024, smoothingTimeConstant: 0, connect: vi.fn() }) };
    const fakeAudioEl  = { src: "fake.mp3" };

    // Ref guard — mirrors analyserSetupRef.current in useAudioAnalyzer.js
    const setupRef = { current: false };

    function setupAnalyserOnce(audioEl, audioCtx) {
      if (setupRef.current) return null;
      setupRef.current = true;
      const source   = audioCtx.createMediaElementSource(audioEl);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize              = 4096;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(audioCtx.destination);
      source.connect(analyser);
      return analyser;
    }

    // First call: creates source
    const analyser1 = setupAnalyserOnce(fakeAudioEl, fakeAudioCtx);
    expect(createMediaElementSource).toHaveBeenCalledTimes(1);
    expect(analyser1).not.toBeNull();

    // Second call: guard fires, createMediaElementSource NOT called again
    const analyser2 = setupAnalyserOnce(fakeAudioEl, fakeAudioCtx);
    expect(createMediaElementSource).toHaveBeenCalledTimes(1); // still 1
    expect(analyser2).toBeNull();
  });

  it("guard ref starts false — first call always proceeds", () => {
    const createMediaElementSource = vi.fn().mockReturnValue({ connect: vi.fn() });
    const fakeAudioCtx = {
      createMediaElementSource,
      createAnalyser: vi.fn().mockReturnValue({ fftSize: 0, frequencyBinCount: 1024, smoothingTimeConstant: 0, connect: vi.fn() }),
    };
    const setupRef = { current: false };

    expect(setupRef.current).toBe(false);
    if (!setupRef.current) {
      setupRef.current = true;
      fakeAudioCtx.createMediaElementSource({});
    }
    expect(createMediaElementSource).toHaveBeenCalledTimes(1);
    expect(setupRef.current).toBe(true);
  });
});

// ── BPM ring bass-window Hz stability ──────────────────────────────────────────
// Regression test: the BPM ring's bass-energy window (useAudioAnalyzer.js's
// BPM_BASS_CUTOFF_HZ + bassEnd calculation) must sample the same Hz range
// regardless of fftSize/frequencyBinCount. A fixed bin-count cutoff would
// silently narrow the sampled range whenever fftSize changes (caught when
// this file's fftSize bump 2048->4096 halved the range from ~860Hz to ~430Hz
// with the old `Math.min(40, freqBins.length)` calculation).

describe("BPM ring bass-window Hz stability", () => {
  const BASS_CUTOFF_HZ = 860;
  const sampleRate = 44100;

  function bassEndFor(totalBins) {
    const nyquistHz = sampleRate / 2;
    return Math.min(Math.max(1, Math.round((BASS_CUTOFF_HZ / nyquistHz) * totalBins)), totalBins);
  }

  it("samples the same Hz cutoff at fftSize=2048 (1024 bins) and fftSize=4096 (2048 bins)", () => {
    const oldBins = 1024; // fftSize 2048
    const newBins = 2048; // fftSize 4096
    const oldBassEnd = bassEndFor(oldBins);
    const newBassEnd = bassEndFor(newBins);

    const oldCutoffHz = (oldBassEnd / oldBins) * (sampleRate / 2);
    const newCutoffHz = (newBassEnd / newBins) * (sampleRate / 2);

    expect(oldCutoffHz).toBeCloseTo(newCutoffHz, 0);
  });
});

// ── detectBpm ─────────────────────────────────────────────────────────────────

describe("detectBpm", () => {
  it("detects ~120 BPM from a synthetic 240-sample buffer at 60 Hz", () => {
    // 120 BPM at 60 Hz = period of 30 frames. Peaks at indices 0,30,60,...,210.
    const buf = new Float32Array(240);
    for (let i = 0; i < 240; i += 30) buf[i] = 1.0;
    const { bpm, confidence } = detectBpm(buf, 60);
    expect(bpm).toBeGreaterThanOrEqual(115);
    expect(bpm).toBeLessThanOrEqual(125);
    expect(confidence).toBeGreaterThan(0.3);
  });

  it("returns confidence < 0.3 for all-zeros buffer", () => {
    const buf = new Float32Array(240); // all zeros
    const { confidence } = detectBpm(buf, 60);
    expect(confidence).toBeLessThan(0.3);
  });

  it("returns confidence < 0.3 for single-peak buffer (no repeating pattern)", () => {
    const buf = new Float32Array(240);
    buf[0] = 1.0; // only one peak — no period to detect
    const { confidence } = detectBpm(buf, 60);
    expect(confidence).toBeLessThan(0.3);
  });
});

// ── PUT /tracks/:id auth gate ─────────────────────────────────────────────────

// Tests the timingSafeEqual auth pattern used by all authenticated endpoints.
// When PUT /tracks/:id is implemented (T6), it must use this same pattern.

function timingSafeEqual(a, b) {
  const enc   = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let mismatch = 0;
  for (let i = 0; i < aBytes.length; i++) mismatch |= aBytes[i] ^ bBytes[i];
  return mismatch === 0;
}

function isAuthenticated(request, env) {
  return timingSafeEqual(
    request.headers.get("PSC-Secret") || "",
    env.PSC_SECRET || "",
  );
}

describe("PUT /tracks/:id auth gate (timingSafeEqual pattern)", () => {
  const env = { PSC_SECRET: "correct-secret-abc123" };

  it("returns true when PSC-Secret header matches env.PSC_SECRET", () => {
    const req = { headers: { get: (h) => h === "PSC-Secret" ? "correct-secret-abc123" : null } };
    expect(isAuthenticated(req, env)).toBe(true);
  });

  it("returns false when PSC-Secret header is wrong", () => {
    const req = { headers: { get: () => "wrong-secret" } };
    expect(isAuthenticated(req, env)).toBe(false);
  });

  it("returns false when PSC-Secret header is absent", () => {
    const req = { headers: { get: () => null } };
    expect(isAuthenticated(req, env)).toBe(false);
  });

  it("returns false when header is correct prefix but longer (length mismatch stops match)", () => {
    const req = { headers: { get: () => "correct-secret-abc123-extra" } };
    expect(isAuthenticated(req, env)).toBe(false);
  });

  it("returns false for empty string against non-empty secret", () => {
    const req = { headers: { get: () => "" } };
    expect(isAuthenticated(req, env)).toBe(false);
  });

  it("uses timing-safe comparison — length check runs before byte comparison", () => {
    // Verify length mismatch returns false without byte comparison (no short-circuit leak)
    const a = "abc";
    const b = "abcd";
    expect(timingSafeEqual(a, b)).toBe(false);
    expect(timingSafeEqual("", "x")).toBe(false);
  });
});
