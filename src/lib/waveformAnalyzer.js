// Client-side waveform analyzer using Web Audio API
// Generates 3-band frequency data for layered spectral visualization
//
// V2 Architecture:
//   binary: 4 bytes/bar (bass,mid,high,peak 0-255) → R2 waveform/{id}.bin → D's console
//   PNG:    1200×60px spectral render              → R2 waveform/{id}.png → listener view art
//   sentinel: waveform_data='v2' in D1             → track has V2 assets in R2
//   proxy: GET /tracks/:id/waveform-bin            → worker endpoint (CORS-safe, no direct R2)

import { UPLOAD_WORKER_URL, UPLOAD_SECRET } from "../config";
import {
  onsetEnvelope,
  dpBeatTrack,
  detectTempoSegments,
  detectDownbeatPhase,
  synthesizeSegmentBeatGrid,
} from "./beatDetector";

// Sentinel value stored in D1 waveform_data when a track has V2 binary assets in R2.
// Use this constant everywhere — never compare against the string literal 'v2'.
export const WAVEFORM_V2_SENTINEL = "v2";

const WORKER_URL = UPLOAD_WORKER_URL;

// Serato cue color palette (exact)
export const SERATO_COLORS = [
  "#CC0000", // red (Serato #1)
  "#CC8800", // orange-brown (Serato #3)
  "#CCCC00", // yellow (Serato #4)
  "#00CC00", // green (Serato #7)
  "#00CCCC", // cyan (Serato #10)
  "#0044CC", // blue (Serato #12)
  "#8800CC", // purple (Serato #15)
  "#E5E5E5", // white/grey
];

const CHUNK_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB per Range request

/**
 * Chunked WAV analyzer — processes the file in 50 MB Range-request slices.
 * Avoids loading the entire file into memory (critical for 800 MB+ WAVs).
 * IIR filter state is carried across chunk boundaries so results are identical
 * to a single-pass decode.
 */
// Parses a WAV RIFF header out of an already-fetched ArrayBuffer (normally
// just the first ~4096 bytes — enough to cover DAW LIST/INFO chunks before
// `data`). Pure — no I/O. Extracted so the loop-region playback engine
// (src/lib/loopEngine.js) can share the exact same, already-correct chunk
// walk instead of a second copy that could drift from this one.
export function parseWavHeader(headerArrayBuffer) {
  const headerU8 = new Uint8Array(headerArrayBuffer);
  const headerDV = new DataView(headerArrayBuffer);

  const txt = (off, len) =>
    Array.from({ length: len }, (_, i) => String.fromCharCode(headerU8[off + i])).join('');

  if (txt(0, 4) !== 'RIFF' || txt(8, 4) !== 'WAVE') throw new Error('Not a RIFF/WAVE file');
  if (headerDV.getUint32(4, true) === 0xFFFFFFFF)    throw new Error('RF64 WAV not supported');

  let sampleRate, numChannels, bitsPerSample, dataOffset, dataSize;
  let pos = 12;
  while (pos + 8 <= headerArrayBuffer.byteLength) {
    const id = txt(pos, 4);
    const sz = headerDV.getUint32(pos + 4, true);
    if (id === 'fmt ') {
      const fmt = headerDV.getUint16(pos + 8, true);
      if (fmt !== 1) throw new Error(`WAV format ${fmt} is not PCM`);
      numChannels  = headerDV.getUint16(pos + 10, true);
      sampleRate   = headerDV.getUint32(pos + 12, true);
      bitsPerSample = headerDV.getUint16(pos + 22, true);
    } else if (id === 'data') {
      dataOffset = pos + 8;
      dataSize   = sz;
      break;
    }
    pos += 8 + sz + (sz % 2); // align to even byte boundary
  }

  if (dataOffset == null) throw new Error('WAV data chunk not found in first 4096 bytes');
  if (!sampleRate)        throw new Error('WAV fmt chunk not found');
  if (bitsPerSample !== 16 && bitsPerSample !== 24) {
    throw new Error(`WAV ${bitsPerSample}-bit not supported — expected 16 or 24`);
  }

  const bytesPerSample = bitsPerSample / 8;
  const frameSize      = numChannels * bytesPerSample;
  if (frameSize < 1) throw new Error('invalid WAV: zero frame size (corrupt header)');
  const totalSamples = Math.floor(dataSize / frameSize);
  const duration      = totalSamples / sampleRate;

  return {
    sampleRate, numChannels, bitsPerSample, bytesPerSample, frameSize,
    dataOffset, dataSize, totalSamples, duration,
  };
}

// Range-fetches just the WAV header bytes and parses them. Unlike
// analyzeAudioChunkedWav's own header fetch (which only checks `.ok`, kept
// as-is below to avoid any behavior change to the already-shipped,
// OOM-critical waveform-analysis path), this checks for a real 206 Partial
// Content response. A server that silently ignores the Range header and
// returns the full file would otherwise be mis-decoded as if it were just
// the header slice — for a waveform visualization that's a cosmetic risk;
// for loop-region PLAYBACK it would decode the wrong bytes entirely, so the
// stricter check belongs here. Confirmed worker/upload-worker.js's
// GET /audio/:key already returns real 206 responses for Range requests —
// no worker change needed for this to work in production.
export async function fetchWavHeader(url) {
  const headerRes = await fetch(url, { headers: { Range: 'bytes=0-4095' } });
  if (headerRes.status !== 206) {
    throw new Error(`WAV header fetch: expected 206, got ${headerRes.status}`);
  }
  const headerBuf = await headerRes.arrayBuffer();
  return parseWavHeader(headerBuf);
}

// Range-fetches a byte span of WAV PCM data and decodes it into one
// Float32Array per channel (NOT downmixed to mono, NOT band-split — that's
// analyzeAudioChunkedWav's visualization-specific job below). Used by the
// loop-region playback engine to pull just the small slice it needs to
// build a native, sample-accurate loop buffer, never the whole file.
export async function fetchWavPcmRange(url, header, startByte, endByte) {
  const res = await fetch(url, { headers: { Range: `bytes=${startByte}-${endByte}` } });
  if (res.status !== 206) {
    throw new Error(`WAV PCM range fetch: expected 206, got ${res.status}`);
  }
  const u8 = new Uint8Array(await res.arrayBuffer());
  const { numChannels, bitsPerSample, bytesPerSample, frameSize } = header;
  const frameCount = Math.floor(u8.length / frameSize);
  const channels = Array.from({ length: numChannels }, () => new Float32Array(frameCount));
  for (let s = 0; s < frameCount; s++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const o = s * frameSize + ch * bytesPerSample;
      if (bitsPerSample === 16) {
        let v = (u8[o + 1] << 8) | u8[o];
        if (v >= 0x8000) v -= 0x10000;
        channels[ch][s] = v / 32768.0;
      } else { // 24-bit signed LE
        let raw = u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16);
        if (raw >= 0x800000) raw -= 0x1000000;
        channels[ch][s] = raw / 8388608.0;
      }
    }
  }
  return { channels, frameCount };
}

async function analyzeAudioChunkedWav(audioUrl, barsPerSec = 50, onProgress) {
  // Fetch first 4096 bytes to parse the WAV header (covers DAW LIST/INFO chunks)
  const headerRes = await fetch(audioUrl, { headers: { Range: 'bytes=0-4095' } });
  if (!headerRes.ok) throw new Error(`WAV header fetch failed: ${headerRes.status}`);
  const headerBuf = await headerRes.arrayBuffer();
  const {
    sampleRate, numChannels, bitsPerSample, bytesPerSample, frameSize,
    dataOffset, dataSize,
  } = parseWavHeader(headerBuf);

  const alignedChunkSize = Math.floor(CHUNK_SIZE_BYTES / frameSize) * frameSize;

  const totalSamples = Math.floor(dataSize / frameSize);
  const duration     = totalSamples / sampleRate;
  const totalBars    = Math.min(Math.ceil(duration * barsPerSec), 250000);
  const samplesPerBar = Math.max(1, Math.floor(totalSamples / totalBars));

  // IIR coefficients — identical to generateWaveformDataBands
  const aLow  = 1 - Math.exp(-2 * Math.PI * 200  / sampleRate);
  const aHigh = 1 - Math.exp(-2 * Math.PI * 2500 / sampleRate);
  let lpLowState = 0, lpHighState = 0;

  const rawBars = [];
  let cbSamples = 0, cbBass = 0, cbMid = 0, cbHigh = 0, cbPeak = 0;

  const totalChunks = Math.ceil(dataSize / alignedChunkSize);
  let chunkIdx = 0, bytePos = dataOffset, remaining = dataSize;

  while (remaining > 0) {
    const fetchBytes = Math.min(alignedChunkSize, remaining);
    const chunkRes  = await fetch(audioUrl, {
      headers: { Range: `bytes=${bytePos}-${bytePos + fetchBytes - 1}` },
    });
    if (!chunkRes.ok) {
      throw new Error(`WAV chunk fetch failed at byte ${bytePos}: ${chunkRes.status}`);
    }
    const chunkU8 = new Uint8Array(await chunkRes.arrayBuffer());
    const samplesInChunk = Math.floor(chunkU8.length / frameSize);

    for (let s = 0; s < samplesInChunk; s++) {
      let x = 0;
      for (let ch = 0; ch < numChannels; ch++) {
        const o = s * frameSize + ch * bytesPerSample;
        if (bitsPerSample === 16) {
          let v = (chunkU8[o + 1] << 8) | chunkU8[o];
          if (v >= 0x8000) v -= 0x10000;
          x += v / 32768.0;
        } else { // 24-bit signed LE — sign-extend
          let raw = chunkU8[o] | (chunkU8[o + 1] << 8) | (chunkU8[o + 2] << 16);
          if (raw >= 0x800000) raw -= 0x1000000;
          x += raw / 8388608.0;
        }
      }
      x /= numChannels; // mono average

      lpLowState  = aLow  * x + (1 - aLow)  * lpLowState;
      lpHighState = aHigh * x + (1 - aHigh) * lpHighState;

      const absBass = Math.abs(lpLowState);
      const absMid  = Math.abs(lpHighState - lpLowState);
      const absHigh = Math.abs(x - lpHighState);
      const absAll  = Math.abs(x);

      if (absBass > cbBass) cbBass = absBass;
      if (absMid  > cbMid)  cbMid  = absMid;
      if (absHigh > cbHigh) cbHigh = absHigh;
      if (absAll  > cbPeak) cbPeak = absAll;

      if (++cbSamples >= samplesPerBar) {
        rawBars.push({ bass: cbBass, mid: cbMid, high: cbHigh, peak: cbPeak });
        cbBass = 0; cbMid = 0; cbHigh = 0; cbPeak = 0; cbSamples = 0;
      }
    }

    bytePos   += fetchBytes;
    remaining -= fetchBytes;
    chunkIdx++;
    if (onProgress) onProgress(5 + Math.round((chunkIdx / totalChunks) * 50));
  }

  if (cbSamples > 0) rawBars.push({ bass: cbBass, mid: cbMid, high: cbHigh, peak: cbPeak });

  // Normalization — identical to generateWaveformDataBands
  let maxPeak = 0;
  for (const b of rawBars) if (b.peak > maxPeak) maxPeak = b.peak;
  maxPeak = Math.max(maxPeak, 0.0001);

  let maxBass = 0, maxMid = 0, maxHigh = 0;
  for (const b of rawBars) {
    if (b.bass > maxBass) maxBass = b.bass;
    if (b.mid  > maxMid)  maxMid  = b.mid;
    if (b.high > maxHigh) maxHigh = b.high;
  }
  maxBass = Math.max(maxBass, maxPeak * 0.02);
  maxMid  = Math.max(maxMid,  maxPeak * 0.02);
  maxHigh = Math.max(maxHigh, maxPeak * 0.02);

  return {
    high: rawBars.map(b => ({
      bass: Math.min(1, b.bass / maxBass),
      mid:  Math.min(1, b.mid  / maxMid),
      high: Math.min(1, b.high / maxHigh),
      peak: Math.min(1, b.peak / maxPeak),
    })),
    duration,
  };
}

/**
 * Analyze audio and generate 3-band waveform data.
 * WAV files use chunked Range requests; MP3/M4A use Web Audio decodeAudioData.
 * Returns {high, low, duration} where high/low are [{bass,mid,high,peak}] bars 0-1.
 *
 * ⚠️  NEVER bypass this function for WAV files. D's mixes are 800MB–1GB+ WAVs.
 * The WAV branch below routes to analyzeAudioChunkedWav() which streams the file
 * in 50MB Range-request slices — no full arrayBuffer() load, no OOM.
 * Any new waveform analysis path MUST call analyzeAudio(), not arrayBuffer() directly.
 * History: upload-time WAV streaming removed 2026-05-21 (1065606) when V2 post-upload
 * pipeline replaced it. Double dispatch OOM exposed 2026-06-18 (d6af921) when batch
 * upload triggered two concurrent analyses of the same 800MB WAV. Range-request chunking
 * added 2026-06-27 (7c957ad) as the permanent fix. Do not remove it.
 */
export async function analyzeAudio(
  audioUrl,
  highResSamples = 1000,
  lowResSamples = 80,
  barsPerSec = null,
  onProgress,
) {
  // WAV: chunked Range-request path — avoids loading 800 MB+ into browser RAM
  if (/\.wav$/i.test(audioUrl)) {
    let fileSize = 0;
    try {
      const hr = await fetch(audioUrl, { method: 'HEAD' });
      fileSize = parseInt(hr.headers.get('Content-Length') || '0', 10);
    } catch (_) {}
    try {
      const result = await analyzeAudioChunkedWav(audioUrl, barsPerSec ?? 50, onProgress);
      return { high: result.high, low: result.high, duration: result.duration };
    } catch (err) {
      if (fileSize > 200 * 1024 * 1024) {
        throw new Error(`WAV too large for browser decode — chunked analysis failed: ${err.message}`);
      }
      console.warn('[PSC] chunked WAV analysis failed, falling back to full decode:', err.message);
    }
  }

  const response = await fetch(audioUrl);
  if (!response.ok)
    throw new Error(`Failed to fetch audio: ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();

  const audioContext = new AudioContext();
  let audioBuffer;
  try {
    audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  } finally {
    audioContext.close();
  }

  const actualHighRes = barsPerSec
    ? Math.min(Math.ceil(audioBuffer.duration * barsPerSec), 250000)
    : highResSamples;

  const highRes = generateWaveformDataBands(audioBuffer, actualHighRes);
  const lowRes  = generateWaveformDataBands(audioBuffer, lowResSamples);

  return { high: highRes, low: lowRes, duration: audioBuffer.duration };
}

/**
 * Generate 3-band waveform data using two cascaded single-pole IIR lowpass filters.
 *
 * Each band is independently normalized so quiet content stays visible.
 * A 2% floor relative to the overall peak prevents absent bands from
 * being amplified to full scale.
 *
 * Returns [{bass, mid, high, peak}] — all values 0-1.
 */
function generateWaveformDataBands(audioBuffer, barCount) {
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate  = audioBuffer.sampleRate;
  const total       = channelData.length;
  const samplesPerBar = Math.floor(total / barCount);

  // Single-pole IIR coefficient: α = 1 − exp(−2π·fc/fs)
  const aLow  = 1 - Math.exp(-2 * Math.PI * 200  / sampleRate);
  const aHigh = 1 - Math.exp(-2 * Math.PI * 2500 / sampleRate);

  let lpLowState  = 0;
  let lpHighState = 0;

  const bars = [];

  for (let i = 0; i < barCount; i++) {
    const start = i * samplesPerBar;
    const end   = Math.min(start + samplesPerBar, total);

    let bassPeak = 0, midPeak = 0, highPeak = 0, allPeak = 0;

    for (let j = start; j < end; j++) {
      const x = channelData[j];

      lpLowState  = aLow  * x + (1 - aLow)  * lpLowState;
      lpHighState = aHigh * x + (1 - aHigh) * lpHighState;

      const absBass = Math.abs(lpLowState);
      const absMid  = Math.abs(lpHighState - lpLowState);
      const absHigh = Math.abs(x - lpHighState);
      const absAll  = Math.abs(x);

      if (absBass > bassPeak) bassPeak = absBass;
      if (absMid  > midPeak)  midPeak  = absMid;
      if (absHigh > highPeak) highPeak = absHigh;
      if (absAll  > allPeak)  allPeak  = absAll;
    }

    bars.push({ bass: bassPeak, mid: midPeak, high: highPeak, peak: allPeak });
  }

  let maxPeak = 0;
  for (const b of bars) if (b.peak > maxPeak) maxPeak = b.peak;
  maxPeak = Math.max(maxPeak, 0.0001);

  let maxBass = 0, maxMid = 0, maxHigh = 0;
  for (const b of bars) {
    if (b.bass > maxBass) maxBass = b.bass;
    if (b.mid  > maxMid)  maxMid  = b.mid;
    if (b.high > maxHigh) maxHigh = b.high;
  }
  maxBass = Math.max(maxBass, maxPeak * 0.02);
  maxMid  = Math.max(maxMid,  maxPeak * 0.02);
  maxHigh = Math.max(maxHigh, maxPeak * 0.02);

  return bars.map(b => ({
    bass: Math.min(1, b.bass / maxBass),
    mid:  Math.min(1, b.mid  / maxMid),
    high: Math.min(1, b.high / maxHigh),
    peak: Math.min(1, b.peak / maxPeak),
  }));
}

/**
 * Save waveform data (and optional tracking fields) to database.
 * Pass waveform_generated_at (ISO string) on success, waveform_error (string) on failure.
 */
export async function saveWaveform(trackId, waveformData, duration, extra = {}) {
  const body = { waveform_data: waveformData, ...extra };
  if (duration != null) body.duration = duration;
  const res = await fetch(`${WORKER_URL}/tracks/${trackId}/waveform`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "PSC-Secret": UPLOAD_SECRET,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Failed to save waveform: ${res.status}`);
  const result = await res.json();
  return result.success;
}

/**
 * Analyze and save waveform for a track (D1 only — legacy, kept for fallback)
 */
export async function generateAndSaveWaveform(trackId, audioUrl, onProgress) {
  if (onProgress) onProgress(10);
  const { high, low, duration } = await analyzeAudio(audioUrl);
  const waveformData = { high, low };
  if (onProgress) onProgress(80);
  await saveWaveform(trackId, waveformData, duration);
  if (onProgress) onProgress(100);
  return waveformData;
}

/**
 * Pack bars array into a compact Uint8Array — 4 bytes per bar: bass, mid, high, peak (0–255).
 * Returns null for empty or invalid input.
 */
export function packToBinary(bars) {
  if (!bars || bars.length === 0) return null;
  const buf = new Uint8Array(bars.length * 4);
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    buf[i * 4]     = Math.round((b.bass ?? 0) * 255);
    buf[i * 4 + 1] = Math.round((b.mid  ?? 0) * 255);
    buf[i * 4 + 2] = Math.round((b.high ?? 0) * 255);
    buf[i * 4 + 3] = Math.round((b.peak ?? 0) * 255);
  }
  return buf;
}

/**
 * Decode a Uint8Array produced by packToBinary back into [{bass,mid,high,peak}] 0-1 floats.
 * Returns null if the buffer length is not a multiple of 4.
 */
export function unpackFromBinary(bytes) {
  if (!bytes || bytes.length % 4 !== 0) return null;
  const bars = new Array(bytes.length / 4);
  for (let i = 0; i < bars.length; i++) {
    bars[i] = {
      bass: bytes[i * 4]     / 255,
      mid:  bytes[i * 4 + 1] / 255,
      high: bytes[i * 4 + 2] / 255,
      peak: bytes[i * 4 + 3] / 255,
    };
  }
  return bars;
}

/**
 * Render a full-track waveform overview PNG using an OffscreenCanvas.
 * Returns a Blob (image/png) or null if OffscreenCanvas is unavailable.
 */
export async function renderWaveformPng(bars, width = 1200, height = 60) {
  if (typeof OffscreenCanvas === "undefined") return null;
  if (!bars || bars.length === 0) return null;

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);

  const N = bars.length;
  const barsPerPx = N / width;

  for (let px = 0; px < width; px++) {
    const bStart = Math.floor(px * barsPerPx);
    const bEnd   = Math.min(Math.ceil((px + 1) * barsPerPx) + 1, N);
    let maxPeak = 0, best = null;
    for (let b = bStart; b < bEnd; b++) {
      if (bars[b] && bars[b].peak > maxPeak) { maxPeak = bars[b].peak; best = bars[b]; }
    }
    if (!best) continue;
    const barH = Math.max(1, Math.round(maxPeak * height));
    const r = Math.round(best.bass * 255);
    const g = Math.round(best.mid  * 255);
    const bv = Math.round(best.high * 255);
    ctx.fillStyle = `rgb(${r},${g},${bv})`;
    ctx.fillRect(px, height - barH, 1, barH);
  }

  return canvas.convertToBlob({ type: "image/png" });
}

function uint8ToBase64(bytes) {
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Upload high-res binary and PNG waveform assets to R2 via the worker.
 * Throws on non-2xx response.
 */
export async function uploadWaveformAssets(trackId, binaryBytes, pngBlob, onProgress) {
  if (onProgress) onProgress(80);

  const b64bin = binaryBytes ? uint8ToBase64(binaryBytes) : null;

  let b64png = null;
  if (pngBlob) {
    const pngBuf = await pngBlob.arrayBuffer();
    b64png = uint8ToBase64(new Uint8Array(pngBuf));
  }

  if (onProgress) onProgress(90);

  const res = await fetch(`${WORKER_URL}/tracks/${trackId}/waveform-assets`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "PSC-Secret": UPLOAD_SECRET,
    },
    body: JSON.stringify({ binary_b64: b64bin, png_b64: b64png }),
  });

  if (!res.ok) throw new Error(`Failed to upload waveform assets: ${res.status}`);
  if (onProgress) onProgress(100);
  return res.json();
}

const BEAT_DETECTOR_FRAME_RATE = 50; // must match the barsPerSec passed to analyzeAudio below

/**
 * Extracted for unit testing (matches this codebase's established pattern —
 * resolveBpmAtTime, resolveDownbeatOffsetForQuantize — of pulling pure logic
 * out of I/O-heavy orchestration functions). Pure: no fetch, no AudioContext,
 * no canvas — just the branching in front of detectDownbeatPhase.
 *
 * Downbeat detection (PR2 Item 5) reuses whatever anchor granularity
 * tempoSegments already produced, no new parallel segmentation. Flat tempo
 * (the overwhelming majority of tracks) is exactly the regime where
 * dpBeatTrack's constant-spacing assumption holds, so its own beatTimesSec is
 * used directly. When drift is present, each anchor gets its own synthesized
 * local beat grid (synthesizeSegmentBeatGrid) so the downbeat phase is
 * detected against that segment's actual tempo, not a blended one.
 *
 * @returns {{detectedDownbeatOffset: number|null, detectedDownbeatConfidence: number|null, tempoSegmentsWithDownbeat: object[]|null}}
 */
export function computeDownbeatData(bars, detected, tempoSegments, duration, frameRate = BEAT_DETECTOR_FRAME_RATE) {
  if (!tempoSegments || tempoSegments.length === 0) {
    const downbeat = detectDownbeatPhase(bars, detected.beatTimesSec, { frameRate });
    return {
      detectedDownbeatOffset: downbeat?.downbeatOffset ?? null,
      detectedDownbeatConfidence: downbeat?.downbeatConfidence ?? null,
      tempoSegmentsWithDownbeat: tempoSegments,
    };
  }

  // detectedDownbeatOffset/Confidence stay null here — that data lives on the
  // anchors instead. Both top-level keys are still always present (even as
  // null) so the worker's `!== undefined` PATCH guard correctly clears stale
  // values on a track that flips between flat/drift-segmented between
  // Regenerates.
  const tempoSegmentsWithDownbeat = tempoSegments.map((anchor, i) => {
    const segmentEnd = tempoSegments[i + 1]?.time ?? duration;
    const grid = synthesizeSegmentBeatGrid(anchor.time, anchor.bpm, segmentEnd);
    const downbeat = detectDownbeatPhase(bars, grid, { frameRate });
    return downbeat
      ? { ...anchor, downbeatOffset: downbeat.downbeatOffset, downbeatConfidence: downbeat.downbeatConfidence }
      : anchor;
  });

  return { detectedDownbeatOffset: null, detectedDownbeatConfidence: null, tempoSegmentsWithDownbeat };
}

/**
 * Full v2 waveform generation: analyze audio, pack to binary, render PNG, upload both to R2.
 * Returns the bars array so callers can use it immediately without re-fetching from R2.
 *
 * Beat detection runs as a post-processing step over the already-computed
 * `bars` array — never a second pass over the audio file. This is what
 * keeps large-WAV analysis safe (see analyzeAudio()'s chunked-WAV warning)
 * and avoids doubling network/CPU cost on every Regenerate.
 */
export async function generateAndUploadWaveformV2(trackId, audioUrl, onProgress) {
  if (onProgress) onProgress(5);

  const { high: bars, duration } = await analyzeAudio(audioUrl, null, 80, 50);

  if (onProgress) onProgress(55);

  const envelope = onsetEnvelope(bars);
  const detected = dpBeatTrack(envelope, { frameRate: BEAT_DETECTOR_FRAME_RATE });
  // Runs on the raw envelope, not detected.beatTimesSec — dpBeatTrack's own
  // beat times are too smoothed to show real drift. null when tempo is
  // stable (the overwhelming majority of tracks) — callers must leave
  // beat_grid_points unset in that case, not write a spurious single-anchor
  // grid (see detectTempoSegments' header for why).
  const tempoSegments = detectTempoSegments(envelope, BEAT_DETECTOR_FRAME_RATE);

  const { detectedDownbeatOffset, detectedDownbeatConfidence, tempoSegmentsWithDownbeat } =
    computeDownbeatData(bars, detected, tempoSegments, duration);

  if (onProgress) onProgress(60);

  const binaryBytes = packToBinary(bars);
  // PNG is the visual art for the listener view — render it from the same bars data.
  // renderWaveformPng uses OffscreenCanvas (Chromium) and returns null on Safari.
  const pngBlob = await renderWaveformPng(bars);

  if (onProgress) onProgress(75);

  await uploadWaveformAssets(trackId, binaryBytes, pngBlob, (p) => {
    if (onProgress) onProgress(75 + Math.round(p * 0.25));
  });

  return {
    bars,
    duration,
    detectedBpm: detected.bpm,
    detectedBeatOffset: detected.beatOffsetSec,
    detectedBpmConfidence: detected.confidence,
    tempoSegments: tempoSegmentsWithDownbeat,
    detectedDownbeatOffset,
    detectedDownbeatConfidence,
  };
}
