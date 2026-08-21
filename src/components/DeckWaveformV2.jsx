// Screen-blend outline waveform renderer.
// Three continuous vector ribbon paths (bass/mid/high) with globalCompositeOperation='screen'
// so crossing strokes blend to white on loud multi-band moments.
// Drop-in replacement for DeckWaveform.jsx — identical props interface.

import { useEffect, useMemo, useRef } from "react";
import {
  buildGridSegments,
  segmentAt,
  snapToGridBeat,
  clampAnchorTime,
  hitTestAnchor,
} from "../lib/beatGrid";

const BARS_PER_SEC = 50;

// Playback-position smoothing for the draw loop — pure and exported so the
// dense-vs-sparse-source distinction is directly unit-testable, not only
// observable by eye on a canvas. See the call site in the draw() rAF loop
// for the full "why" (2026-08-20 loop-engine sticky-playhead investigation):
// short version, rawChanged compares the fresh source reading against the
// LAST RAW READING seen (state.lastRawSeen), never against the display's
// own drifting wall-clock extrapolation baseline (state.lastTime) — the
// previous version conflated the two, which made completely normal forward
// progress from a dense, continuously-accurate source (the gapless loop
// engine) register as a false "big jump/seek" roughly every 110-140ms.
//
// @param {number} rawTime current reading from the playback source (seconds)
// @param {number} now rAF high-res timestamp (ms)
// @param {boolean} isPlaying
// @param {boolean} isDragging
// @param {{lastRawSeen:number, lastTime:number, lastTimeUpdate:number}} state previous call's returned state
// @param {number} dur track duration (seconds) — display position never exceeds this
// @returns {{ct:number, state:{lastRawSeen:number, lastTime:number, lastTimeUpdate:number}}}
export function computeSmoothedPlayhead(rawTime, now, isPlaying, isDragging, state, dur) {
  const rawChanged = rawTime !== state.lastRawSeen;
  if (isPlaying && !isDragging && !rawChanged) {
    // No new ground-truth sample since last frame (the sparse-source case,
    // HTMLAudioElement between real timeupdate ticks) — extrapolate
    // smoothly via wall-clock elapsed time from the last known-good
    // baseline. State (the baseline) is intentionally NOT updated here —
    // it stays anchored at the last real sample until one arrives.
    const wallDelta = Math.min((now - state.lastTimeUpdate) / 1000, 0.35);
    const ct = Math.min(state.lastTime + wallDelta, dur);
    return { ct, state };
  }
  // Fresh ground truth this frame — dense source (loop engine), a sparse
  // source's timeupdate just landed, a real seek, or a genuine loop wrap.
  // In every one of those cases rawTime is already the correct value to
  // show; trust it directly and reset the baseline to it.
  return {
    ct: rawTime,
    state: { lastRawSeen: rawTime, lastTime: rawTime, lastTimeUpdate: now },
  };
}
// Above this drift (seconds) between the drag's local running position and
// the real live playhead, resync to the live value before applying the next
// drag delta — catches an external seek (loop enforcement forcing a hard
// seek, or the buffer engine engaging) landing mid-drag. Below it, this is
// just the normal small lag of the seek()->audio element roundtrip.
const DRAG_RESYNC_EPSILON_SEC = 0.05;
// Manual fine-tune (bars). Dynamic latency compensation is computed per-frame
// from audioCtx.outputLatency + baseLatency + rAF frame time — this is only
// needed if the auto value is off on specific hardware. Positive = shift forward.
const BEAT_OFFSET_BARS_DEFAULT = 0;

// Live-tunable override — no redeploy needed to test a value. In the browser
// console: localStorage.setItem('psc_beat_offset_bars', '12'); then reload.
// 1 bar = 20ms at BARS_PER_SEC=50, so a quarter second ≈ 12-13 bars.
// Clear with: localStorage.removeItem('psc_beat_offset_bars')
function getBeatOffsetBars() {
  try {
    const raw = localStorage.getItem("psc_beat_offset_bars");
    if (raw === null) return BEAT_OFFSET_BARS_DEFAULT;
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : BEAT_OFFSET_BARS_DEFAULT;
  } catch (_) {
    return BEAT_OFFSET_BARS_DEFAULT;
  }
}
const OFF_LOW  = 2;   // idle stacking offsets (px) — bass closest to center
const OFF_MID  = 5;
const OFF_HIGH = 9;   // high furthest out

export default function DeckWaveformV2({
  waveformData    = null,
  currentTime     = 0,
  duration        = 1,
  onSeek          = null,
  trackId         = "default",
  width           = 800,
  height          = 200,
  hotCues         = {},
  cueColors       = [],
  zoom            = 1,
  loopRegion      = null,
  isGenerating    = false,
  generatingPct   = null,
  bpm             = null,
  getTime         = null,
  getIsPlaying    = null,
  getAudioLatency = null,
  beatGridPoints        = [],
  onBeatGridPointsChange = null,
  identityColor          = "#14dc14",
  onHoverTime            = null, // T11 — reports the hovered time (or null on leave), reusing xToTime rather than making the caller reimplement this component's viewport windowing
}) {
  const canvasRef      = useRef(null);
  const rafRef         = useRef(null);
  const displayZoomRef = useRef(zoom);
  const isDraggingRef  = useRef(false);
  const lastDragXRef   = useRef(0);
  const seekedTimeRef  = useRef(0); // tracks accumulated seek during drag

  // All live values kept in refs — RAF closure reads them without stale captures.
  // No live prop goes in the useEffect dep array; only structural deps do.
  const getTimeRef   = useRef(getTime);
  const ctRef        = useRef(currentTime);
  const durRef       = useRef(duration);
  const zoomRef      = useRef(zoom);
  const hotCuesRef   = useRef(hotCues);
  const cueColorsRef = useRef(cueColors);
  const loopRef      = useRef(loopRegion);
  const bpmRef       = useRef(bpm);
  const bandsRef     = useRef(null);

  // Playback smoothing state — see computeSmoothedPlayhead above.
  const smoothStateRef = useRef({ lastRawSeen: 0, lastTime: 0, lastTimeUpdate: Date.now() });
  const getIsPlayingRef   = useRef(getIsPlaying);

  const getAudioLatencyRef = useRef(getAudioLatency);
  // Read once per mount — re-read localStorage by reloading the page between tests.
  const beatOffsetBarsRef  = useRef(getBeatOffsetBars());

  // ─── Beatgrid anchor editor state ──────────────────────────────────────
  const beatGridPointsRef     = useRef(beatGridPoints); // controlled — parent owns persistence
  const identityColorRef      = useRef(identityColor);
  const dragPreviewPointsRef  = useRef(null); // live-drag visual override; null when not dragging
  const draggingAnchorIdxRef  = useRef(-1);
  const selectedAnchorIdxRef  = useRef(-1); // keyboard focus, cycled via [ / ]
  const pauseGateLabelRef     = useRef({ show: false, x: 0, y: 0 }); // transient "PAUSE TO EDIT GRID"
  const pauseGateTimeoutRef   = useRef(null);
  const ANCHOR_HIT_TOLERANCE_SEC = 0.35; // generous enough for a mouse click, not so wide two nearby anchors collide

  getTimeRef.current        = getTime;
  getIsPlayingRef.current   = getIsPlaying;
  getAudioLatencyRef.current = getAudioLatency;
  ctRef.current        = currentTime;
  durRef.current       = duration;
  zoomRef.current      = zoom;
  hotCuesRef.current   = hotCues;
  cueColorsRef.current = cueColors;
  loopRef.current      = loopRegion;
  bpmRef.current       = bpm;
  beatGridPointsRef.current = beatGridPoints;
  identityColorRef.current  = identityColor;

  // Convert [{bass, mid, high, peak}] → typed arrays once per track load.
  // useMemo prevents re-creating up to 360 K × 3 Float32Arrays on every render.
  const bands = useMemo(() => {
    if (!waveformData?.length || waveformData[0]?.bass === undefined) return null;
    return {
      lowAmps:  Float32Array.from(waveformData, b => b.bass),
      midAmps:  Float32Array.from(waveformData, b => b.mid),
      highAmps: Float32Array.from(waveformData, b => b.high),
      barCount: waveformData.length,
    };
  }, [waveformData]);

  bandsRef.current = bands;

  // ─── Canvas setup + RAF loop ────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    let w = 0, h = 0;

    function setupCanvas() {
      const rect = canvas.getBoundingClientRect();
      w = rect.width  || width;
      h = rect.height || height;
      canvas.width  = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    }
    setupCanvas();

    // Reset smooth-zoom state when a new track loads
    displayZoomRef.current = zoomRef.current;

    function draw(now = performance.now()) {
      const rawTime = getTimeRef.current ? getTimeRef.current() : ctRef.current;
      const dur = durRef.current;
      const bds = bandsRef.current;

      // Playback smoothing — see computeSmoothedPlayhead's doc comment for
      // the full "why" (2026-08-20 loop-engine sticky-playhead investigation).
      const isPlaying = getIsPlayingRef.current?.() ?? false;
      const smoothed = computeSmoothedPlayhead(
        rawTime, now, isPlaying, isDraggingRef.current, smoothStateRef.current, dur,
      );
      const ct = smoothed.ct;
      smoothStateRef.current = smoothed.state;

      // Black base — screen composite requires a dark ground
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);

      if (!bds) {
        ctx.strokeStyle = "rgba(255,255,255,0.12)";
        ctx.lineWidth   = 1;
        ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
        return;
      }

      const { lowAmps, midAmps, highAmps, barCount } = bds;
      const halfH = h / 2;
      const scale = halfH * 0.82;

      // Smooth zoom interpolation — matches DeckWaveform feel
      displayZoomRef.current += (zoomRef.current - displayZoomRef.current) * 0.12;
      const displayZoom = displayZoomRef.current;

      const visibleBars = barCount / displayZoom;
      const playFrac    = dur > 0 ? ct / dur : 0;

      // Auto latency compensation: shift the visible window forward by the
      // total pipeline delay so the center line lands on the beat as it plays.
      //   audioHwLatency = outputLatency (OS→DAC) + baseLatency (Web Audio buffer)
      //   frameLatency   = one rAF cycle + GPU flip (~16.7ms at 60fps)
      const audioHwLatency    = getAudioLatencyRef.current?.() ?? 0;
      const frameLatency      = 1 / 60;
      const latencyBars       = (audioHwLatency + frameLatency) * BARS_PER_SEC;
      const centerBar         = playFrac * barCount + beatOffsetBarsRef.current + latencyBars;
      const halfVisible = visibleBars / 2;

      // Serato-aware viewport: playhead drifts at track start/end rather than
      // showing empty black space. Mid-track: playhead is centered.
      let startBar, endBar, playheadX;
      if (centerBar < halfVisible) {
        startBar  = 0;
        endBar    = visibleBars;
        playheadX = (centerBar / visibleBars) * w;
      } else if (centerBar > barCount - halfVisible) {
        endBar    = barCount;
        startBar  = barCount - visibleBars;
        playheadX = ((centerBar - startBar) / visibleBars) * w;
      } else {
        startBar  = centerBar - halfVisible;
        endBar    = centerBar + halfVisible;
        playheadX = w / 2;
      }

      const startTimeSec = startBar / BARS_PER_SEC;
      const endTimeSec   = endBar   / BARS_PER_SEC;

      // ─── Band outlines — screen composite ────────────────────────────────
      // Subsample: draw at most one point per canvas pixel — prevents 700K+
      // canvas ops per frame when the full track is visible (zoomed out).
      const step = Math.max(1, Math.floor((endBar - startBar) / w));

      function drawBand(amps, color, offset) {
        ctx.beginPath();
        let first = true;
        for (let i = Math.floor(startBar); i <= Math.ceil(endBar); i += step) {
          if (i < 0 || i >= barCount) continue;
          const x   = ((i - startBar) / (endBar - startBar)) * w;
          const amp = amps[i] ?? 0;
          const y   = halfH - (amp * scale + offset);
          if (first) { ctx.moveTo(x, y); first = false; }
          else ctx.lineTo(x, y);
        }
        for (let i = Math.ceil(endBar); i >= Math.floor(startBar); i -= step) {
          if (i < 0 || i >= barCount) continue;
          const x = ((i - startBar) / (endBar - startBar)) * w;
          ctx.lineTo(x, halfH + ((amps[i] ?? 0) * scale + offset));
        }
        ctx.closePath();
        ctx.strokeStyle = color;
        ctx.lineWidth   = 1.5;
        ctx.stroke();
        // No fill — outlines only
      }

      ctx.globalCompositeOperation = "screen";
      drawBand(lowAmps,  "rgba(255,0,0,0.8)",   OFF_LOW);
      drawBand(midAmps,  "rgba(0,255,0,0.8)",   OFF_MID);
      drawBand(highAmps, "rgba(0,255,255,0.8)", OFF_HIGH);
      ctx.globalCompositeOperation = "source-over";

      // ─── Past-portion dim ─────────────────────────────────────────────────
      if (playheadX > 0) {
        ctx.fillStyle = "rgba(0,0,0,0.38)";
        ctx.fillRect(0, 0, Math.min(playheadX, w), h);
      }

      // ─── Loop region ──────────────────────────────────────────────────────
      const loop = loopRef.current;
      if (loop?.start != null && dur > 0) {
        const lsx = (((loop.start / dur) * barCount - startBar) / (endBar - startBar)) * w;
        const lex = loop.end != null
          ? (((loop.end / dur) * barCount - startBar) / (endBar - startBar)) * w
          : playheadX;
        if (lex > lsx) {
          ctx.fillStyle = "rgba(0,204,204,0.12)";
          ctx.fillRect(Math.max(0, lsx), 0, Math.min(lex - lsx, w), h);
          ctx.strokeStyle = "rgba(0,204,204,0.5)";
          ctx.lineWidth   = 1.5;
          ctx.beginPath(); ctx.moveTo(Math.max(0, lsx), 0); ctx.lineTo(Math.max(0, lsx), h); ctx.stroke();
          if (loop.end != null) {
            ctx.beginPath(); ctx.moveTo(Math.min(lex, w), 0); ctx.lineTo(Math.min(lex, w), h); ctx.stroke();
          }
        }
      }

      // ─── Beat grid (multi-point aware — see src/lib/beatGrid.js) ───────────
      // dragPreviewPointsRef overrides the controlled points array during an
      // active anchor drag so the grid updates live without spamming the
      // parent (persistence happens once, on drop).
      const bp = bpmRef.current;
      const gridPoints = dragPreviewPointsRef.current || beatGridPointsRef.current;
      const segments = buildGridSegments(gridPoints, bp);
      const timeToX = (t) => ((t * BARS_PER_SEC - startBar) / (endBar - startBar)) * w;

      if (segments.length > 0) {
        ctx.font      = "7px 'Space Mono', monospace";
        ctx.fillStyle = "rgba(255,255,255,0.32)";
        ctx.textAlign = "center";

        for (let si = 0; si < segments.length; si++) {
          const seg = segments[si];
          const segStartTime = si === 0 ? -Infinity : seg.time; // first segment extends backward
          const segEndTime   = si < segments.length - 1 ? segments[si + 1].time : Infinity;
          const drawStart = Math.max(segStartTime, startTimeSec);
          const drawEnd   = Math.min(segEndTime, endTimeSec);
          if (drawStart > drawEnd) continue;

          const secPerBeat = 60 / seg.bpm;
          const secPer4    = secPerBeat * 4;
          const firstBeatT = seg.time + Math.floor((drawStart - seg.time) / secPerBeat) * secPerBeat;

          for (let t = firstBeatT; t <= drawEnd + secPerBeat; t += secPerBeat) {
            const beatIdx  = seg.beatsAtStart + Math.round((t - seg.time) / secPerBeat);
            const isBar    = beatIdx % 4  === 0;
            const isPhrase = beatIdx % 16 === 0;
            const xPos     = timeToX(t);
            if (xPos < 0 || xPos > w) continue;
            ctx.strokeStyle = isPhrase ? "rgba(255,255,255,0.22)"
                            : isBar   ? "rgba(255,255,255,0.10)"
                                      : "rgba(255,255,255,0.04)";
            ctx.lineWidth   = isPhrase ? 1 : 0.5;
            ctx.beginPath(); ctx.moveTo(xPos, 0); ctx.lineTo(xPos, h * 0.88); ctx.stroke();
          }

          // Bar number labels — only when bars are wide enough to read
          const pxPerBar = ((secPer4 * BARS_PER_SEC) / (endBar - startBar)) * w;
          if (pxPerBar >= 20) {
            const firstBar4T = seg.time + Math.ceil((drawStart - seg.time) / secPer4) * secPer4;
            for (let t = firstBar4T; t <= drawEnd + secPer4; t += secPer4) {
              const xPos = timeToX(t);
              if (xPos < 6 || xPos > w - 6) continue;
              const beatIdx = seg.beatsAtStart + Math.round((t - seg.time) / secPerBeat);
              ctx.fillText(String(Math.round(beatIdx / 4) + 1), xPos, 9);
            }
          }
        }
        ctx.textAlign = "left";

        // ─── Anchor markers + inter-anchor segment lines (only when real
        // multi-point data exists — a synthetic single flat-BPM segment
        // draws no markers, keeping the no-grid-points path byte-identical
        // to pre-multi-point-grid rendering) ─────────────────────────────
        const isPlayingNow = getIsPlayingRef.current?.() ?? false;
        if (gridPoints && gridPoints.length > 0) {
          const sortedPoints = [...gridPoints].sort((a, b) => a.time - b.time);
          const idleColor    = "rgba(240,237,232,0.55)";
          const dimOpacity   = 0.4;

          // Connecting line between consecutive anchors, at a fixed y near the top.
          ctx.strokeStyle = idleColor;
          ctx.lineWidth   = 1;
          ctx.globalAlpha = isPlayingNow ? dimOpacity : 1;
          for (let i = 0; i < sortedPoints.length - 1; i++) {
            const x1 = timeToX(sortedPoints[i].time);
            const x2 = timeToX(sortedPoints[i + 1].time);
            if (x2 < 0 || x1 > w) continue;
            ctx.beginPath();
            ctx.moveTo(Math.max(0, x1), 4);
            ctx.lineTo(Math.min(w, x2), 4);
            ctx.stroke();
          }

          sortedPoints.forEach((p, i) => {
            const x = timeToX(p.time);
            if (x < -6 || x > w + 6) return;
            const isDragging = i === draggingAnchorIdxRef.current;
            const isFocused  = !isDragging && i === selectedAnchorIdxRef.current;
            const y = 4;
            const r = 4; // 6x6px diamond = ~4px half-diagonal

            ctx.save();
            ctx.globalAlpha = isPlayingNow && !isDragging ? dimOpacity : 1;
            ctx.translate(x, y);
            ctx.rotate(Math.PI / 4);
            if (isDragging) {
              ctx.shadowColor = identityColorRef.current;
              ctx.shadowBlur  = 6;
              ctx.fillStyle   = identityColorRef.current;
              ctx.fillRect(-r / 2, -r / 2, r, r);
            } else if (isFocused) {
              ctx.strokeStyle = identityColorRef.current;
              ctx.lineWidth   = 1;
              ctx.strokeRect(-r / 2, -r / 2, r, r);
            } else {
              ctx.fillStyle = idleColor;
              ctx.fillRect(-r / 2, -r / 2, r, r);
            }
            ctx.restore();
          });
          ctx.globalAlpha = 1;
        } else if (!isPlayingNow) {
          // ─── Idle discoverability hint — beatgrid editing (double-click
          // to add an anchor, [/] to cycle, arrow keys to nudge) had zero
          // on-screen affordance before this: 100% invisible until you
          // already knew to type BEATGRID into COMMS. Only shows before
          // the first anchor is set, so it never fights the anchor UI
          // once discovered. Same idle-hint treatment as the onset-envelope
          // row's "HOVER WAVEFORM TO INSPECT ENVELOPE" (console-wide
          // button/discoverability audit, 2026-08-16).
          ctx.font = "7px 'Space Mono', monospace";
          ctx.textAlign = "center";
          ctx.fillStyle = "rgba(160,160,160,0.85)";
          ctx.fillText("DOUBLE-CLICK TO SET BEATGRID", w / 2, 9);
          ctx.textAlign = "left";
        }

        // ─── Transient "PAUSE TO EDIT GRID" cue ──────────────────────────
        if (pauseGateLabelRef.current.show) {
          ctx.font = "7px 'Space Mono', monospace";
          ctx.textAlign = "center";
          ctx.fillStyle = "rgba(160,160,160,0.85)";
          ctx.fillText("PAUSE TO EDIT GRID", pauseGateLabelRef.current.x, Math.max(12, pauseGateLabelRef.current.y));
          ctx.textAlign = "left";
        }
      }

      // ─── Time ruler ───────────────────────────────────────────────────────
      const secondsVisible = visibleBars / BARS_PER_SEC;
      const tickSec = secondsVisible > 120 ? 60
                    : secondsVisible > 40  ? 15
                    : secondsVisible > 15  ? 5
                    : secondsVisible > 5   ? 2 : 1;
      ctx.font      = "7px 'Space Mono', monospace";
      ctx.textAlign = "center";
      ctx.lineWidth = 1;
      for (let sec = Math.ceil(startTimeSec); sec <= Math.floor(endTimeSec); sec++) {
        if (sec % tickSec !== 0) continue;
        const xPos  = ((sec * BARS_PER_SEC - startBar) / (endBar - startBar)) * w;
        const tickH = 5;
        ctx.strokeStyle = "rgba(255,255,255,0.30)";
        ctx.beginPath(); ctx.moveTo(xPos, h - tickH); ctx.lineTo(xPos, h); ctx.stroke();
        if (xPos > 14 && xPos < w - 14) {
          const mm = Math.floor(sec / 60);
          const ss = String(sec % 60).padStart(2, "0");
          ctx.fillStyle = "rgba(255,255,255,0.38)";
          ctx.fillText(`${mm}:${ss}`, xPos, h - tickH - 2);
        }
      }
      ctx.textAlign = "left";

      // ─── Center reference line ────────────────────────────────────────────
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth   = 1;
      ctx.beginPath(); ctx.moveTo(0, halfH); ctx.lineTo(w, halfH); ctx.stroke();

      // ─── Hot cue markers ──────────────────────────────────────────────────
      ctx.textAlign = "center";
      Object.entries(hotCuesRef.current).forEach(([num, cue]) => {
        if (!cue || typeof cue.time !== "number") return;
        const n      = parseInt(num, 10);
        const cueBar = (cue.time / dur) * barCount;
        const x      = ((cueBar - startBar) / (endBar - startBar)) * w;
        if (x < -10 || x > w + 10) return;
        const color = cueColorsRef.current[n - 1] || "#ffffff";
        const isB2  = n > 8;

        ctx.strokeStyle = color;
        ctx.lineWidth   = isB2 ? 1.5 : 2;
        ctx.setLineDash(isB2 ? [4, 3] : []);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        ctx.setLineDash([]);

        if (isB2) {
          ctx.beginPath(); ctx.moveTo(x - 6, h); ctx.lineTo(x + 6, h); ctx.lineTo(x, h - 12); ctx.closePath(); ctx.stroke();
          ctx.fillStyle = color;
          ctx.font      = "bold 7px 'Space Mono', monospace";
          ctx.fillText(num, x, h - 4);
        } else {
          ctx.fillStyle = color;
          ctx.beginPath(); ctx.moveTo(x - 6, 0); ctx.lineTo(x + 6, 0); ctx.lineTo(x, 12); ctx.closePath(); ctx.fill();
          ctx.fillStyle = "#000";
          ctx.font      = "bold 7px 'Space Mono', monospace";
          ctx.fillText(num, x, 10);
        }
      });
      ctx.textAlign = "left";

      // ─── Playhead ─────────────────────────────────────────────────────────
      ctx.strokeStyle = "rgba(255,255,255,0.92)";
      ctx.lineWidth   = 2;
      ctx.beginPath(); ctx.moveTo(playheadX, 0); ctx.lineTo(playheadX, h); ctx.stroke();
    }

    draw();

    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!prefersReduced) {
      const loop = (ts) => { draw(ts); rafRef.current = requestAnimationFrame(loop); };
      rafRef.current = requestAnimationFrame(loop);
    }

    const ro = new ResizeObserver(() => { setupCanvas(); draw(); });
    ro.observe(canvas);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId, width, height]); // all live props read through refs — no restarts needed

  // Prevent accidental page scroll when cursor hovers over waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e) => e.preventDefault();
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  // Mirrors the viewport math used inside the draw loop / handleClick —
  // converts a screen X back to a track-time value.
  const xToTime = (clientX) => {
    const canvas = canvasRef.current;
    if (!canvas) return ctRef.current;
    const rect = canvas.getBoundingClientRect();
    const frac = (clientX - rect.left) / rect.width;
    const barCount = bandsRef.current?.barCount ?? waveformData?.length ?? 1000;
    const visibleBars = barCount / (displayZoomRef.current || zoomRef.current || 1);
    const dur = durRef.current;
    const playFrac = dur > 0 ? ctRef.current / dur : 0;
    const centerBar = playFrac * barCount;
    const halfVisible = visibleBars / 2;
    let startBar;
    if (centerBar < halfVisible) startBar = 0;
    else if (centerBar > barCount - halfVisible) startBar = barCount - visibleBars;
    else startBar = centerBar - halfVisible;
    const clickedBar = startBar + frac * visibleBars;
    return Math.max(0, Math.min((clickedBar / barCount) * dur, dur));
  };

  const showPauseGateLabel = (xPx) => {
    pauseGateLabelRef.current = { show: true, x: xPx, y: 14 };
    if (pauseGateTimeoutRef.current) clearTimeout(pauseGateTimeoutRef.current);
    pauseGateTimeoutRef.current = setTimeout(() => {
      pauseGateLabelRef.current = { ...pauseGateLabelRef.current, show: false };
    }, 1200);
  };

  const justFinishedAnchorDragRef = useRef(false);

  const handleMouseDown = (e) => {
    const points = beatGridPointsRef.current;
    if (points && points.length > 0) {
      const time = xToTime(e.clientX);
      const sorted = [...points].sort((a, b) => a.time - b.time);
      const hitIdx = hitTestAnchor(sorted, time, ANCHOR_HIT_TOLERANCE_SEC);
      if (hitIdx !== -1) {
        const isPlayingNow = getIsPlayingRef.current?.() ?? false;
        if (isPlayingNow) {
          const canvas = canvasRef.current;
          const rect = canvas?.getBoundingClientRect();
          showPauseGateLabel(rect ? e.clientX - rect.left : 0);
          e.preventDefault();
          return; // blocked — don't fall through to seek-drag either
        }
        draggingAnchorIdxRef.current = hitIdx;
        selectedAnchorIdxRef.current = hitIdx;
        dragPreviewPointsRef.current = sorted;
        e.preventDefault();
        return;
      }
    }
    isDraggingRef.current  = true;
    lastDragXRef.current   = e.clientX;
    seekedTimeRef.current  = ctRef.current;
    e.preventDefault();
  };

  const handleMouseMove = (e) => {
    onHoverTime?.(xToTime(e.clientX));
    if (draggingAnchorIdxRef.current !== -1) {
      const idx = draggingAnchorIdxRef.current;
      const points = dragPreviewPointsRef.current;
      if (!points) return;
      const time = xToTime(e.clientX);
      const clamped = clampAnchorTime(points, idx, time, durRef.current);
      dragPreviewPointsRef.current = points.map((p, i) =>
        i === idx ? { ...p, time: clamped } : p,
      );
      return;
    }
    if (!isDraggingRef.current || !onSeek) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // If something outside this drag moved the real playhead since the last
    // frame — loop enforcement forcing a hard seek back to loopRegion.start,
    // or the buffer engine engaging mid-drag — resync our local running
    // total to it first. Otherwise the drag's bookkeeping goes stale and the
    // next frame jumps by however far external code moved the playhead.
    const liveTime = getTimeRef.current ? getTimeRef.current() : null;
    if (liveTime != null && Math.abs(liveTime - seekedTimeRef.current) > DRAG_RESYNC_EPSILON_SEC) {
      seekedTimeRef.current = liveTime;
    }
    const dx            = e.clientX - lastDragXRef.current;
    lastDragXRef.current = e.clientX;
    const W             = canvas.getBoundingClientRect().width;
    const barCount      = bandsRef.current?.barCount ?? 1000;
    const visibleBars   = barCount / (displayZoomRef.current || 1);
    const secondsVisible = visibleBars / BARS_PER_SEC;
    // drag left = forward, drag right = backward (Serato convention)
    const dt  = -(dx / W) * secondsVisible;
    const next = Math.max(0, Math.min(durRef.current, seekedTimeRef.current + dt));
    seekedTimeRef.current = next;
    onSeek(next);
  };

  const handleMouseLeave = () => {
    handleMouseUp();
    onHoverTime?.(null);
  };

  const handleMouseUp = () => {
    if (draggingAnchorIdxRef.current !== -1) {
      const finalPoints = dragPreviewPointsRef.current;
      draggingAnchorIdxRef.current = -1;
      dragPreviewPointsRef.current = null;
      justFinishedAnchorDragRef.current = true;
      if (onBeatGridPointsChange && finalPoints) onBeatGridPointsChange(finalPoints);
      return;
    }
    isDraggingRef.current = false;
  };

  const handleClick = (e) => {
    if (justFinishedAnchorDragRef.current) {
      justFinishedAnchorDragRef.current = false;
      return; // don't seek right after dropping an anchor
    }
    // Ignore if the user was dragging (moved more than 4px)
    if (Math.abs(e.clientX - lastDragXRef.current) > 4) return;
    if (!onSeek) return;
    const canvas    = canvasRef.current;
    const rect      = canvas.getBoundingClientRect();
    const frac      = (e.clientX - rect.left) / rect.width;
    const barCount  = waveformData?.length ?? 1000;
    const visibleBars = Math.round(barCount / zoom);
    const centerBar   = Math.round((currentTime / duration) * barCount);
    const halfVisible = visibleBars / 2;
    let startBar;
    if (centerBar < halfVisible)                 startBar = 0;
    else if (centerBar > barCount - halfVisible) startBar = barCount - visibleBars;
    else                                         startBar = centerBar - Math.round(halfVisible);
    const clickedBar = startBar + Math.round(frac * visibleBars);
    onSeek(Math.max(0, Math.min((clickedBar / barCount) * duration, duration)));
  };

  // Double-click empty grid space inserts a new anchor, snapped to the
  // nearest beat boundary of the surrounding segment (see snapToGridBeat —
  // this reuses the existing beat-grid math rather than requiring a
  // separately-persisted onset-transient array). Double-click on an
  // existing anchor is a no-op (not a delete gesture — out of scope).
  const handleDoubleClick = (e) => {
    if (!onBeatGridPointsChange) return;
    const isPlayingNow = getIsPlayingRef.current?.() ?? false;
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    if (isPlayingNow) {
      showPauseGateLabel(rect ? e.clientX - rect.left : 0);
      return;
    }
    const time = xToTime(e.clientX);
    const points = beatGridPointsRef.current || [];
    const sorted = [...points].sort((a, b) => a.time - b.time);
    if (hitTestAnchor(sorted, time, ANCHOR_HIT_TOLERANCE_SEC) !== -1) return;

    const segments = buildGridSegments(sorted, bpmRef.current);
    if (segments.length === 0) return; // no BPM info to seed a new anchor from
    const snapped = snapToGridBeat(segments, time);
    const seg = segmentAt(segments, snapped);
    const updated = [...sorted, { time: snapped, bpm: seg.bpm }].sort(
      (a, b) => a.time - b.time,
    );
    onBeatGridPointsChange(updated);
  };

  // Keyboard alternative to dragging (design review Issue 5): [ / ] cycles
  // focus between anchors (not Tab — hijacking native Tab focus order is a
  // worse a11y regression than the feature it'd add), arrow keys nudge the
  // focused anchor by one beat (Shift+arrow: one bar). stopPropagation on
  // the nudge keys is required — the console's global keyboard shortcuts
  // also bind ArrowLeft/ArrowRight to seeking.
  const handleKeyDown = (e) => {
    const points = beatGridPointsRef.current;
    if (!points || points.length === 0) return;
    const sorted = [...points].sort((a, b) => a.time - b.time);

    if (e.key === "[" || e.key === "]") {
      e.preventDefault();
      e.stopPropagation();
      const cur = selectedAnchorIdxRef.current;
      selectedAnchorIdxRef.current =
        cur === -1
          ? (e.key === "]" ? 0 : sorted.length - 1)
          : e.key === "]"
            ? (cur + 1) % sorted.length
            : (cur - 1 + sorted.length) % sorted.length;
      return;
    }

    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const idx = selectedAnchorIdxRef.current;
    if (idx === -1 || idx >= sorted.length) return;

    const isPlayingNow = getIsPlayingRef.current?.() ?? false;
    if (isPlayingNow) {
      e.preventDefault();
      e.stopPropagation();
      const canvas = canvasRef.current;
      showPauseGateLabel(canvas ? canvas.getBoundingClientRect().width / 2 : 0);
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    const anchor = sorted[idx];
    const seg = segmentAt(buildGridSegments(sorted, bpmRef.current), anchor.time);
    const beatSeconds = seg ? 60 / seg.bpm : 0.5;
    const nudge = (e.shiftKey ? beatSeconds * 4 : beatSeconds) * (e.key === "ArrowRight" ? 1 : -1);
    const clamped = clampAnchorTime(sorted, idx, anchor.time + nudge, durRef.current);
    const updated = sorted.map((p, i) => (i === idx ? { ...p, time: clamped } : p));
    if (onBeatGridPointsChange) onBeatGridPointsChange(updated);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", position: "relative" }}>
      {isGenerating && (
        <div style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%, -50%)", zIndex: 2,
          pointerEvents: "none", fontSize: "0.6rem",
          fontFamily: "'Chakra Petch', monospace",
          color: "rgba(255,255,255,0.55)", letterSpacing: "0.12em",
        }}>
          {generatingPct != null ? `ANALYZING ${generatingPct}%` : "ANALYZING…"}
        </div>
      )}
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onKeyDown={handleKeyDown}
        tabIndex={onBeatGridPointsChange ? 0 : undefined}
        aria-label="Waveform with editable beatgrid"
        style={{ width: "100%", height: "100%", cursor: onSeek ? "ew-resize" : "default", display: "block", flex: 1, userSelect: "none" }}
      />
    </div>
  );
}
