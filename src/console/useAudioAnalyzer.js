// VU + spectrum analyzer: live FFT side-chain tap when playing, pre-analyzed fallback when paused.
// Energy Map always uses pre-analyzed waveformData (full-track view requires complete data).

import { useEffect, useRef } from "react";
import { getAudioElement, getAudioContext } from "../lib/audioEngine.js";

const BASS_HEX    = "#1464dc";
const MID_HEX     = "#14dc14";
const PEAK_TICK   = "rgba(240,237,232,0.85)";
const SPEC_N      = 150;
const FLOOR_PCT   = 0.06; // minimum bar height as fraction of canvas height
const BPM_BUF_SIZE = 240; // 4 seconds × ~60 Hz rAF rate
const BPM_BASS_CUTOFF_HZ = 860; // matches the original fixed 40-bin cutoff at fftSize=2048 (44.1kHz: 40 * 22050/1024 ≈ 861Hz)

// VU meter scale: 0 VU = -18 dBFS (SMPTE standard). Single source of truth —
// both the live rAF loop (needle normalization) and drawVuNeedle() (arc geometry
// + color split) must use these same values or the needle will disagree with the arc.
const VU_DISPLAY_MIN = -20;  // left end of arc (-20 VU)
const VU_DISPLAY_MAX = 6;    // right end of arc (+6 VU)

// D'Arsonval amplitude-linear normalization: needle deflection ∝ V_rms, not dB.
// 0 VU = -18 dBFS, so the amplitude range for our display window is:
const VU_AMP_MIN   = Math.pow(10, (VU_DISPLAY_MIN - 18) / 20);  // -38 dBFS ≈ 0.01259
const VU_AMP_MAX   = Math.pow(10, (VU_DISPLAY_MAX - 18) / 20);  // -12 dBFS ≈ 0.25119
const VU_AMP_RANGE = VU_AMP_MAX - VU_AMP_MIN;

// Convert linear amplitude (0-1+) to decibels full-scale (dBFS).
// reference=1.0: 0 dBFS = peak digital headroom
// floor=-60: values below -60 dBFS clamp to floor (silence threshold)
// 20*log10(x) undefined at x=0, so Math.max(v, 1e-6) prevents -Infinity.
// Exported for unit testing and VU calculation.
export function amplitudeTodBFS(value, floor = -60) {
  if (value <= 0) return floor;
  const dbfs = 20 * Math.log10(value);
  return Math.max(floor, dbfs);
}

// Maps frequency position + amplitude to 5-band RGB color, Bark critical-band boundaries
// (Zwicker & Terhardt 1980) — the ear's frequency-*resolution* scale, not octave/pitch
// spacing. Boundaries below are Hz values 20/534/1230/2579/5927/18000 converted through
// this file's own log-bar-position formula (freqT = i/(SPEC_N-1), same axis freqLo/freqHi
// use) so a bar's index and its color boundary agree on the same log scale. See
// /plan-design-review 2026-08-12 ("DECIDED — SA 5-band color scheme, Bark critical-band
// boundaries") for the full derivation, palette revisions, and colorblind verification.
// freqT: 0-1 position along the log-spaced 20Hz-18kHz bar axis.
// normH: 0-1 amplitude — scales opacity; brighter = louder.
// Exported for unit testing.
export const BAND_LOW_MIDLOW_T   = 0.482869; // 534Hz
export const BAND_MIDLOW_MID_T   = 0.605528; // 1230Hz
export const BAND_MID_MIDHIGH_T  = 0.714370; // 2579Hz
export const BAND_MIDHIGH_HIGH_T = 0.836697; // 5927Hz

export function specBarColor(normH, freqT, alpha = 1) {
  let r, g, b;
  if (freqT < BAND_LOW_MIDLOW_T) {
    // Low: red (unchanged anchor)
    r = 255;
    g = 0;
    b = 0;
  } else if (freqT < BAND_MIDLOW_MID_T) {
    // Mid-low: red-orange #ff5500 (deuteranopia-safety revision — see plan doc)
    r = 255;
    g = 85;
    b = 0;
  } else if (freqT < BAND_MID_MIDHIGH_T) {
    // Mid: green (unchanged anchor)
    r = 0;
    g = 255;
    b = 0;
  } else if (freqT < BAND_MIDHIGH_HIGH_T) {
    // Mid-high: cyan #00ffff (moved down from the old 3-band High anchor)
    r = 0;
    g = 255;
    b = 255;
  } else {
    // High: indigo #6600ff (ROYGBIV-correct top anchor, not an interpolated hue)
    r = 102;
    g = 0;
    b = 255;
  }
  // Amplitude modulates opacity: low amp = dim, high amp = bright
  const opacity = Math.max(0.2, normH); // floor at 0.2 to keep quiet bars visible
  return `rgba(${r}, ${g}, ${b}, ${alpha * opacity})`;
}

// Props: { isPlaying, waveformData, currentTime, duration, hotCues? }
// waveformData = array of { peak: 0-1, freq: "#rrggbb", bass?: 0-1, high?: 0-1 }
// Returns: { vuRef, vuRRef, specRef, energyRef, phiRef, bpmResultRef }
export default function useAudioAnalyzer({ isPlaying, waveformData, currentTime, duration, hotCues }) {
  const vuRef       = useRef(null);
  const vuRRef      = useRef(null);
  const specRef     = useRef(null);
  const energyRef   = useRef(null);
  const phiRef      = useRef(null);
  const rafRef      = useRef(null);
  const peakL       = useRef(0);
  const peakR       = useRef(0);
  const peakHeldL   = useRef(0);  // 1.5s hold timer value for VU peak hold
  const peakHeldR   = useRef(0);
  const peakHoldTimeL = useRef(0); // timestamp when peakHeld was last updated
  const peakHoldTimeR = useRef(0);
  const clipHeldL   = useRef(0);  // performance.now() timestamp of last clip event (value > 0.99)
  const clipHeldR   = useRef(0);
  const specPeakRef = useRef(new Float32Array(SPEC_N));

  // Live FFT state — created once, never recreated
  const audioCtxRef       = useRef(null);
  const analyserRef       = useRef(null);
  const freqDataRef       = useRef(null);
  const analyserSetupRef  = useRef(false); // guard: createMediaElementSource can only be called once

  // Frame counter for throttling energy map redraws (4fps on 60fps RAF)
  const frameCountRef = useRef(0);

  // BPM ring buffer — one bass-bin RMS sample per rAF frame (~60 Hz effective rate)
  const bpmBufferRef = useRef(new Float32Array(BPM_BUF_SIZE));
  const bpmWriteRef  = useRef(0);
  const bpmResultRef = useRef({ bpm: null, confidence: 0 });


  // EMA state for smooth needle gauges
  const vuLEmaRef        = useRef(0);
  const vuREmaRef        = useRef(0);
  const phiEmaRef        = useRef(0); // phase correlation smoothing
  const lastFrameTimeRef = useRef(performance.now());

  // Phase correlation state — left/right channel analysers for mono compatibility detection
  const lChannelAnalyserRef = useRef(null);
  const rChannelAnalyserRef = useRef(null);
  const lChannelDataRef     = useRef(null);
  const rChannelDataRef     = useRef(null);

  // liveRef carries values into the RAF loop without re-triggering the effect
  const liveRef = useRef({ waveformData, currentTime, duration, hotCues, isPlaying });
  liveRef.current = { waveformData, currentTime, duration, hotCues, isPlaying };

  // ── Live FFT setup ──────────────────────────────────────────────────────────
  // Called once when playback starts for the first time. Safe to call every
  // play event — the analyserSetupRef guard ensures createMediaElementSource
  // is only ever called once per page lifecycle (it permanently binds the element).
  function setupAnalyser() {
    if (analyserSetupRef.current) return; // singleton guard

    const audioEl = getAudioElement();
    if (!audioEl) return;

    // Use the shared AudioContext from audioEngine — it was created inside a user
    // gesture (prewarm() call in handlePlayPause), so it starts RUNNING, not suspended.
    // Creating a new AudioContext here (outside gesture scope via useEffect) would start
    // suspended and permanently silence audio after createMediaElementSource routes the
    // audio element through it.
    let audioCtx = getAudioContext();

    try {
      if (!audioCtx) {
        // Fallback: create our own and immediately try to resume
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        audioCtx = new AudioCtx();
        audioCtx.resume().catch(() => {});
      }

      const source   = audioCtx.createMediaElementSource(audioEl);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize               = 4096; // 2048 frequency bins — halves duplicate-bar count in sub-150Hz SA bars vs. 2048
      analyser.smoothingTimeConstant = 0.75;

      // Phase correlation: split stereo into L/R channels for mono compatibility detection
      const splitter = audioCtx.createChannelSplitter(2);
      const lAnalyser = audioCtx.createAnalyser();
      const rAnalyser = audioCtx.createAnalyser();
      lAnalyser.fftSize = rAnalyser.fftSize = 512; // smaller window for real-time correlation
      lAnalyser.smoothingTimeConstant = rAnalyser.smoothingTimeConstant = 0.3;

      // KEY: source → destination (audio still plays) AND source → analysers (side-chain taps).
      // Analysers are NOT inserted into the playback path — no dropout risk.
      source.connect(audioCtx.destination);
      source.connect(analyser);
      source.connect(splitter);
      splitter.connect(lAnalyser, 0);
      splitter.connect(rAnalyser, 1);

      audioCtxRef.current         = audioCtx;
      analyserRef.current         = analyser;
      freqDataRef.current         = new Uint8Array(analyser.frequencyBinCount);
      lChannelAnalyserRef.current = lAnalyser;
      rChannelAnalyserRef.current = rAnalyser;
      lChannelDataRef.current     = new Float32Array(lAnalyser.fftSize);
      rChannelDataRef.current     = new Float32Array(rAnalyser.fftSize);
      analyserSetupRef.current = true;
    } catch (err) {
      // AudioContext unavailable or blocked — fall back to pre-analyzed data silently
      console.warn("[useAudioAnalyzer] AudioContext setup failed, using pre-analyzed fallback:", err.message);
    }
  }

  // ── Main effect ─────────────────────────────────────────────────────────────
  // WCAG 2.3.3: Skip all animation (RAF loop) when prefers-reduced-motion is active.
  // This disables: VU bar EMA smoothing, spectrum peak decay, phase correlation EMA,
  // energy map animation. Phase meter still renders static state in idle/paused modes.
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    if (!isPlaying) {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      peakL.current = 0;
      peakR.current = 0;
      peakHeldL.current = 0;
      peakHeldR.current = 0;
      clipHeldL.current = 0;
      clipHeldR.current = 0;
      specPeakRef.current = new Float32Array(SPEC_N);
      frameCountRef.current = 0;

      // Draw idle state: neutral dim floor bars on spectrum, ghost segment structure on VU
      const spec = specRef.current;
      if (spec && spec.width > 0 && spec.height > 0) {
        const ctx = spec.getContext("2d");
        const W = spec.width, H = spec.height;
        ctx.clearRect(0, 0, W, H);
        const barStep = W / SPEC_N;
        const bw      = Math.max(1, Math.floor(barStep) - 1);
        const FLOOR   = Math.round(H * FLOOR_PCT);
        for (let i = 0; i < SPEC_N; i++) {
          ctx.fillStyle = "rgba(185, 185, 185, 0.12)";
          ctx.fillRect(Math.round(i * barStep), H - FLOOR, bw, FLOOR);
        }
      }
      const dpr = window.devicePixelRatio || 1;
      const vu = vuRef.current;
      if (vu) {
        const vuW = vu.offsetWidth || 60;
        const vuH = vu.offsetHeight || 120;
        const bsW = Math.round(vuW * dpr), bsH = Math.round(vuH * dpr);
        if (vu.width !== bsW || vu.height !== bsH) { vu.width = bsW; vu.height = bsH; }
        const ctx = vu.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawVuNeedle(ctx, vuW, vuH, { value: 0, peakValue: 0, showClip: false, channel: "L" });
      }
      const vuR = vuRRef.current;
      if (vuR) {
        const vuW = vuR.offsetWidth || 60;
        const vuH = vuR.offsetHeight || 120;
        const bsW = Math.round(vuW * dpr), bsH = Math.round(vuH * dpr);
        if (vuR.width !== bsW || vuR.height !== bsH) { vuR.width = bsW; vuR.height = bsH; }
        const ctx = vuR.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawVuNeedle(ctx, vuW, vuH, { value: 0, peakValue: 0, showClip: false, channel: "R" });
      }

      // Idle phi meter
      const phi = phiRef.current;
      if (phi) {
        const phiW = phi.offsetWidth || 60;
        const phiH = phi.offsetHeight || 120;
        const bsW = Math.round(phiW * dpr), bsH = Math.round(phiH * dpr);
        if (phi.width !== bsW || phi.height !== bsH) { phi.width = bsW; phi.height = bsH; }
        const ctx = phi.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawCorrelationMeter(ctx, phiW, phiH, 0);
      }

      // Draw energy map using available waveformData, or ghost grid if none loaded
      const energy = energyRef.current;
      if (energy) {
        const dispW = energy.offsetWidth || energy.width;
        const dispH = energy.offsetHeight || energy.height;
        if (dispW > 0 && dispH > 0) {
          if (energy.width !== dispW || energy.height !== dispH) {
            energy.width = dispW;
            energy.height = dispH;
          }
          const { waveformData: bars, currentTime: t, duration: dur, hotCues: cues } = liveRef.current;
          if (bars && bars.length > 0 && dur > 0) {
            drawEnergyMap(energy, bars, t, dur, cues);
          } else {
            drawEnergyMapIdle(energy);
          }
        }
      }

      return;
    }

    // Attempt live FFT setup on first play (singleton guard makes this safe to call repeatedly)
    setupAnalyser();

    function draw() {
      rafRef.current = requestAnimationFrame(draw);
      frameCountRef.current++;

      // Resume AudioContext if browser auto-suspended (happens after 30s inactivity)
      if (audioCtxRef.current?.state === "suspended") {
        audioCtxRef.current.resume();
      }

      const { waveformData: bars, currentTime: t, duration: dur, hotCues: cues } = liveRef.current;
      const hasPreAnalyzed = bars && bars.length > 0 && dur > 0;

      // ── Read live FFT data ────────────────────────────────────────────────
      let freqBins = null;
      if (analyserRef.current && freqDataRef.current) {
        analyserRef.current.getByteFrequencyData(freqDataRef.current);
        freqBins = freqDataRef.current;
      }

      // EMA dt clamp: prevents spike on first frame or after tab backgrounded
      const now = performance.now();
      const dt = Math.min(now - lastFrameTimeRef.current, 50);
      lastFrameTimeRef.current = now;
      const alpha = 1 - Math.exp(-dt / 300);

      // ── VU needle gauges (L + R) ─────────────────────────────────────────
      // Stereo channel measurement (true left/right RMS), not frequency-band energy
      const dprLive = window.devicePixelRatio || 1;
      let rL = 0, rR = 0;
      if (lChannelAnalyserRef.current && rChannelAnalyserRef.current
          && lChannelDataRef.current && rChannelDataRef.current) {
        // Live FFT: true stereo channel RMS measurement
        lChannelAnalyserRef.current.getFloatTimeDomainData(lChannelDataRef.current);
        rChannelAnalyserRef.current.getFloatTimeDomainData(rChannelDataRef.current);
        const lData = lChannelDataRef.current;
        const rData = rChannelDataRef.current;
        let lSumSq = 0, rSumSq = 0;
        for (let i = 0; i < lData.length; i++) {
          lSumSq += lData[i] * lData[i];
          rSumSq += rData[i] * rData[i];
        }
        rL = Math.sqrt(lSumSq / lData.length);  // true RMS: 0..1
        rR = Math.sqrt(rSumSq / rData.length);
      } else if (hasPreAnalyzed) {
        // Pre-analyzed fallback: use overall peak as symmetric RMS approximation
        const barIndex   = Math.min(Math.floor((t / dur) * bars.length), bars.length - 1);
        const W_HALF     = 7;
        const windowBars = bars.slice(Math.max(0, barIndex - W_HALF), Math.min(bars.length, barIndex + W_HALF + 1));
        const avgPeak    = windowBars.reduce((s, b) => s + b.peak, 0) / (windowBars.length || 1);
        rL = rR = avgPeak * 0.707;  // RMS ≈ peak / sqrt(2) ≈ peak * 0.707
      }

      peakL.current = Math.max(peakL.current * 0.97, rL);
      peakR.current = Math.max(peakR.current * 0.97, rR);

      // D'Arsonval: normalize rms amplitude directly — no log conversion needed.
      // rL/rR are true RMS (0..1 linear), VU_AMP_MIN/MAX precomputed at module level.
      const vuLNorm = Math.max(0, Math.min(1, (rL - VU_AMP_MIN) / VU_AMP_RANGE));
      vuLEmaRef.current = vuLEmaRef.current + alpha * (vuLNorm - vuLEmaRef.current);

      const vuRNorm = Math.max(0, Math.min(1, (rR - VU_AMP_MIN) / VU_AMP_RANGE));
      vuREmaRef.current = vuREmaRef.current + alpha * (vuRNorm - vuREmaRef.current);

      // ── Peak hold logic (1.5s hold, then ~8dB/sec decay) ────────────────────
      const PEAK_HOLD_TIME = 1500; // milliseconds
      const PEAK_DECAY_MULTIPLIER = Math.pow(10, -8 / (20 * 60)); // ~0.9857 per frame at 60fps

      // L channel peak hold
      if (vuLNorm > peakHeldL.current) {
        peakHeldL.current = vuLNorm;
        peakHoldTimeL.current = now;
      } else if (now - peakHoldTimeL.current > PEAK_HOLD_TIME) {
        peakHeldL.current *= PEAK_DECAY_MULTIPLIER;
        if (peakHeldL.current < 0.001) peakHeldL.current = 0;
      }

      // R channel peak hold
      if (vuRNorm > peakHeldR.current) {
        peakHeldR.current = vuRNorm;
        peakHoldTimeR.current = now;
      } else if (now - peakHoldTimeR.current > PEAK_HOLD_TIME) {
        peakHeldR.current *= PEAK_DECAY_MULTIPLIER;
        if (peakHeldR.current < 0.001) peakHeldR.current = 0;
      }

      // ── Clip indicator logic (2s hold after value > 0.99) ──────────────────
      const CLIP_HOLD_TIME = 2000;
      if (rL > 0.99) clipHeldL.current = now;
      if (rR > 0.99) clipHeldR.current = now;

      // ── Phase correlation (mono compatibility, -1 to +1) ─────────────────────
      // Note: L/R time-domain data already read above for VU measurement; reuse those buffers
      let phiRaw = 0;
      if (lChannelAnalyserRef.current && rChannelAnalyserRef.current && lChannelDataRef.current && rChannelDataRef.current) {
        const lData = lChannelDataRef.current;
        const rData = rChannelDataRef.current;
        let dotProd = 0, lNorm = 0, rNorm = 0;
        for (let i = 0; i < lData.length; i++) {
          dotProd += lData[i] * rData[i];
          lNorm += lData[i] * lData[i];
          rNorm += rData[i] * rData[i];
        }
        const denom = Math.sqrt(lNorm * rNorm);
        phiRaw = denom > 0.0001 ? dotProd / denom : 0;
      }
      // Guard against NaN propagation in EMA smoothing (defensive; audio should always be valid)
      if (!isNaN(phiRaw)) {
        phiEmaRef.current = phiEmaRef.current + alpha * (phiRaw - phiEmaRef.current);
      }

      // Clip indicator: shows if within 2s of clip event, fades out in last 200ms
      const CLIP_FADE_TIME = 200;
      const timeSinceClipL = now - clipHeldL.current;
      const timeSinceClipR = now - clipHeldR.current;
      const clipShowL = clipHeldL.current > 0 && timeSinceClipL < CLIP_HOLD_TIME;
      const clipShowR = clipHeldR.current > 0 && timeSinceClipR < CLIP_HOLD_TIME;
      const clipOpacityL = clipShowL ? Math.max(0, 1 - Math.max(0, timeSinceClipL - (CLIP_HOLD_TIME - CLIP_FADE_TIME)) / CLIP_FADE_TIME) : 0;
      const clipOpacityR = clipShowR ? Math.max(0, 1 - Math.max(0, timeSinceClipR - (CLIP_HOLD_TIME - CLIP_FADE_TIME)) / CLIP_FADE_TIME) : 0;

      const vu = vuRef.current;
      if (vu) {
        const vuW = vu.offsetWidth || 60;
        const vuH = vu.offsetHeight || 120;
        const bsW = Math.round(vuW * dprLive), bsH = Math.round(vuH * dprLive);
        if (vu.width !== bsW || vu.height !== bsH) { vu.width = bsW; vu.height = bsH; }
        const ctx = vu.getContext("2d");
        ctx.setTransform(dprLive, 0, 0, dprLive, 0, 0);
        drawVuNeedle(ctx, vuW, vuH, { value: vuLEmaRef.current, peakValue: peakHeldL.current, showClip: clipShowL, clipOpacity: clipOpacityL, channel: "L" });
      }
      const vuR = vuRRef.current;
      if (vuR) {
        const vuW = vuR.offsetWidth || 60;
        const vuH = vuR.offsetHeight || 120;
        const bsW = Math.round(vuW * dprLive), bsH = Math.round(vuH * dprLive);
        if (vuR.width !== bsW || vuR.height !== bsH) { vuR.width = bsW; vuR.height = bsH; }
        const ctx = vuR.getContext("2d");
        ctx.setTransform(dprLive, 0, 0, dprLive, 0, 0);
        drawVuNeedle(ctx, vuW, vuH, { value: vuREmaRef.current, peakValue: peakHeldR.current, showClip: clipShowR, clipOpacity: clipOpacityR, channel: "R" });
      }

      // ── Phase Correlation Meter (φ) ───────────────────────────────────────
      const phi = phiRef.current;
      if (phi) {
        const phiW = phi.offsetWidth || 60;
        const phiH = phi.offsetHeight || 120;
        const bsW = Math.round(phiW * dprLive), bsH = Math.round(phiH * dprLive);
        if (phi.width !== bsW || phi.height !== bsH) { phi.width = bsW; phi.height = bsH; }
        const ctx = phi.getContext("2d");
        ctx.setTransform(dprLive, 0, 0, dprLive, 0, 0);
        drawCorrelationMeter(ctx, phiW, phiH, phiEmaRef.current);
      }

      {  // BPM ring: separate block so it still runs after the canvas split

        // BPM ring: write bass-bin RMS each frame; detect every 30 frames (~500ms)
        if (freqBins) {
          // Hz-stable bass window — a fixed bin count would silently narrow this
          // range whenever fftSize/frequencyBinCount changes (see BPM_BASS_CUTOFF_HZ).
          const nyquistHz = audioCtxRef.current.sampleRate / 2;
          const bassEnd = Math.min(
            Math.max(1, Math.round((BPM_BASS_CUTOFF_HZ / nyquistHz) * freqBins.length)),
            freqBins.length,
          );
          let bassSum = 0;
          for (let i = 0; i < bassEnd; i++) bassSum += freqBins[i];
          const bassRms = bassSum / (bassEnd * 255);
          bpmBufferRef.current[bpmWriteRef.current % BPM_BUF_SIZE] = bassRms;
          bpmWriteRef.current++;
          if (frameCountRef.current % 30 === 0) {
            bpmResultRef.current = detectBpm(bpmBufferRef.current, 60);
          }
        }
      }


      // ── Spectrum (live FFT → per-bar color; pre-analyzed fallback when no FFT) ──
      const spec = specRef.current;
      if (spec) {
        const dispW = spec.offsetWidth;
        const dispH = spec.offsetHeight;
        const specW = Math.round(dispW * dprLive);
        const specH = Math.round(dispH * dprLive);
        if (dispW > 0 && dispH > 0 && (spec.width !== specW || spec.height !== specH)) {
          spec.width  = specW;
          spec.height = specH;
        }

        const ctx = spec.getContext("2d");
        ctx.setTransform(dprLive, 0, 0, dprLive, 0, 0);
        const W = dispW, H = dispH; // use display dimensions for drawing (DPR is handled by setTransform)
        ctx.clearRect(0, 0, W, H);

        const barStep  = W / SPEC_N;
        const bw       = Math.max(1, Math.floor(barStep) - 1); // 1px gap between bars
        const peakArr  = specPeakRef.current;
        const FLOOR    = Math.round(H * FLOOR_PCT);

        if (freqBins) {
          // Live FFT path: map frequencyBinCount bins to SPEC_N bars using logarithmic frequency spacing
          // Human hearing is logarithmic: 20Hz–18kHz should occupy bars evenly in perceived frequency
          const MIN_FREQ = 20;    // Hz — bottom of human hearing
          const MAX_FREQ = 18000; // Hz — top of useful music range (below Nyquist for 44.1kHz)
          const nyquist  = audioCtxRef.current.sampleRate / 2;
          const totalBins = freqBins.length;
          for (let i = 0; i < SPEC_N; i++) {
            // Log-spaced frequency edges for this bar
            const freqLo = MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, i / SPEC_N);
            const freqHi = MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, (i + 1) / SPEC_N);
            const binStart = Math.max(0, Math.floor(freqLo / nyquist * totalBins));
            const binEnd   = Math.min(totalBins, Math.ceil(freqHi / nyquist * totalBins));
            let sum = 0;
            for (let b = binStart; b < binEnd; b++) sum += freqBins[b];
            const avg    = sum / (binEnd - binStart || 1);
            const liveH  = Math.max(Math.round((avg / 255) * H * 0.90), FLOOR);
            const normH  = liveH / H;

            peakArr[i]   = Math.max(peakArr[i] * 0.985, liveH);
            const maxH   = Math.round(peakArr[i]);
            const x      = Math.round(i * barStep);

            // IntermodAnalyzer: salmon ghost fill from live top to peak-hold
            if (maxH > liveH + 1) {
              ctx.fillStyle = "rgba(225, 85, 68, 0.42)";
              ctx.fillRect(x, H - maxH, bw, maxH - liveH);
            }
            // Peak-hold line: bright 1px at peak position
            if (maxH > FLOOR) {
              ctx.fillStyle = "rgba(255, 255, 220, 0.9)";
              ctx.fillRect(x, H - maxH, bw, 1);
            }

            ctx.fillStyle = specBarColor(normH, i / (SPEC_N - 1));
            ctx.fillRect(x, H - liveH, bw, liveH);
          }
        } else if (hasPreAnalyzed) {
          // Pre-analyzed fallback (paused or AudioContext failed)
          const barIndex  = Math.min(Math.floor((t / dur) * bars.length), bars.length - 1);
          const specStart = Math.max(0, barIndex - SPEC_N);

          for (let i = 0; i < SPEC_N; i++) {
            const b     = bars[specStart + i];
            const liveH = b ? Math.max(Math.round(b.peak * H * 0.90), FLOOR) : FLOOR;
            const normH = liveH / H;

            peakArr[i]  = Math.max(peakArr[i] * 0.985, liveH);
            const maxH  = Math.round(peakArr[i]);
            const x     = Math.round(i * barStep);

            if (maxH > liveH + 1) {
              ctx.fillStyle = "rgba(225, 85, 68, 0.42)";
              ctx.fillRect(x, H - maxH, bw, maxH - liveH);
            }
            if (maxH > FLOOR) {
              ctx.fillStyle = "rgba(255, 255, 220, 0.9)";
              ctx.fillRect(x, H - maxH, bw, 1);
            }

            ctx.fillStyle = specBarColor(normH, i / (SPEC_N - 1));
            ctx.fillRect(x, H - liveH, bw, liveH);
          }
        } else {
          // No data at all — draw idle floor bars
          for (let i = 0; i < SPEC_N; i++) {
            const x = Math.round(i * barStep);
            ctx.fillStyle = specBarColor(FLOOR_PCT, i / (SPEC_N - 1));
            ctx.fillRect(x, H - FLOOR, bw, FLOOR);
          }
        }

        // Subtle dB reference grid lines drawn after bars so they read through them
        ctx.strokeStyle = "rgba(255,255,255,0.04)";
        ctx.lineWidth = 1;
        for (const frac of [0.25, 0.5, 0.75]) {
          const gy = Math.round(H * (1 - frac));
          ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
        }
      }

      // ── Energy Map (pre-analyzed only, throttled to ~4fps) ───────────────
      // Energy Map shows the FULL track at all times — requires complete waveformData.
      // Playhead tick updates every frame; full redraw every 15 frames.
      const energy = energyRef.current;
      if (energy && hasPreAnalyzed) {
        const doFullRedraw = frameCountRef.current % 15 === 1;

        if (doFullRedraw) {
          const dispW = energy.offsetWidth;
          const dispH = energy.offsetHeight;
          if (dispW > 0 && dispH > 0 && (energy.width !== dispW || energy.height !== dispH)) {
            energy.width  = dispW;
            energy.height = dispH;
          }
          drawEnergyMap(energy, bars, t, dur, cues);
        } else {
          // Cheap playhead-only update: redraw just the playhead line
          updateEnergyPlayhead(energy, t, dur);
        }
      }
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
  }, [isPlaying]); // only restarts on play/pause — values read live via liveRef

  // Secondary effect: redraw energy map whenever waveformData or playhead changes while paused.
  // The main RAF loop handles this when playing; this covers the static/scrubbing case.
  useEffect(() => {
    if (isPlaying) return;
    const energy = energyRef.current;
    if (!energy) return;
    const dispW = energy.offsetWidth || energy.width;
    const dispH = energy.offsetHeight || energy.height;
    if (dispW <= 0 || dispH <= 0) return;
    if (energy.width !== dispW || energy.height !== dispH) {
      energy.width = dispW;
      energy.height = dispH;
    }
    if (waveformData && waveformData.length > 0 && duration > 0) {
      drawEnergyMap(energy, waveformData, currentTime, duration, hotCues);
    } else {
      drawEnergyMapIdle(energy);
    }
  }, [waveformData, currentTime, duration, hotCues, isPlaying]);

  return { vuRef, vuRRef, specRef, energyRef, phiRef, bpmResultRef };
}

// ── Gauge scale definitions ──────────────────────────────────────────────────

// ── BPM detection ────────────────────────────────────────────────────────────

// Autocorrelation BPM detector on a ring buffer sampled at ~60 Hz (one sample per rAF frame).
// Beat period in frames = sampleRate * 60 / BPM:
//   180 BPM → 60*60/180 = 20 frames  (minPeriod)
//    60 BPM → 60*60/60  = 60 frames  (maxPeriod)
// ~7200 multiplications per call, runs every 500ms — trivially fast.
// Exported for unit testing.
export function detectBpm(buffer, sampleRate = 60) {
  const minPeriod = Math.floor(sampleRate * 60 / 180);
  const maxPeriod = Math.floor(sampleRate * 60 / 60);
  let bestLag = -1, bestCorr = 0;
  const n = buffer.length;
  for (let lag = minPeriod; lag <= Math.min(maxPeriod, n / 2); lag++) {
    let corr = 0, norm = 0;
    for (let i = 0; i < n - lag; i++) {
      corr += buffer[i] * buffer[i + lag];
      norm += buffer[i] * buffer[i] + buffer[i + lag] * buffer[i + lag];
    }
    const r = norm > 0 ? 2 * corr / norm : 0;
    if (r > bestCorr) { bestCorr = r; bestLag = lag; }
  }
  if (bestLag < 0) return { bpm: null, confidence: 0 };
  return { bpm: Math.round(sampleRate / bestLag * 60), confidence: bestCorr };
}

// ── Drawing helpers ──────────────────────────────────────────────────────────

// Analog VU needle meter (Midnight Marauders inspired).
// Arc-sweep needle from bottom-center pivot, colors from album palette.
function drawVuNeedle(ctx, W, H, opts) {
  const { value = 0, peakValue = 0, showClip = false, clipOpacity = 1, channel = "L" } = opts;
  const clamped = Math.max(0, Math.min(1, value));
  const peakClamped = Math.max(0, Math.min(1, peakValue));

  // Black canvas background
  ctx.fillStyle = "rgba(0,0,0,0.97)";
  ctx.fillRect(0, 0, W, H);

  // Warm gold glow radiating from bottom-center (hardware meter aesthetic) — BOOSTED
  const glowGradient = ctx.createRadialGradient(W / 2, H * 1.1, 0, W / 2, H * 1.1, W * 0.8);
  glowGradient.addColorStop(0, "rgba(184, 134, 11, 0.55)");  // warm gold center — BOOSTED from 0.35
  glowGradient.addColorStop(0.5, "rgba(139, 90, 0, 0.25)");   // fade to darker amber — BOOSTED from 0.15
  glowGradient.addColorStop(1, "rgba(0,0,0,0)");              // fade to transparent
  ctx.fillStyle = glowGradient;
  ctx.fillRect(0, 0, W, H);

  // VU scale — uses module-level constants so arc geometry stays in sync with needle normalization
  const VU_MIN = VU_DISPLAY_MIN;
  const VU_MAX = VU_DISPLAY_MAX;

  // Ellipse arc: independent rx/ry gives wide sweep + flat arc — impossible with a circle
  const ANGLE_MIN = 236.4;  // -20 VU: upper-left
  const ANGLE_MAX = 303.6;  // +6 VU:  upper-right (67.2° sweep, symmetric around 270°)

  const ellipseCX = W / 2;
  const ellipseCY = H * 0.88;   // pivot visible near bottom, like a real instrument
  const rx        = W * 0.687;  // horizontal radius — fills canvas width
  const ry        = H * 0.48;   // vertical radius — small relative to rx → flat arc

  const startRad = (ANGLE_MIN * Math.PI) / 180;
  const endRad   = (ANGLE_MAX * Math.PI) / 180;

  // Amplitude-linear normalization: same math as rAF loop (D'Arsonval — pow(10, vu/20))
  const labelAmpMin = Math.pow(10, VU_MIN / 20);  // 0.1
  const labelAmpMax = Math.pow(10, VU_MAX / 20);  // ~1.995

  // Two-color arc split at 0 VU
  const zeroNorm   = (1.0 - labelAmpMin) / (labelAmpMax - labelAmpMin);
  const zeroAngDeg = ANGLE_MIN + zeroNorm * (ANGLE_MAX - ANGLE_MIN);
  const zeroAngRad = (zeroAngDeg * Math.PI) / 180;

  // Safe zone arc (cream wire)
  ctx.strokeStyle    = "rgba(240, 237, 232, 0.80)";
  ctx.lineWidth      = 1.5;
  ctx.lineCap        = "round";
  ctx.shadowColor    = "transparent";
  ctx.shadowBlur     = 0;
  ctx.beginPath();
  ctx.ellipse(ellipseCX, ellipseCY, rx, ry, 0, startRad, zeroAngRad);
  ctx.stroke();

  // Hot zone arc — glow pass then crisp line
  ctx.shadowColor    = "rgba(204, 34, 0, 0.60)";
  ctx.shadowBlur     = 6;
  ctx.strokeStyle    = "#cc2200";
  ctx.lineWidth      = 2.0;
  ctx.lineCap        = "round";
  ctx.beginPath();
  ctx.ellipse(ellipseCX, ellipseCY, rx, ry, 0, zeroAngRad, endRad);
  ctx.stroke();
  ctx.shadowColor    = "transparent";
  ctx.shadowBlur     = 0;

  // Scale ticks and labels: 20 10 7 5 3 0 (cream) | 3 6 (red) — unsigned, pro console style
  const VU_LABELS = [-20, -10, -7, -5, -3, 0, 3, 6];
  const labelSize = Math.max(8, Math.min(9, H * 0.067));

  // Arc peak Y at top of ellipse (270°), fixed label row above it
  const arcPeakY      = ellipseCY - ry;
  const FIXED_LABEL_Y = arcPeakY - 10;    // label baseline (textBaseline=bottom)
  const TICK_TIP_Y    = FIXED_LABEL_Y + 3; // gap between tick top and label

  ctx.save();
  ctx.font = `600 ${Math.round(labelSize)}px 'Chakra Petch', sans-serif`;
  ctx.textBaseline = "bottom";

  for (const vuVal of VU_LABELS) {
    const normVal  = (Math.pow(10, vuVal / 20) - labelAmpMin) / (labelAmpMax - labelAmpMin);
    const angle    = ANGLE_MIN + normVal * (ANGLE_MAX - ANGLE_MIN);
    const angleRad = (angle * Math.PI) / 180;
    const isHot    = vuVal > 0;
    const tickColor = isHot ? "#cc2200" : "rgba(240, 237, 232, 0.85)";

    // Ellipse point for this label
    const arcX = ellipseCX + rx * Math.cos(angleRad);
    const arcY = ellipseCY + ry * Math.sin(angleRad);

    // Vertical tick from arc up to fixed tip row
    ctx.strokeStyle = tickColor;
    ctx.lineWidth   = 2.0;
    ctx.lineCap     = "round";
    ctx.beginPath();
    ctx.moveTo(arcX, arcY);
    ctx.lineTo(arcX, TICK_TIP_Y);
    ctx.stroke();

    // Label at fixed row — textAlign adjusts at canvas edges to prevent clipping
    if (arcX < 18)           ctx.textAlign = "left";
    else if (arcX > W - 18) ctx.textAlign = "right";
    else                     ctx.textAlign = "center";
    ctx.fillStyle = tickColor;
    ctx.fillText(String(Math.abs(vuVal)), arcX, FIXED_LABEL_Y);
  }

  // Minor ticks: -2, -1, +1, +2 — 4px hash marks, no label
  const VU_MINOR = [-2, -1, 1, 2];
  for (const vuVal of VU_MINOR) {
    const normVal  = (Math.pow(10, vuVal / 20) - labelAmpMin) / (labelAmpMax - labelAmpMin);
    const angle    = ANGLE_MIN + normVal * (ANGLE_MAX - ANGLE_MIN);
    const angleRad = (angle * Math.PI) / 180;
    const tickColor = vuVal > 0 ? "rgba(204, 34, 0, 0.7)" : "rgba(240, 237, 232, 0.7)";
    const arcX = ellipseCX + rx * Math.cos(angleRad);
    const arcY = ellipseCY + ry * Math.sin(angleRad);
    ctx.strokeStyle = tickColor;
    ctx.lineWidth   = 1.0;
    ctx.lineCap     = "butt";
    ctx.beginPath();
    ctx.moveTo(arcX, arcY);
    ctx.lineTo(arcX, arcY - 4);
    ctx.stroke();
  }
  ctx.restore();

  // "VU" — bolder, between arc and pivot
  ctx.save();
  ctx.font      = `700 ${Math.max(13, Math.min(16, Math.round(H * 0.12)))}px 'Chakra Petch', sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(240,237,232,0.6)";
  ctx.fillText("VU", ellipseCX, H * 0.65);
  ctx.restore();

  // 5 & 6. Needle with shadow (from ellipse pivot to arc surface)
  const needleAngle = ANGLE_MIN + clamped * (ANGLE_MAX - ANGLE_MIN);
  const needleAngleRad = (needleAngle * Math.PI) / 180;
  const needleX = ellipseCX + rx * Math.cos(needleAngleRad);
  const needleY = ellipseCY + ry * Math.sin(needleAngleRad);

  // Needle shadow (darker, offset +1px for depth)
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(ellipseCX + 1, ellipseCY + 1);
  ctx.lineTo(needleX + 1, needleY + 1);
  ctx.stroke();

  // Needle (white, bright) — hardware meter aesthetic
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.8;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(ellipseCX, ellipseCY);
  ctx.lineTo(needleX, needleY);
  ctx.stroke();

  // 7. Pivot cap (small filled circle, white) — visible at H*0.88
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(ellipseCX, ellipseCY, 3, 0, Math.PI * 2);
  ctx.fill();

  // 8. Peak hold tick (short segment at peak position on ellipse arc, 1.5s hold)
  if (peakClamped > 0.02) {
    const peakAngle = ANGLE_MIN + peakClamped * (ANGLE_MAX - ANGLE_MIN);
    const peakAngleRad = (peakAngle * Math.PI) / 180;
    const peakX1 = ellipseCX + 0.92 * rx * Math.cos(peakAngleRad);
    const peakY1 = ellipseCY + 0.92 * ry * Math.sin(peakAngleRad);
    const peakX2 = ellipseCX + rx * Math.cos(peakAngleRad);
    const peakY2 = ellipseCY + ry * Math.sin(peakAngleRad);
    ctx.strokeStyle = "rgba(240,237,232,0.9)";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(peakX1, peakY1);
    ctx.lineTo(peakX2, peakY2);
    ctx.stroke();
  }

  // Clip indicator: red LED circle (bottom-right) — hardware overload indicator style
  if (showClip) {
    const ledR = Math.max(4, W * 0.065);
    const ledX = W - ledR - 4;
    const ledY = H - ledR - 4;
    // Glow halo
    const ledGlow = ctx.createRadialGradient(ledX, ledY, 0, ledX, ledY, ledR * 2.5);
    ledGlow.addColorStop(0, `rgba(255, 68, 68, ${clipOpacity * 0.45})`);
    ledGlow.addColorStop(1, "rgba(255, 68, 68, 0)");
    ctx.fillStyle = ledGlow;
    ctx.beginPath();
    ctx.arc(ledX, ledY, ledR * 2.5, 0, Math.PI * 2);
    ctx.fill();
    // LED body
    ctx.fillStyle = `rgba(255, 68, 68, ${clipOpacity * 0.95})`;
    ctx.beginPath();
    ctx.arc(ledX, ledY, ledR, 0, Math.PI * 2);
    ctx.fill();
    // Specular highlight
    ctx.fillStyle = `rgba(255, 200, 200, ${clipOpacity * 0.55})`;
    ctx.beginPath();
    ctx.arc(ledX - ledR * 0.28, ledY - ledR * 0.32, ledR * 0.38, 0, Math.PI * 2);
    ctx.fill();
  }

  // Channel label at bottom corner (L = left, R = right)
  ctx.save();
  ctx.font = "500 9px 'Chakra Petch', sans-serif";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "rgba(185,185,185,0.60)";
  const isL = channel === "L";
  if (isL) {
    ctx.textAlign = "left";
    ctx.fillText(channel, 4, H - 2);  // bottom-left
  } else {
    ctx.textAlign = "right";
    ctx.fillText(channel, W - 4, H - 2);  // bottom-right
  }
  ctx.restore();
}

// Phase correlation meter (φ) — mono compatibility indicator (-1 to +1).
// -1 = fully anti-phase (cancels in mono), 0 = uncorrelated, +1 = mono-correlated (safe).
// Positive (in-phase) fills upward with green; negative (anti-phase) fills downward with red-orange.
// Tooltip: "Phase Correlation — +1: mono-safe, -1: cancels in mono"
function drawCorrelationMeter(ctx, W, H, correlation) {
  const clamped = Math.max(-1, Math.min(1, correlation));

  // Black background
  ctx.fillStyle = "rgba(0,0,0,0.97)";
  ctx.fillRect(0, 0, W, H);

  const midY = H / 2;

  // Center axis line
  ctx.strokeStyle = "rgba(185,185,185,0.3)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(W, midY);
  ctx.stroke();

  // Ghost segments when idle (faint outline structure)
  const segH = Math.round(H / 4);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  for (let i = 1; i <= 3; i++) {
    ctx.fillRect(0, midY - i * segH, W, 1);
    ctx.fillRect(0, midY + i * segH - 1, W, 1);
  }

  // Fill bars from center
  const barH = Math.abs(clamped) * (H / 2) * 0.85;
  if (clamped > 0) {
    // Positive (in-phase): green fill upward
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = "rgba(20, 220, 20, 0.8)";
    ctx.fillRect(0, midY - barH, W, barH);
    ctx.globalCompositeOperation = "source-over";
  } else if (clamped < 0) {
    // Negative (anti-phase): red-orange fill downward
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = "rgba(229, 96, 32, 0.8)";
    ctx.fillRect(0, midY, W, barH);
    ctx.globalCompositeOperation = "source-over";
  }

  // Current pointer (off-white line at position)
  const pointerY = midY - clamped * (H / 2) * 0.85;
  ctx.fillStyle = "rgba(240,237,232,0.85)";
  ctx.fillRect(0, pointerY - 1, W, 2);

  // Scale marks at -1, -0.5, 0, +0.5, +1
  ctx.save();
  ctx.font = "500 7px 'Space Mono', 'SF Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(185,185,185,0.40)";
  const marks = [-1, -0.5, 0, 0.5, 1];
  for (const val of marks) {
    const y = midY - val * (H / 2) * 0.85;
    // Tick mark
    ctx.fillRect(W / 2 - 3, y - 0.5, 6, 1);
    // Label at small mark
    if (val !== 0) {
      ctx.fillText(val === 0.5 || val === -0.5 ? val.toFixed(1) : val.toFixed(0), W * 0.75, y);
    }
  }
  ctx.restore();

  // Phi label (φ symbol) — same size/style as VU labels (L/R) for visual consistency
  ctx.save();
  ctx.font = "500 9px 'Chakra Petch', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "rgba(185,185,185,0.50)";
  ctx.fillText("φ", W / 2, H - 2);
  ctx.restore();
}

// Analog needle gauge — achromatic face, identity-colored needle tip only.
// arcColor: hex "#rrggbb" — used for needle tip + subtle glow only.
//   VU L/R: pass current --arch-identity value.
//   Loudness: pass "#f0ede8" (warm off-white, neutral combined signal).
// Full energy map redraw: full-track waveform envelope, playhead, hot cue marks.
function drawEnergyMap(canvas, bars, currentTime, duration, hotCues) {
  const ctx = canvas.getContext("2d");
  const W   = canvas.width;
  const H   = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const N          = bars.length;
  const barsPerPx  = N / W;
  const playheadPx = duration > 0 ? Math.round((currentTime / duration) * W) : -1;

  // Played-region darkening — subtle fill behind already-played portion
  if (playheadPx > 0) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
    ctx.fillRect(0, 0, playheadPx, H);
  }

  // Smooth peak envelope — average nearby bars so it reads as a curve, not individual spikes
  const smoothR = Math.max(1, Math.round(barsPerPx * 3));
  for (let px = 0; px < W; px++) {
    const center = Math.floor(px * barsPerPx + barsPerPx * 0.5);
    let   sum    = 0;
    let   count  = 0;
    for (let b = Math.max(0, center - smoothR); b < Math.min(N, center + smoothR); b++) {
      if (bars[b]) { sum += bars[b].peak; count++; }
    }
    const avg  = count > 0 ? sum / count : 0;
    const barH = Math.max(2, Math.round(Math.pow(avg, 0.7) * H));
    const dim  = px < playheadPx ? 0.35 : 0.7;
    ctx.fillStyle   = "rgba(20, 220, 20, 1)";
    ctx.globalAlpha = dim;
    ctx.fillRect(px, H - barH, 1, barH);
  }
  ctx.globalAlpha = 1;

  // Hot cue marks
  if (hotCues && duration > 0) {
    for (const cue of Object.values(hotCues)) {
      if (cue.time == null) continue;
      const cx = Math.round((cue.time / duration) * W);
      ctx.fillStyle = cue.color || "rgba(255,255,255,0.6)";
      ctx.fillRect(cx, 0, 1, H);
    }
  }

  // White progress bar — 2px line running left-to-right along the bottom edge
  if (playheadPx > 0) {
    ctx.fillStyle = "rgba(240, 237, 232, 0.85)";
    ctx.fillRect(0, H - 2, playheadPx, 2);
  }

  // Playhead — 3px bright line + halo + time readout
  if (playheadPx >= 0) {
    // Outer glow halo
    ctx.fillStyle = "rgba(240, 237, 232, 0.15)";
    ctx.fillRect(Math.max(0, playheadPx - 2), 0, 7, H);
    // Core line
    ctx.fillStyle = "rgba(240, 237, 232, 0.96)";
    ctx.fillRect(playheadPx, 0, 3, H);

    // Time readout — MM:SS above the playhead
    if (duration > 0) {
      const totalSec = Math.floor(currentTime);
      const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
      const ss = String(totalSec % 60).padStart(2, "0");
      const label = `${mm}:${ss}`;
      ctx.font = "bold 9px 'Chakra Petch', 'JetBrains Mono', monospace";
      ctx.textBaseline = "top";
      const tw = ctx.measureText(label).width;
      // Pin label so it doesn't run off right edge
      const lx = Math.min(playheadPx + 4, W - tw - 3);
      ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
      ctx.fillRect(lx - 2, 2, tw + 4, 12);
      ctx.fillStyle = "rgba(240, 237, 232, 0.92)";
      ctx.fillText(label, lx, 3);
      ctx.textBaseline = "alphabetic";
    }
  }
}

// Cheap playhead-only update for the energy map (skips full waveform redraw).
// The stored canvas pixel data persists; only the playhead line needs moving.
// Implementation: redraw two thin columns — erase old, draw new.
// This avoids storing a separate backing canvas while keeping CPU near zero.
// NOTE: Because we can't isolate "just the playhead" without double-buffering,
// we only call the full redraw at 4fps anyway — this function is a no-op placeholder
// that keeps the call site clean. The 15-frame throttle in the RAF loop handles pacing.
function updateEnergyPlayhead(_canvas, _currentTime, _duration) {
  // Intentionally empty — full redraw is throttled to 4fps in the RAF loop.
}

// Ghost grid drawn when no waveformData is loaded yet.
function drawEnergyMapIdle(canvas) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(185, 185, 185, 0.08)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = Math.round((i / 4) * H);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  ctx.strokeStyle = "rgba(185, 185, 185, 0.15)";
  const midY = Math.round(H / 2);
  ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(W, midY); ctx.stroke();
}

