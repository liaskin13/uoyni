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
  parseWavHeader,
  fetchWavHeader,
  fetchWavPcmRange,
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

    it("treats an empty tempoSegments array the same as null (flat-tempo branch, not an empty drift map)", () => {
      // Defensive: !tempoSegments alone doesn't catch a truthy-but-empty [],
      // which would otherwise fall into the drift branch and persist a
      // truthy-but-empty tempoSegmentsWithDownbeat, contradicting the
      // documented "leave beat_grid_points unset" contract.
      const { bars, beatTimesSec } = phaseWeightedBars({ numBeats: 12, downbeatPhase: 1 });
      const detected = { beatTimesSec };
      const result = computeDownbeatData(bars, detected, [], 6);
      expect(result.tempoSegmentsWithDownbeat).toEqual([]);
      expect(result.detectedDownbeatOffset).toBeCloseTo(beatTimesSec[1], 5);
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

// ── parseWavHeader / fetchWavHeader / fetchWavPcmRange ──────────────────────
// Extracted from (parseWavHeader) and added alongside (the fetch helpers)
// analyzeAudioChunkedWav for the loop-region playback engine (loopEngine.js).
// parseWavHeader had zero direct test coverage before this — these tests
// cover it for the first time, independent of the visualization pipeline.

function writeStr(dv, offset, str) {
  for (let i = 0; i < str.length; i++) dv.setUint8(offset + i, str.charCodeAt(i));
}

function buildWavHeaderBuffer({
  sampleRate = 44100,
  numChannels = 2,
  bitsPerSample = 16,
  dataSize = 1000,
  includeListChunk = false,
  audioFormat = 1,
  rf64 = false,
}) {
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const chunks = [];

  const fmtSize = 16;
  const fmtBuf = new ArrayBuffer(8 + fmtSize);
  const fmtDv = new DataView(fmtBuf);
  writeStr(fmtDv, 0, "fmt ");
  fmtDv.setUint32(4, fmtSize, true);
  fmtDv.setUint16(8, audioFormat, true);
  fmtDv.setUint16(10, numChannels, true);
  fmtDv.setUint32(12, sampleRate, true);
  fmtDv.setUint32(16, byteRate, true);
  fmtDv.setUint16(20, blockAlign, true);
  fmtDv.setUint16(22, bitsPerSample, true);
  chunks.push(new Uint8Array(fmtBuf));

  if (includeListChunk) {
    const listBytes = new Uint8Array([73, 78, 70, 79, 0, 0]); // "INFO" + padding, even length
    const buf = new ArrayBuffer(8 + listBytes.length);
    const dv = new DataView(buf);
    writeStr(dv, 0, "LIST");
    dv.setUint32(4, listBytes.length, true);
    const u8 = new Uint8Array(buf);
    u8.set(listBytes, 8);
    chunks.push(u8);
  }

  const dataHeaderBuf = new ArrayBuffer(8);
  const dataDv = new DataView(dataHeaderBuf);
  writeStr(dataDv, 0, "data");
  dataDv.setUint32(4, dataSize, true);
  chunks.push(new Uint8Array(dataHeaderBuf));

  const totalChunkBytes = chunks.reduce((a, c) => a + c.length, 0);
  const riffSize = 4 + totalChunkBytes;
  const out = new Uint8Array(8 + riffSize);
  const outDv = new DataView(out.buffer);
  writeStr(outDv, 0, "RIFF");
  outDv.setUint32(4, rf64 ? 0xffffffff : riffSize, true);
  writeStr(outDv, 8, "WAVE");
  let offset = 12;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out.buffer;
}

describe("parseWavHeader", () => {
  it("parses a standard 16-bit stereo WAV header", () => {
    const buf = buildWavHeaderBuffer({ sampleRate: 44100, numChannels: 2, bitsPerSample: 16, dataSize: 8000 });
    const header = parseWavHeader(buf);
    expect(header.sampleRate).toBe(44100);
    expect(header.numChannels).toBe(2);
    expect(header.bitsPerSample).toBe(16);
    expect(header.bytesPerSample).toBe(2);
    expect(header.frameSize).toBe(4);
    expect(header.dataSize).toBe(8000);
    expect(header.totalSamples).toBe(2000);
    expect(header.dataOffset).toBe(12 + 24 + 8); // RIFF/WAVE(12) + fmt chunk(8+16) + data chunk header(8)
  });

  it("skips a LIST/INFO metadata chunk between fmt and data to find the real data offset", () => {
    const withList = buildWavHeaderBuffer({ dataSize: 4000, includeListChunk: true });
    const withoutList = buildWavHeaderBuffer({ dataSize: 4000, includeListChunk: false });
    const headerWithList = parseWavHeader(withList);
    const headerWithoutList = parseWavHeader(withoutList);
    // LIST chunk is 8 (header) + 6 (payload) = 14 bytes, inserted before data.
    expect(headerWithList.dataOffset).toBe(headerWithoutList.dataOffset + 14);
    expect(headerWithList.dataSize).toBe(4000);
  });

  it("rejects RF64 (64-bit WAV size sentinel)", () => {
    const buf = buildWavHeaderBuffer({ rf64: true });
    expect(() => parseWavHeader(buf)).toThrow("RF64");
  });

  it("rejects non-PCM audio format", () => {
    const buf = buildWavHeaderBuffer({ audioFormat: 3 }); // 3 = IEEE float
    expect(() => parseWavHeader(buf)).toThrow("not PCM");
  });

  it("rejects unsupported bit depths", () => {
    const buf = buildWavHeaderBuffer({ bitsPerSample: 32 });
    expect(() => parseWavHeader(buf)).toThrow("32-bit not supported");
  });

  it("throws when no data chunk is found", () => {
    // Header with only RIFF/WAVE + fmt, no data chunk at all.
    const fmtOnly = buildWavHeaderBuffer({ dataSize: 0 });
    // Truncate the buffer right where the data chunk header would start.
    const truncated = fmtOnly.slice(0, 12 + 24);
    expect(() => parseWavHeader(truncated)).toThrow("data chunk not found");
  });
});

describe("fetchWavHeader", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("resolves the parsed header on a real 206 Partial Content response", async () => {
    const buf = buildWavHeaderBuffer({ sampleRate: 48000, dataSize: 500 });
    global.fetch = vi.fn().mockResolvedValue({
      status: 206,
      arrayBuffer: () => Promise.resolve(buf),
    });
    const header = await fetchWavHeader("https://example.com/track.wav");
    expect(header.sampleRate).toBe(48000);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://example.com/track.wav",
      expect.objectContaining({ headers: { Range: "bytes=0-4095" } }),
    );
  });

  it("rejects a 200 response — server ignored the Range header, would silently mis-decode", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });
    await expect(fetchWavHeader("https://example.com/track.wav")).rejects.toThrow("expected 206");
  });
});

describe("fetchWavPcmRange", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("decodes 16-bit stereo PCM into per-channel Float32Arrays, not downmixed", async () => {
    const header = { numChannels: 2, bitsPerSample: 16, bytesPerSample: 2, frameSize: 4 };
    // 3 frames: L = [0, 32767, -32768], R = [16384, 0, -16384]
    const pcm = new ArrayBuffer(3 * 4);
    const dv = new DataView(pcm);
    const frame = (i, l, r) => { dv.setInt16(i * 4, l, true); dv.setInt16(i * 4 + 2, r, true); };
    frame(0, 0, 16384);
    frame(1, 32767, 0);
    frame(2, -32768, -16384);

    global.fetch = vi.fn().mockResolvedValue({ status: 206, arrayBuffer: () => Promise.resolve(pcm) });

    const { channels, frameCount } = await fetchWavPcmRange("https://example.com/t.wav", header, 100, 111);
    expect(frameCount).toBe(3);
    expect(channels).toHaveLength(2);
    expect(channels[0][0]).toBeCloseTo(0, 4);
    expect(channels[0][1]).toBeCloseTo(1, 3); // 32767/32768
    expect(channels[0][2]).toBeCloseTo(-1, 4); // -32768/32768 exactly
    expect(channels[1][0]).toBeCloseTo(0.5, 3); // 16384/32768
    expect(channels[1][2]).toBeCloseTo(-0.5, 3);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://example.com/t.wav",
      expect.objectContaining({ headers: { Range: "bytes=100-111" } }),
    );
  });

  it("decodes 24-bit mono PCM with correct sign extension", async () => {
    const header = { numChannels: 1, bitsPerSample: 24, bytesPerSample: 3, frameSize: 3 };
    const pcm = new ArrayBuffer(2 * 3);
    const u8 = new Uint8Array(pcm);
    // frame 0: max positive 0x7FFFFF (little-endian bytes)
    u8[0] = 0xff; u8[1] = 0xff; u8[2] = 0x7f;
    // frame 1: max negative 0x800000
    u8[3] = 0x00; u8[4] = 0x00; u8[5] = 0x80;

    global.fetch = vi.fn().mockResolvedValue({ status: 206, arrayBuffer: () => Promise.resolve(pcm) });

    const { channels, frameCount } = await fetchWavPcmRange("https://example.com/t.wav", header, 0, 5);
    expect(frameCount).toBe(2);
    expect(channels[0][0]).toBeCloseTo(1, 3);
    expect(channels[0][1]).toBeCloseTo(-1, 4);
  });

  it("rejects a non-206 response", async () => {
    const header = { numChannels: 1, bitsPerSample: 16, bytesPerSample: 2, frameSize: 2 };
    global.fetch = vi.fn().mockResolvedValue({ status: 200, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });
    await expect(fetchWavPcmRange("https://example.com/t.wav", header, 0, 3)).rejects.toThrow("expected 206");
  });
});
