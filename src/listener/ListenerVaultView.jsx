import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { fetchPublishedVaultTracks, getAudioUrl } from '../lib/tracks';
import * as audioEngine from '../lib/audioEngine';
import { getWaveformBars } from '../utils/waveform';
import { R2_PUBLIC_URL } from '../config';
import './ListenerVaultView.css';

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return '--:--';
  const s = Math.round(Number(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// Parse waveform data into bars. New tracks: {bass,mid,high,peak} 0-1 floats.
// Legacy tracks: {peak, freq} hex string — renderer handles both formats.
function parseWaveformBars(track, count = 400) {
  try {
    const raw = JSON.parse(track.waveform_data || 'null');
    if (raw?.high?.length > 0) {
      const arr = Array.from(raw.high);
      const samples = Array.from({ length: count }, (_, i) => {
        const idx = Math.floor(i * arr.length / count);
        const bar = arr[idx];
        if (bar && typeof bar === 'object') {
          if (bar.bass !== undefined) {
            // New 3-band format — already normalized 0-1 by the analyzer
            return { peak: bar.peak || 0, bass: bar.bass || 0, mid: bar.mid || 0, high: bar.high || 0 };
          }
          return { peak: Math.abs(bar.peak || 0), freq: bar.freq || '#14dc14' };
        }
        return { peak: Math.abs(bar || 0), freq: '#14dc14' };
      });
      if (samples[0]?.bass !== undefined) return samples; // already normalized
      const max = Math.max(...samples.map(s => s.peak), 0.001);
      return samples.map(s => ({ peak: s.peak / max, freq: s.freq }));
    }
  } catch {}
  return getWaveformBars(track.id, count).map(v => ({ peak: v / 100, freq: '#14dc14' }));
}

// Maps GEOB freq color to Serato display [r, g, b]
function seratoRgb(freq) {
  if (freq === '#1464dc') return [20, 100, 220];   // bass → blue (#1464dc, Serato)
  if (freq === '#e56020') return [229, 96, 32];    // high → warm orange (Serato standard)
  return [20, 220, 20];                             // mid → Serato green
}

// Maps normalized amplitude to a heat-map color (red → orange → green → cyan-white)
function heatColor(normH, alpha) {
  if (normH > 0.88) return `rgba(210, 255, 248, ${alpha})`;
  if (normH > 0.70) return `rgba(40, 235, 185, ${alpha})`;
  if (normH > 0.45) return `rgba(40, 215, 40, ${alpha})`;
  if (normH > 0.25) return `rgba(205, 148, 0, ${alpha})`;
  return `rgba(200, 28, 0, ${alpha})`;
}

function hexAlpha(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Draws the thin full-track overview strip.
// Serato standard: Low=RED, Mid=GREEN, Hi=BLUE → rgb(bass, mid, high).
function drawOverview(canvas, bars, currentTime, duration) {
  const rect = canvas.getBoundingClientRect();
  const W = rect.width || canvas.offsetWidth;
  const H = rect.height || canvas.offsetHeight || 16;
  if (!W) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const N = bars.length;
  const barsPerPx = N / W;

  for (let px = 0; px < W; px++) {
    const bStart = Math.floor(px * barsPerPx);
    const bEnd = Math.min(Math.ceil((px + 1) * barsPerPx) + 1, N);
    let maxPeak = 0, best = null;
    for (let b = bStart; b < bEnd; b++) {
      if (bars[b] && bars[b].peak > maxPeak) { maxPeak = bars[b].peak; best = bars[b]; }
    }
    if (!best) continue;

    const overallH = Math.max(1, Math.round(maxPeak * H * 0.85));

    if (best.bass !== undefined) {
      const r = Math.round(best.bass * 255);
      const g = Math.round(best.mid  * 255);
      const b = Math.round(best.high * 255);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(px, H - overallH, 1, overallH);
    } else {
      const [r, g, bv] = seratoRgb(best.freq);
      ctx.fillStyle = `rgb(${r},${g},${bv})`;
      ctx.fillRect(px, H - overallH, 1, overallH);
    }
  }

  // Playhead marker
  if (duration > 0) {
    const px = Math.round((currentTime / duration) * W);
    ctx.fillStyle = 'rgba(240,237,232,0.9)';
    ctx.fillRect(Math.max(0, px - 1), 0, 2, H);
  }
}

// Main scrolling zoom waveform canvas
function WaveformCanvas({ track, currentTime, duration, ghost = false, onSeek, mode = 'wave' }) {
  const mainRef = useRef(null);
  const overviewRef = useRef(null);
  const ctRef = useRef(currentTime);
  const durRef = useRef(duration);
  const isDraggingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => { ctRef.current = currentTime; }, [currentTime]);
  useEffect(() => { durRef.current = duration; }, [duration]);

  const parsedBars = useMemo(
    () => parseWaveformBars(track, 1000),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [track.id, track.waveform_data]
  );
  const barsRef = useRef(parsedBars);
  useEffect(() => { barsRef.current = parsedBars; }, [parsedBars]);

  const draw = useCallback(() => {
    const ct = ctRef.current;
    const dur = durRef.current;
    const bars = barsRef.current;

    // Overview strip
    if (!ghost && overviewRef.current) {
      drawOverview(overviewRef.current, bars, ct, dur);
    }

    const canvas = mainRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const W = rect.width || canvas.offsetWidth;
    const H = rect.height || canvas.offsetHeight || 200;
    if (!W) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const totalBars = bars.length;

    if (ghost) {
      // Full-width ghost — off-white, no zoom, no playhead
      const step = W / totalBars;
      const barW = Math.max(1, step * 0.65);
      bars.forEach((bar, i) => {
        const h = Math.max(2, bar.peak * H * 0.85);
        ctx.fillStyle = 'rgba(240,237,232,0.13)';
        ctx.fillRect(i * step, (H - h) / 2, barW, h);
      });
      return;
    }

    // Scrolling zoom: 200 bars centered on playhead — center is always "now",
    // time spreads left (past) and right (future) symmetrically.
    const VISIBLE = 200;
    const centerBarIdx = dur > 0 ? Math.round((ct / dur) * totalBars) : 0;
    const halfVis = Math.floor(VISIBLE / 2);
    const startBar = Math.max(0, Math.min(centerBarIdx - halfVis, totalBars - VISIBLE));
    const endBar   = Math.min(totalBars, startBar + VISIBLE);
    const barCount = endBar - startBar;
    const playheadX = barCount > 0 ? ((centerBarIdx - startBar) / barCount) * W : W / 2;

    // Pixel-resolution waveform: one bar per column, color encodes frequency.
    // Height = peak amplitude. Serato standard: rgb(bass, mid, high).
    // Played side dimmed to ~45%, future side full brightness.
    const halfH = H / 2;
    const totalCols = Math.ceil(W);

    for (let px = 0; px < totalCols; px++) {
      const played  = px < playheadX;
      const dimMult = played ? 0.45 : 1.0;

      const barIdx = Math.floor(startBar + (px / W) * barCount);
      const bar = bars[Math.max(0, Math.min(bars.length - 1, barIdx))];
      if (!bar) continue;

      if (mode === 'freq') {
        const h = Math.max(2, bar.peak * H * 0.88);
        ctx.fillStyle = heatColor(bar.peak, played ? 0.92 : 0.45);
        ctx.fillRect(px, (H - h) / 2, 1, h);
      } else if (bar.bass !== undefined) {
        const barH = Math.max(1, bar.peak * halfH * 0.96);
        const r = Math.round(bar.bass * 255 * dimMult);
        const g = Math.round(bar.mid  * 255 * dimMult);
        const b = Math.round(bar.high * 255 * dimMult);

        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(px, halfH - barH, 1, barH);
        ctx.fillRect(px, halfH,        1, barH);
      } else {
        const [r, g, bv] = seratoRgb(bar.freq);
        const h = Math.max(2, bar.peak * H * 0.88);
        ctx.fillStyle = `rgb(${Math.round(r*dimMult)},${Math.round(g*dimMult)},${Math.round(bv*dimMult)})`;
        ctx.fillRect(px, (H - h) / 2, 1, h);
      }
    }

    // Center line (subtle reference)
    ctx.fillStyle = 'rgba(240,237,232,0.06)';
    ctx.fillRect(0, H / 2, W, 1);

    // Playhead — always centered
    ctx.save();
    ctx.fillStyle = 'rgba(240,237,232,0.88)';
    ctx.shadowColor = 'rgba(240,237,232,0.5)';
    ctx.shadowBlur = 8;
    ctx.fillRect(Math.round(playheadX) - 1, 0, 2, H);
    ctx.restore();
  }, [ghost, mode]); // bars/ct/dur come from refs

  // Stable ResizeObserver on main canvas — triggers draw on layout changes
  useEffect(() => {
    const canvas = mainRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);
    const raf = requestAnimationFrame(() => draw());
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, [draw]);

  // rAF loop — keeps scrolling without prop-driven re-renders. Skipped
  // entirely in ghost mode: static bars, no playhead, nothing to animate —
  // the ResizeObserver effect above already draws it once on mount/resize.
  useEffect(() => {
    if (ghost) return;
    let rafId;
    const loop = () => { draw(); rafId = requestAnimationFrame(loop); };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [draw, ghost]);

  const performSeekFromEvent = useCallback((e) => {
    if (!onSeek) return;
    const dur = durRef.current;
    if (!dur) return;
    const canvas = mainRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;

    if (ghost) {
      const frac = (clientX - rect.left) / rect.width;
      onSeek(Math.max(0, Math.min(frac * dur, dur)));
      return;
    }

    const VISIBLE = 200;
    const bars = barsRef.current;
    const totalBars = bars.length;
    const centerBarIdx = Math.round((ctRef.current / dur) * totalBars);
    const halfVis = Math.floor(VISIBLE / 2);
    const startBar = Math.max(0, Math.min(centerBarIdx - halfVis, totalBars - VISIBLE));
    const endBar = Math.min(totalBars, startBar + VISIBLE);
    const barCount = endBar - startBar;
    const frac = (clientX - rect.left) / rect.width;
    const clickedBar = startBar + Math.round(frac * barCount);
    onSeek(Math.max(0, Math.min((clickedBar / totalBars) * dur, dur)));
  }, [onSeek, ghost]);

  const handleMainClick = useCallback((e) => {
    performSeekFromEvent(e);
  }, [performSeekFromEvent]);

  const handleMainMouseDown = useCallback((e) => {
    if (!onSeek) return;
    isDraggingRef.current = true;
    setIsDragging(true);
  }, [onSeek]);

  const handleMainMouseMove = useCallback((e) => {
    if (!isDraggingRef.current) return;
    performSeekFromEvent(e);
  }, [performSeekFromEvent]);

  const handleMainMouseUp = useCallback(() => {
    isDraggingRef.current = false;
    setIsDragging(false);
  }, []);

  const handleMainMouseLeave = useCallback(() => {
    isDraggingRef.current = false;
    setIsDragging(false);
  }, []);

  const handleMainTouchStart = useCallback((e) => {
    if (!onSeek) return;
    isDraggingRef.current = true;
    setIsDragging(true);
  }, [onSeek]);

  const handleMainTouchMove = useCallback((e) => {
    if (!isDraggingRef.current) return;
    e.preventDefault();
    performSeekFromEvent(e);
  }, [performSeekFromEvent]);

  const handleMainTouchEnd = useCallback(() => {
    isDraggingRef.current = false;
    setIsDragging(false);
  }, []);

  const handleOverviewClick = useCallback((e) => {
    if (!onSeek) return;
    const dur = durRef.current;
    if (!dur) return;
    const canvas = overviewRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    onSeek(((e.clientX - rect.left) / rect.width) * dur);
  }, [onSeek]);

  const handleMainKeyDown = useCallback((e) => {
    if (!onSeek) return;
    const dur = durRef.current;
    if (!dur) return;
    const step = e.shiftKey ? 30 : 5;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onSeek(Math.max(0, ctRef.current - step));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      onSeek(Math.min(dur, ctRef.current + step));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onSeek(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      onSeek(dur);
    }
  }, [onSeek]);

  return (
    <div className={`lvv-waveform-wrap${ghost ? ' lvv-waveform-ghost-wrap' : ''}`}>
      {!ghost && (
        <canvas
          ref={overviewRef}
          className="lvv-overview-canvas"
          aria-hidden="true"
          onClick={handleOverviewClick}
          style={onSeek ? { cursor: 'pointer' } : undefined}
        />
      )}
      <canvas
        ref={mainRef}
        className={`lvv-waveform-canvas${isDragging ? ' is-dragging' : ''}`}
        role={onSeek ? 'slider' : undefined}
        aria-hidden={onSeek ? undefined : 'true'}
        aria-label={onSeek ? 'Playback position' : undefined}
        aria-valuemin={onSeek ? 0 : undefined}
        aria-valuemax={onSeek ? Math.round(duration) : undefined}
        aria-valuenow={onSeek ? Math.round(currentTime) : undefined}
        tabIndex={onSeek ? 0 : undefined}
        onClick={onSeek ? handleMainClick : undefined}
        onKeyDown={onSeek ? handleMainKeyDown : undefined}
        onMouseDown={onSeek ? handleMainMouseDown : undefined}
        onMouseMove={onSeek ? handleMainMouseMove : undefined}
        onMouseUp={onSeek ? handleMainMouseUp : undefined}
        onMouseLeave={onSeek ? handleMainMouseLeave : undefined}
        onTouchStart={onSeek ? handleMainTouchStart : undefined}
        onTouchMove={onSeek ? handleMainTouchMove : undefined}
        onTouchEnd={onSeek ? handleMainTouchEnd : undefined}
        onTouchCancel={onSeek ? handleMainTouchEnd : undefined}
        style={onSeek ? { cursor: 'pointer', touchAction: 'none' } : undefined}
      />
    </div>
  );
}

// Single track-list row. Memoized so the audioEngine `timeupdate` ticks
// that re-render the parent every fraction of a second (to drive the
// mini-transport clock) don't force every row's ThumbnailCanvas to
// redraw too — only the row(s) whose actual props changed re-render.
const TrackRow = React.memo(function TrackRow({ track, index, isActive, onSelect }) {
  return (
    <button
      className={`lvv-track-row${isActive ? ' lvv-track-row--active' : ''}`}
      onClick={() => onSelect(track)}
      role="listitem"
    >
      <span className="lvv-track-num">{String(index + 1).padStart(2, '0')}</span>
      <span className="lvv-track-info">
        <span className="lvv-track-title">{track.title || 'UNTITLED'}</span>
        {track.duration != null && (
          <span className="lvv-track-dur">{formatDuration(track.duration)}</span>
        )}
      </span>
      <ThumbnailCanvas track={track} />
    </button>
  );
});

// Thumbnail for track list rows (uses low-res 80-bar data)
function ThumbnailCanvas({ track }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = 52, H = 26;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    // Use low-res bars (faster — same 80-bar thumbnail data)
    const bars = parseWaveformBars(track, 13);
    const step = W / bars.length;
    const barW = Math.max(1, step * 0.6);
    bars.forEach((bar, i) => {
      const h = Math.max(1, bar.peak * H);
      const [r, g, bv] = seratoRgb(bar.freq);
      ctx.fillStyle = `rgba(${r},${g},${bv},0.65)`;
      ctx.fillRect(i * step, (H - h) / 2, barW, h);
    });
  }, [track.id, track.waveform_data]);

  return (
    <canvas
      ref={ref}
      className="lvv-thumb"
      width={52}
      height={26}
      aria-hidden="true"
    />
  );
}

// Waveform display for the guest player.
// If a pre-rendered PNG exists in R2, renders it as <img> with a CSS playhead line.
// Falls back to WaveformCanvas if the PNG is unavailable or fails to load.
function WaveformImg({ track, currentTime, duration, ghost, onSeek, mode = 'wave' }) {
  const [useFallback, setUseFallback] = useState(false);
  const pngUrl = R2_PUBLIC_URL && track?.id
    ? `${R2_PUBLIC_URL}/waveform/${track.id}.png`
    : null;

  const playheadPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  if (!pngUrl || useFallback) {
    return (
      <WaveformCanvas
        track={track}
        currentTime={ghost ? 0 : currentTime}
        duration={duration}
        ghost={ghost}
        onSeek={onSeek}
        mode={mode}
      />
    );
  }

  const canSeek = onSeek && duration > 0;
  const handleImgKeyDown = (e) => {
    if (!canSeek) return;
    const step = e.shiftKey ? 30 : 5;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onSeek(Math.max(0, currentTime - step));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      onSeek(Math.min(duration, currentTime + step));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onSeek(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      onSeek(duration);
    }
  };

  return (
    <div
      className={`lvv-waveform-wrap${ghost ? ' lvv-waveform-ghost-wrap' : ''}`}
      style={{ position: 'relative', cursor: onSeek ? 'pointer' : 'default' }}
      onClick={canSeek ? (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onSeek(((e.clientX - rect.left) / rect.width) * duration);
      } : undefined}
      onKeyDown={canSeek ? handleImgKeyDown : undefined}
      role={canSeek ? 'slider' : undefined}
      tabIndex={canSeek ? 0 : undefined}
      aria-label={canSeek ? 'Playback position' : undefined}
      aria-valuemin={canSeek ? 0 : undefined}
      aria-valuemax={canSeek ? Math.round(duration) : undefined}
      aria-valuenow={canSeek ? Math.round(currentTime) : undefined}
    >
      <img
        src={pngUrl}
        alt={`Waveform for ${track?.title || 'track'}`}
        className="lvv-waveform-canvas"
        style={{ display: 'block', width: '100%', height: '100%', objectFit: 'fill' }}
        onError={() => setUseFallback(true)}
        draggable={false}
      />
      {!ghost && duration > 0 && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${playheadPct}%`,
            width: '2px',
            background: 'rgba(240,237,232,0.9)',
            transform: 'translateX(-50%)',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}

function ListenerVaultView({ vault, vaultColor, vaultLabel, onBack, onExitSystem }) {
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [playerState, setPlayerState] = useState(null); // null | 'paused' | 'playing' | 'error'
  const [activeTrack, setActiveTrack] = useState(null);
  const [audioState, setAudioState] = useState(() => audioEngine.getState());
  const [vizMode, setVizMode] = useState('wave'); // 'wave' | 'freq'
  const [isAudioLoading, setIsAudioLoading] = useState(false);

  const prefersReduced = useReducedMotion();
  const screenStyle = vaultColor ? { '--vault-color': vaultColor } : undefined;

  const motionProps = {
    className: 'lvv-body',
    initial: prefersReduced ? { opacity: 0 } : { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0 },
    transition: { duration: prefersReduced ? 0.1 : 0.18, ease: [0.25, 1, 0.5, 1] },
  };

  useEffect(() => {
    setLoading(true);
    fetchPublishedVaultTracks(vault)
      .then(data => setTracks(Array.isArray(data) ? data : []))
      .catch(() => setTracks([]))
      .finally(() => setLoading(false));
  }, [vault]);

  useEffect(() => {
    return audioEngine.onStateChange(state => {
      setAudioState(state);
      if (state.isPlaying) setPlayerState('playing');
    });
  }, []);

  useEffect(() => {
    return () => { audioEngine.stop(); };
  }, []);

  const handleTrackSelect = useCallback(async (track) => {
    const url = getAudioUrl(track.audio_path);
    if (!url) return;
    audioEngine.prewarm();
    setActiveTrack(track);
    setPlayerState('paused');
    setIsAudioLoading(true);
    try {
      await audioEngine.load(url);
      setIsAudioLoading(false);
      audioEngine.play();
    } catch (e) {
      console.warn('[LVV] load failed:', e.message);
      setIsAudioLoading(false);
      setPlayerState('error');
    }
  }, []);

  const handlePlayPause = useCallback(() => {
    if (audioState.isPlaying) {
      audioEngine.pause();
    } else {
      audioEngine.play();
    }
  }, [audioState.isPlaying]);

  const handleStop = useCallback(() => {
    audioEngine.stop();
    setPlayerState(null);
    setActiveTrack(null);
  }, []);

  const handleNext = useCallback(() => {
    if (!activeTrack || tracks.length === 0) return;
    const idx = tracks.findIndex(t => t.id === activeTrack.id);
    if (idx < tracks.length - 1) handleTrackSelect(tracks[idx + 1]);
  }, [activeTrack, tracks, handleTrackSelect]);

  const handlePrev = useCallback(() => {
    if (!activeTrack || tracks.length === 0) return;
    const idx = tracks.findIndex(t => t.id === activeTrack.id);
    if (idx > 0) handleTrackSelect(tracks[idx - 1]);
  }, [activeTrack, tracks, handleTrackSelect]);

  useEffect(() => {
    const onKey = (e) => {
      if (!activeTrack) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); handleNext(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); handlePrev(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTrack, handleNext, handlePrev]);

  const handlePlayerBack = useCallback(() => {
    setPlayerState(null);
    // activeTrack stays set — music continues in background
  }, []);

  const handleMiniTransportTap = useCallback(() => {
    setPlayerState(audioState.isPlaying ? 'playing' : 'paused');
  }, [audioState.isPlaying]);

  const handleRetry = useCallback(() => {
    if (activeTrack) handleTrackSelect(activeTrack);
  }, [activeTrack, handleTrackSelect]);

  const handleGhostSeek = useCallback((time) => {
    audioEngine.seek(time);
    audioEngine.play();
  }, []);

  const isPlaying = audioState.isPlaying;
  const inPlayer = playerState === 'paused' || playerState === 'playing';

  const header = (
    <header className="lvv-header">
      <div className="lvv-header-id">
        <span className="lvv-header-kicker">LISTENING ROOM</span>
        <span className="lvv-header-owner">CURATED BY D</span>
        {vaultLabel && <span className="lvv-header-vault">{vaultLabel}</span>}
      </div>
      <button
        className="lvv-exit god-btn"
        onClick={onExitSystem}
        aria-label="Exit system"
      >
        EXIT
      </button>
    </header>
  );

  return (
    <div className="lvv-screen" style={screenStyle}>
      {header}
      <AnimatePresence mode="wait">

        {/* ERROR — load failed */}
        {playerState === 'error' && (
          <motion.div key="error" {...motionProps}>
            <button className="lvv-back god-btn" onClick={handlePlayerBack} aria-label="Back to track list">
              ← BACK
            </button>
            <div className="lvv-error-stage" role="alert">
              <p className="lvv-error-track">{activeTrack?.title}</p>
              <p className="lvv-error-msg">COULDN'T LOAD</p>
              <button className="lvv-error-retry god-btn" onClick={handleRetry}>
                RETRY
              </button>
            </div>
          </motion.div>
        )}

        {/* PLAYER — paused and playing share this key so within-player transitions are instant */}
        {inPlayer && (
          <motion.div key="player" {...motionProps}>
            <button
              className="lvv-back god-btn"
              onClick={handlePlayerBack}
              aria-label="Back to track list"
            >
              ← BACK
            </button>
            <div className="lvv-player-stage">
              {playerState === 'playing' && (
                <div className="lvv-viz-controls" role="group" aria-label="Visualization mode">
                  <button
                    className={`lvv-viz-btn${vizMode === 'wave' ? ' is-active' : ''}`}
                    onClick={() => setVizMode('wave')}
                    aria-pressed={vizMode === 'wave'}
                    aria-label="Wave visualization mode"
                  >
                    WAVE
                  </button>
                  <button
                    className={`lvv-viz-btn${vizMode === 'freq' ? ' is-active' : ''}`}
                    onClick={() => setVizMode('freq')}
                    aria-pressed={vizMode === 'freq'}
                    aria-label="Frequency visualization mode"
                  >
                    FREQ
                  </button>
                </div>
              )}
              {playerState === 'paused' ? (
                <WaveformImg
                  track={activeTrack}
                  currentTime={0}
                  duration={audioState.duration}
                  ghost
                  onSeek={handleGhostSeek}
                  mode={vizMode}
                />
              ) : (
                <WaveformImg
                  track={activeTrack}
                  currentTime={audioState.currentTime}
                  duration={audioState.duration}
                  onSeek={(t) => audioEngine.seek(t)}
                  mode={vizMode}
                />
              )}
              {playerState === 'paused' && (
                <button
                  className="lvv-play-btn"
                  onClick={isAudioLoading ? undefined : handlePlayPause}
                  aria-label={isAudioLoading ? 'Loading' : 'Play'}
                >
                  <span className="lvv-play-track-title">{activeTrack?.title}</span>
                  {isAudioLoading ? (
                    <div className="lvv-state lvv-play-loading" aria-live="polite">
                      <span className="lvv-state-dot" aria-hidden="true" />
                      <span>LOADING</span>
                    </div>
                  ) : (
                    <svg className="lvv-play-svg" viewBox="0 0 44 52" aria-hidden="true">
                      <polygon points="0,0 44,26 0,52" />
                    </svg>
                  )}
                  {!isAudioLoading && <span className="lvv-play-seek-hint" aria-hidden="true">TAP WAVEFORM TO SEEK</span>}
                </button>
              )}
            </div>
            {playerState === 'playing' && (
              <div className="lvv-transport">
                <button
                  className="lvv-transport-toggle"
                  onClick={handlePlayPause}
                  aria-label={isPlaying ? 'Pause' : 'Resume'}
                >
                  <span className={`lvv-transport-status${isPlaying ? '' : ' is-paused'}`}>
                    {isPlaying ? '▶ PLAYING' : '▮▮ PAUSED'}
                  </span>
                  <span className="lvv-transport-dot" aria-hidden="true">·</span>
                  <span className="lvv-transport-title">{activeTrack?.title}</span>
                  {audioState.duration > 0 && (
                    <span className="lvv-transport-time" aria-hidden="true">
                      {formatDuration(audioState.currentTime)} · −{formatDuration(audioState.duration - audioState.currentTime)}
                    </span>
                  )}
                </button>
                <div className="lvv-transport-nav" aria-label="Track navigation">
                  <button
                    className="lvv-transport-nav-btn god-btn"
                    onClick={handlePrev}
                    aria-label="Previous track"
                    disabled={tracks.findIndex(t => t.id === activeTrack?.id) <= 0}
                  >
                    ← PREV
                  </button>
                  <button
                    className="lvv-transport-nav-btn god-btn"
                    onClick={handleNext}
                    aria-label="Next track"
                    disabled={tracks.findIndex(t => t.id === activeTrack?.id) >= tracks.length - 1}
                  >
                    NEXT →
                  </button>
                </div>
                <button
                  className="lvv-transport-stop"
                  onClick={handleStop}
                  aria-label="Stop playback"
                >
                  STOP
                </button>
              </div>
            )}
          </motion.div>
        )}

        {/* TRACK LIST */}
        {!playerState && (
          <motion.div key="list" {...motionProps}>
            <button
              className="lvv-back god-btn"
              onClick={onBack}
              aria-label="Back to vault landing"
            >
              ← BACK
            </button>
            <div className="lvv-list" role="list">
              {loading && (
                <div className="lvv-state">
                  <span className="lvv-state-dot" aria-hidden="true" />
                  <span>LOADING</span>
                </div>
              )}
              {!loading && tracks.length === 0 && (
                <div className="lvv-state lvv-state--empty">
                  <span>NOTHING HERE YET</span>
                  <span className="lvv-empty-sub">D HASN'T PUBLISHED TO THIS VAULT</span>
                </div>
              )}
              {!loading && tracks.map((track, i) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  index={i}
                  isActive={activeTrack?.id === track.id}
                  onSelect={handleTrackSelect}
                />
              ))}
            </div>
            {activeTrack && (
              <div className="lvv-mini-transport">
                <button
                  className="lvv-mini-transport-toggle"
                  onClick={handleMiniTransportTap}
                  aria-label="Return to player"
                >
                  <span className={`lvv-transport-status${isPlaying ? '' : ' is-paused'}`}>
                    {isPlaying ? '▶ PLAYING' : '▮▮ PAUSED'}
                  </span>
                  <span className="lvv-transport-dot" aria-hidden="true">·</span>
                  <span className="lvv-transport-title">{activeTrack.title}</span>
                  {audioState.duration > 0 && (
                    <span className="lvv-transport-time" aria-hidden="true">
                      {formatDuration(audioState.currentTime)} · −{formatDuration(audioState.duration - audioState.currentTime)}
                    </span>
                  )}
                </button>
                <button
                  className="lvv-transport-stop"
                  onClick={handleStop}
                  aria-label="Stop playback"
                >
                  STOP
                </button>
              </div>
            )}
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}

export default ListenerVaultView;
export { WaveformCanvas };
