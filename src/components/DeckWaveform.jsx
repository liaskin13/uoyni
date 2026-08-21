// Canvas waveform renderer. Serato model: bass→RED, mid→GREEN, high→BLUE.
// Single mixed-color bar per pixel; d.high drives height (hi-hat transient range).

import { useEffect, useRef } from "react";

export default function DeckWaveform({
  waveformData = null,
  currentTime = 0,
  duration = 1,
  onSeek = null,
  trackId = "default",
  width = 800,
  height = 200,
  hotCues = {},
  cueColors = [],
  zoom = 1,
  loopRegion = null,
  isGenerating = false,
  generatingPct = null,
  bpm = null,
  getTime = null,
}) {
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const displayZoomRef = useRef(zoom);

  const currentTimeRef = useRef(currentTime);
  const durationRef = useRef(duration);
  const zoomRef = useRef(zoom);
  // Live time function — updated every render so rAF closure always has latest.
  // When provided, bypasses React state for 60fps-smooth playhead positioning.
  const getTimeRef = useRef(getTime);
  getTimeRef.current = getTime;

  currentTimeRef.current = currentTime;
  durationRef.current = duration;
  zoomRef.current = zoom;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    let w = canvas.getBoundingClientRect().width || width;
    let h = canvas.getBoundingClientRect().height || height;

    function setupCanvas() {
      const rect = canvas.getBoundingClientRect();
      w = rect.width || width;
      h = rect.height || height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    }
    setupCanvas();

    // Percentile contrast stretch — computed once per waveformData change.
    // Maps p5→min height, p95→85% halfH so the full visual range is used
    // regardless of how compressed the source audio is.
    let p5 = 0, pRange = 1;
    if (waveformData && waveformData.length > 0 && waveformData[0]?.high !== undefined) {
      const sorted = waveformData.map(d => d.high).sort((a, b) => a - b);
      p5  = sorted[Math.floor(sorted.length * 0.05)];
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      pRange = Math.max(0.001, p95 - p5);
    }

    function draw() {
      const ct = getTimeRef.current ? getTimeRef.current() : currentTimeRef.current;
      const dur = durationRef.current;
      const zTarget = zoomRef.current;

      ctx.clearRect(0, 0, w, h);

      if (
        !waveformData ||
        !Array.isArray(waveformData) ||
        waveformData.length === 0
      ) {
        ctx.strokeStyle = "rgba(255,255,255,0.15)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();
        return;
      }
      const peaks = waveformData;
      const barCount = peaks.length;

      displayZoomRef.current += (zTarget - displayZoomRef.current) * 0.12;
      const displayZoom = displayZoomRef.current;

      const visibleBars = barCount / displayZoom;
      const playheadFrac = dur > 0 ? ct / dur : 0;
      const centerBar = playheadFrac * barCount;

      // Serato-style track-aware viewport: at track start/end, bars hug the
      // edge and the playhead moves toward center rather than showing empty space.
      const halfVisible = visibleBars / 2;
      let startBar, endBar, playheadX;
      if (centerBar < halfVisible) {
        // Near track start — left-align bars, playhead drifts from left
        startBar = 0;
        endBar = visibleBars;
        playheadX = (centerBar / visibleBars) * w;
      } else if (centerBar > barCount - halfVisible) {
        // Near track end — right-align bars, playhead drifts toward right
        endBar = barCount;
        startBar = barCount - visibleBars;
        playheadX = ((centerBar - startBar) / visibleBars) * w;
      } else {
        // Mid-track — centered playhead
        startBar = centerBar - halfVisible;
        endBar = centerBar + halfVisible;
        playheadX = w / 2;
      }
      const halfH = h / 2;
      const startTimeSec = startBar / 50;
      const endTimeSec = endBar / 50;

      // Loop region highlight
      if (loopRegion?.start != null && dur > 0) {
        const lsx =
          (((loopRegion.start / dur) * barCount - startBar) /
            (endBar - startBar)) *
          w;
        const lex =
          loopRegion.end != null
            ? (((loopRegion.end / dur) * barCount - startBar) /
                (endBar - startBar)) *
              w
            : playheadX;
        if (lex > lsx) {
          ctx.fillStyle = "rgba(0,204,204,0.12)";
          ctx.fillRect(Math.max(0, lsx), 0, Math.min(lex - lsx, w), h);
          ctx.strokeStyle = "rgba(0,204,204,0.5)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(Math.max(0, lsx), 0);
          ctx.lineTo(Math.max(0, lsx), h);
          ctx.stroke();
          if (loopRegion.end != null) {
            ctx.beginPath();
            ctx.moveTo(Math.min(lex, w), 0);
            ctx.lineTo(Math.min(lex, w), h);
            ctx.stroke();
          }
        }
      }

      // Beat grid — drawn before bars so bars render on top
      if (bpm && bpm > 0) {
        const beat4Sec = (60 / bpm) * 4;
        const beat8Sec = (60 / bpm) * 8;
        const firstBeat4 = Math.ceil(startTimeSec / beat4Sec) * beat4Sec;
        for (let t = firstBeat4; t <= endTimeSec + beat4Sec; t += beat4Sec) {
          const barIdx = Math.round(t / beat4Sec);
          const isPhrase = barIdx % 16 === 0;
          const isEight = Math.abs(t / beat8Sec - Math.round(t / beat8Sec)) < 0.01;
          const xPos = ((t * 50 - startBar) / (endBar - startBar)) * w;
          if (xPos < 0 || xPos > w) continue;
          if (isPhrase) {
            ctx.strokeStyle = "rgba(0,220,110,0.75)";
            ctx.lineWidth = 1.5;
          } else if (isEight) {
            ctx.strokeStyle = "rgba(0,220,110,0.55)";
            ctx.lineWidth = 1.5;
          } else {
            ctx.strokeStyle = "rgba(0,220,110,0.30)";
            ctx.lineWidth = 0.75;
          }
          ctx.beginPath();
          ctx.moveTo(xPos, 0);
          ctx.lineTo(xPos, h);
          ctx.stroke();
        }
        ctx.lineWidth = 1;
      }

      for (let px = 0; px < Math.ceil(w); px++) {
        const isPast = px < playheadX;
        const dimMult = isPast ? 0.62 : 1.0;
        const bLo = Math.floor(startBar + (px / w) * (endBar - startBar));
        const bHi = Math.ceil(startBar + ((px + 1) / w) * (endBar - startBar));
        let d = null, maxHigh = 0;
        for (let bi = bLo; bi <= bHi; bi++) {
          if (bi < 0 || bi >= barCount || !peaks[bi]) continue;
          if (peaks[bi].high > maxHigh) { maxHigh = peaks[bi].high; d = peaks[bi]; }
        }
        if (!d) continue;

        if (d.bass !== undefined) {
          const barH = Math.max(2, Math.min(halfH * 0.85, ((d.high - p5) / pRange) * halfH * 0.85));
          const rawR = Math.pow(d.bass, 1.5);
          const rawG = Math.pow(d.mid,  1.8);
          const rawB = Math.pow(d.high, 1.2);
          const wc   = Math.min(rawR, rawG, rawB) * 0.85;
          const r = Math.round(Math.min(1, rawR + wc) * 255 * dimMult);
          const g = Math.round(Math.min(1, rawG + wc) * 255 * dimMult);
          const b = Math.round(Math.min(1, rawB + wc) * 255 * dimMult);
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.fillRect(px, halfH - barH, 1, barH);
          ctx.fillRect(px, halfH,        1, barH);
        } else {
          const barH = Math.max(1, d.peak * halfH);
          const cr = Math.round(parseInt(d.freq.slice(1, 3), 16) * dimMult);
          const cg = Math.round(parseInt(d.freq.slice(3, 5), 16) * dimMult);
          const cb = Math.round(parseInt(d.freq.slice(5, 7), 16) * dimMult);
          ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
          ctx.fillRect(px, halfH - barH, 1, barH);
          ctx.fillRect(px, halfH, 1, barH);
        }
      }

      // Time ruler ticks + labels — drawn after bars so they're always visible
      ctx.lineWidth = 1;
      ctx.textAlign = "center";
      ctx.font = "7px 'Space Mono', monospace";
      for (
        let sec = Math.ceil(startTimeSec);
        sec <= Math.floor(endTimeSec);
        sec++
      ) {
        const xPos = ((sec * 50 - startBar) / (endBar - startBar)) * w;
        const is5 = sec % 5 === 0;
        const tickH = is5 ? 6 : 3;
        ctx.strokeStyle = `rgba(255,255,255,${is5 ? 0.6 : 0.28})`;
        ctx.beginPath();
        ctx.moveTo(xPos, 0);
        ctx.lineTo(xPos, tickH);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(xPos, h);
        ctx.lineTo(xPos, h - tickH);
        ctx.stroke();
        if (is5 && sec > 0 && xPos > 14 && xPos < w - 14) {
          const mm = Math.floor(sec / 60);
          const ss = String(sec % 60).padStart(2, "0");
          ctx.fillStyle = "rgba(255,255,255,0.50)";
          ctx.fillText(`${mm}:${ss}`, xPos, h - tickH - 2);
        }
      }

      // Bar number labels — drawn after bars, only when spacing allows
      if (bpm && bpm > 0) {
        const beat4Sec = (60 / bpm) * 4;
        const pxPerBar = ((beat4Sec * 50) / (endBar - startBar)) * w;
        if (pxPerBar >= 20) {
          ctx.font = "7px 'Space Mono', monospace";
          ctx.fillStyle = "rgba(0,220,110,0.60)";
          const firstBeat4 = Math.ceil(startTimeSec / beat4Sec) * beat4Sec;
          for (let t = firstBeat4; t <= endTimeSec + beat4Sec; t += beat4Sec) {
            const xPos = ((t * 50 - startBar) / (endBar - startBar)) * w;
            if (xPos < 6 || xPos > w - 6) continue;
            const barNum = Math.round(t / beat4Sec) + 1;
            ctx.fillText(`${barNum}`, xPos, 9);
          }
        }
      }
      ctx.textAlign = "left";

      // Center reference line
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, halfH);
      ctx.lineTo(w, halfH);
      ctx.stroke();

      // Playhead
      ctx.strokeStyle = "rgba(255,255,255,0.92)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, h);
      ctx.stroke();

      // Hot cue markers — positioned in zoomed window coordinates
      ctx.textAlign = "center";
      Object.entries(hotCues).forEach(([num, cue]) => {
        if (!cue || typeof cue.time !== "number") return;
        const n = parseInt(num, 10);
        const cueBar = (cue.time / dur) * barCount;
        const x = ((cueBar - startBar) / (endBar - startBar)) * w;
        if (x < -10 || x > w + 10) return;
        const color = cueColors[n - 1] || "#ffffff";
        const isB2 = n > 8;

        ctx.strokeStyle = color;
        ctx.lineWidth = isB2 ? 1.5 : 2;
        if (isB2) ctx.setLineDash([4, 3]);
        else ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
        ctx.setLineDash([]);

        if (isB2) {
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x - 6, h);
          ctx.lineTo(x + 6, h);
          ctx.lineTo(x, h - 12);
          ctx.closePath();
          ctx.stroke();
          ctx.fillStyle = color;
          ctx.font = "bold 7px 'Space Mono', monospace";
          ctx.fillText(num, x, h - 4);
        } else {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.moveTo(x - 6, 0);
          ctx.lineTo(x + 6, 0);
          ctx.lineTo(x, 12);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = "#000";
          ctx.font = "bold 7px 'Space Mono', monospace";
          ctx.fillText(num, x, 10);
        }
      });
      ctx.textAlign = "left";
    }

    draw();
    let raf;
    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (!prefersReduced) {
      const animate = () => {
        draw();
        raf = requestAnimationFrame(animate);
      };
      raf = requestAnimationFrame(animate);
      animFrameRef.current = raf;
    }

    const ro = new ResizeObserver(() => {
      setupCanvas();
      draw();
    });
    ro.observe(canvas);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    waveformData,
    trackId,
    width,
    height,
    hotCues,
    cueColors,
    zoom,
    loopRegion,
    bpm,
  ]);

  // Prevent page scroll when cursor is over waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e) => {
      e.preventDefault();
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);


  const handleClick = (e) => {
    if (!onSeek) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    if (zoom <= 1) {
      onSeek(frac * duration);
      return;
    }
    const totalBars = waveformData?.length ?? 1000;
    const visibleBars = Math.round(totalBars / zoom);
    const centerBar = Math.round((currentTime / duration) * totalBars);
    const halfVisible = visibleBars / 2;
    let startBar;
    if (centerBar < halfVisible) startBar = 0;
    else if (centerBar > totalBars - halfVisible) startBar = totalBars - visibleBars;
    else startBar = centerBar - Math.round(halfVisible);
    const clickedBar = startBar + Math.round(frac * visibleBars);
    onSeek(
      Math.max(0, Math.min((clickedBar / totalBars) * duration, duration)),
    );
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        position: "relative",
      }}
    >
      {isGenerating && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 2,
            pointerEvents: "none",
            fontSize: "0.6rem",
            fontFamily: "'Chakra Petch', monospace",
            color: "rgba(255,255,255,0.55)",
            letterSpacing: "0.12em",
          }}
        >
          {generatingPct != null ? `ANALYZING ${generatingPct}%` : "ANALYZING…"}
        </div>
      )}
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        style={{
          width: "100%",
          height: "100%",
          cursor: onSeek ? "pointer" : "default",
          display: "block",
          flex: 1,
        }}
      />
    </div>
  );
}
