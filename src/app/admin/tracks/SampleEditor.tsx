"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { FREE_SAMPLE_SECONDS } from "@/lib/membership";

const CANVAS_HEIGHT = 160;
const BAR_WIDTH = 2;
const BAR_GAP = 1;

interface SampleEditorProps {
  audioUrl: string;
  initialStart?: number;
  onSave: (start: number, end: number) => void;
  onCancel: () => void;
  saving?: boolean;
}

// A fixed FREE_SAMPLE_SECONDS-long window the admin drags along the waveform.
// The start handle moves; the end is always start + window (clamped to the
// track). If the track is shorter than the window, the window is the whole
// track.
//
// Playback: an HTMLAudioElement is bound to the full track. Whenever the
// window moves (drag / slider) we seek the element to `start` and clamp
// playback so it never crosses `end`. This gives us a native player UI
// (play/pause + progress + time) that always previews exactly the selected
// 30-second sample.
export default function SampleEditor({
  audioUrl,
  initialStart = 0,
  onSave,
  onCancel,
  saving = false,
}: SampleEditorProps) {
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [start, setStart] = useState(initialStart);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(initialStart);
  const [dragging, setDragging] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number>(0);

  const duration = audioBuffer?.duration ?? 0;
  const windowLen = Math.min(FREE_SAMPLE_SECONDS, duration || FREE_SAMPLE_SECONDS);
  const maxStart = Math.max(0, duration - windowLen);
  const clampedStart = Math.min(Math.max(0, start), maxStart);
  const end = clampedStart + windowLen;

  // Decode audio into an AudioBuffer for the waveform rendering only. Playback
  // uses a plain <audio> element (see audioElRef) so we get native controls.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const ctx = new (window.AudioContext ||
          (window as any).webkitAudioContext)();
        audioContextRef.current = ctx;
        const res = await fetch(audioUrl);
        const arr = await res.arrayBuffer();
        const buffer = await ctx.decodeAudioData(arr);
        if (cancelled) return;
        setAudioBuffer(buffer);
        setStart(Math.min(initialStart, Math.max(0, buffer.duration - windowLen)));
        setCurrentTime(Math.min(initialStart, Math.max(0, buffer.duration - windowLen)));
      } catch (err) {
        console.error("Failed to load audio:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      audioContextRef.current?.close().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !audioBuffer) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const data = audioBuffer.getChannelData(0);
    const bars = Math.floor(width / (BAR_WIDTH + BAR_GAP));
    const step = Math.ceil(data.length / bars);

    ctx.clearRect(0, 0, width, height);

    for (let i = 0; i < bars; i++) {
      const s = i * step;
      let sum = 0;
      for (let j = 0; j < step; j++) sum += Math.abs(data[s + j] || 0);
      const avg = sum / step;
      const barHeight = Math.max(2, avg * height * 0.9);
      const x = i * (BAR_WIDTH + BAR_GAP);
      const y = (height - barHeight) / 2;
      const barTime = (i / bars) * audioBuffer.duration;
      const inWindow = barTime >= clampedStart && barTime <= end;
      ctx.fillStyle = inWindow ? "#c9a96e" : "rgba(255,255,255,0.15)";
      ctx.fillRect(x, y, BAR_WIDTH, barHeight);
    }

    const startX = (clampedStart / audioBuffer.duration) * width;
    const endX = (end / audioBuffer.duration) * width;

    ctx.fillStyle = "rgba(201,169,110,0.12)";
    ctx.fillRect(startX, 0, endX - startX, height);

    ctx.fillStyle = "#fff";
    ctx.fillRect(startX - 2, 0, 4, height);
    ctx.fillRect(endX - 2, 0, 4, height);

    // Playhead — always draw it (not only while playing) so the admin can see
    // where the next play will start.
    const playX = (currentTime / audioBuffer.duration) * width;
    ctx.strokeStyle = isPlaying ? "#fff" : "rgba(255,255,255,0.4)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playX, 0);
    ctx.lineTo(playX, height);
    ctx.stroke();
  }, [audioBuffer, clampedStart, end, isPlaying, currentTime]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Whenever the window moves, snap playback to the new start.
  useEffect(() => {
    const el = audioElRef.current;
    if (!el || loading) return;
    // Only reset if we're outside the window (dragging while playing).
    if (el.currentTime < clampedStart || el.currentTime > end) {
      el.currentTime = clampedStart;
      setCurrentTime(clampedStart);
    }
  }, [clampedStart, end, loading]);

  const startFromClientX = (clientX: number) => {
    if (!audioBuffer || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const time = (x / rect.width) * audioBuffer.duration;
    // Center the window on the click, clamped into range.
    setStart(Math.min(Math.max(0, time - windowLen / 2), maxStart));
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setDragging(true);
    startFromClientX(e.clientX);
  };
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragging) return;
    startFromClientX(e.clientX);
  };
  const handleMouseUp = () => setDragging(false);

  // Touch support so the waveform works on tablet/phone previews.
  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    setDragging(true);
    startFromClientX(e.touches[0].clientX);
  };
  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!dragging) return;
    startFromClientX(e.touches[0].clientX);
  };
  const handleTouchEnd = () => setDragging(false);

  const togglePlay = async () => {
    const el = audioElRef.current;
    if (!el) return;
    if (el.paused) {
      // Always start from window start (or wherever the playhead is if inside).
      if (el.currentTime < clampedStart || el.currentTime >= end) {
        el.currentTime = clampedStart;
      }
      try {
        await el.play();
      } catch (err) {
        console.warn("Playback failed:", err);
      }
    } else {
      el.pause();
    }
  };

  const onTimeUpdate = () => {
    const el = audioElRef.current;
    if (!el) return;
    // Clamp to the window: pause + snap back when we hit the end.
    if (el.currentTime >= end) {
      el.pause();
      el.currentTime = clampedStart;
      setCurrentTime(clampedStart);
      return;
    }
    if (el.currentTime < clampedStart) {
      el.currentTime = clampedStart;
    }
    setCurrentTime(el.currentTime);
  };

  const seekWithinWindow = (frac: number) => {
    const el = audioElRef.current;
    if (!el) return;
    const t = clampedStart + Math.max(0, Math.min(1, frac)) * windowLen;
    el.currentTime = t;
    setCurrentTime(t);
  };

  const fmt = (s: number) => {
    if (!Number.isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  if (loading) {
    return (
      <div className="text-center py-16">
        <div className="w-10 h-10 border-3 border-[#c9a96e]/20 border-t-[#c9a96e] rounded-full animate-spin mx-auto mb-4" />
        <p className="text-[#888]">Loading audio waveform…</p>
      </div>
    );
  }

  if (!audioBuffer) {
    return (
      <div className="text-center py-10">
        <p className="text-red-400 mb-4">Could not decode this audio file.</p>
        <button
          onClick={onCancel}
          className="px-5 py-2 bg-white/5 border border-white/10 rounded-xl"
        >
          Back
        </button>
      </div>
    );
  }

  // Position of the playhead inside the window (0..1). Used by the mini
  // sample-window scrubber so admins can seek within the 30s preview.
  const windowFrac =
    windowLen > 0
      ? Math.min(1, Math.max(0, (currentTime - clampedStart) / windowLen))
      : 0;

  return (
    <div className="space-y-5">
      {/* Hidden <audio> element that drives the player. We use native audio
          because we need reliable play/pause across browsers and a simple
          way to bind timeupdate. */}
      <audio
        ref={audioElRef}
        src={audioUrl}
        preload="auto"
        onTimeUpdate={onTimeUpdate}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onLoadedMetadata={(e) => {
          // Ensure we start at the current window start after metadata loads.
          (e.currentTarget as HTMLAudioElement).currentTime = clampedStart;
        }}
      />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-sm text-[#c9a96e]">
          Sample: {fmt(clampedStart)} — {fmt(end)} ({windowLen.toFixed(0)}s)
        </span>
        <span className="text-xs text-[#888]">
          Track length: {fmt(duration)}
        </span>
      </div>

      <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6 space-y-4">
        <div className="flex justify-between text-sm text-[#888]">
          <span>0:00</span>
          <span>{fmt(duration)}</span>
        </div>
        <canvas
          ref={canvasRef}
          width={1200}
          height={CANVAS_HEIGHT}
          className="w-full h-40 cursor-pointer rounded-lg select-none touch-none"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        />
        <p className="text-xs text-[#666]">
          Click or drag on the waveform to move the fixed {windowLen.toFixed(0)}
          -second window.
        </p>
        <div>
          <label className="text-sm text-[#888] block mb-1">Start time</label>
          <input
            type="range"
            min={0}
            max={maxStart}
            step={0.1}
            value={clampedStart}
            onChange={(e) => setStart(parseFloat(e.target.value))}
            className="w-full accent-[#c9a96e]"
          />
        </div>

        {/* Sample-window player. Big play/pause + time counter + scrubber that
            operates ONLY inside the selected 30s window. */}
        <div className="mt-2 flex items-center gap-4 bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
          <button
            type="button"
            onClick={togglePlay}
            aria-label={isPlaying ? "Pause preview" : "Play preview"}
            className="shrink-0 h-12 w-12 rounded-full bg-gradient-to-r from-[#c9a96e] to-[#a08050] text-[#0a0a0a] flex items-center justify-center font-bold hover:opacity-90 transition"
          >
            {isPlaying ? (
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          <span className="w-12 shrink-0 text-right text-xs tabular-nums text-[#c9a96e]">
            {fmt(Math.max(0, currentTime - clampedStart))}
          </span>

          <button
            type="button"
            aria-label="Seek within sample"
            className="group relative h-3 flex-1 cursor-pointer"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              seekWithinWindow((e.clientX - rect.left) / rect.width);
            }}
          >
            <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/10" />
            <span
              className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[#c9a96e]"
              style={{ width: `${windowFrac * 100}%` }}
            />
            <span
              className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#c9a96e] opacity-0 transition-opacity group-hover:opacity-100"
              style={{ left: `${windowFrac * 100}%` }}
            />
          </button>

          <span className="w-12 shrink-0 text-xs tabular-nums text-[#888]">
            {fmt(windowLen)}
          </span>
        </div>
      </div>

      <div className="flex gap-3 justify-end">
        <button
          onClick={onCancel}
          disabled={saving}
          className="px-5 py-2.5 bg-white/5 border border-white/10 rounded-xl font-semibold disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={() => onSave(clampedStart, end)}
          disabled={saving}
          className="px-6 py-2.5 bg-gradient-to-r from-[#c9a96e] to-[#a08050] text-[#0a0a0a] font-bold rounded-xl disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save sample window"}
        </button>
      </div>
    </div>
  );
}
