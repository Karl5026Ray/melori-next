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
// track). If the track is shorter than the window, the window is the whole track.
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
  const [currentTime, setCurrentTime] = useState(0);
  const [dragging, setDragging] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const animationRef = useRef<number>(0);

  const duration = audioBuffer?.duration ?? 0;
  const windowLen = Math.min(FREE_SAMPLE_SECONDS, duration || FREE_SAMPLE_SECONDS);
  const maxStart = Math.max(0, duration - windowLen);
  const clampedStart = Math.min(Math.max(0, start), maxStart);
  const end = clampedStart + windowLen;

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
      } catch (err) {
        console.error("Failed to load audio:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (sourceRef.current) {
        try {
          sourceRef.current.stop();
        } catch {
          /* already stopped */
        }
      }
      cancelAnimationFrame(animationRef.current);
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

    if (isPlaying) {
      const playX = (currentTime / audioBuffer.duration) * width;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playX, 0);
      ctx.lineTo(playX, height);
      ctx.stroke();
    }
  }, [audioBuffer, clampedStart, end, isPlaying, currentTime]);

  useEffect(() => {
    draw();
  }, [draw]);

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

  const play = () => {
    if (!audioBuffer || !audioContextRef.current) return;
    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch {
        /* noop */
      }
    }
    const ctx = audioContextRef.current;
    void ctx.resume();
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    source.start(0, clampedStart, windowLen);
    sourceRef.current = source;
    setIsPlaying(true);

    const startedAt = ctx.currentTime;
    const tick = () => {
      const elapsed = ctx.currentTime - startedAt;
      const t = clampedStart + elapsed;
      setCurrentTime(t);
      if (elapsed < windowLen) {
        animationRef.current = requestAnimationFrame(tick);
      } else {
        setIsPlaying(false);
      }
    };
    animationRef.current = requestAnimationFrame(tick);
    source.onended = () => {
      setIsPlaying(false);
      cancelAnimationFrame(animationRef.current);
    };
  };

  const stop = () => {
    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch {
        /* noop */
      }
      sourceRef.current = null;
    }
    cancelAnimationFrame(animationRef.current);
    setIsPlaying(false);
  };

  const fmt = (s: number) => {
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

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-3">
          <button
            onClick={isPlaying ? stop : play}
            className="px-5 py-2.5 bg-white/5 border border-white/10 rounded-xl font-semibold hover:border-[#c9a96e]/40 transition-all"
          >
            {isPlaying ? "⏹ Stop" : "▶ Preview window"}
          </button>
        </div>
        <span className="text-sm text-[#c9a96e]">
          Sample: {fmt(clampedStart)} — {fmt(end)} ({windowLen.toFixed(0)}s)
        </span>
      </div>

      <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
        <div className="flex justify-between text-sm text-[#888] mb-2">
          <span>0:00</span>
          <span>{fmt(duration)}</span>
        </div>
        <canvas
          ref={canvasRef}
          width={1200}
          height={CANVAS_HEIGHT}
          className="w-full h-40 cursor-pointer rounded-lg select-none"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
        <p className="text-xs text-[#666] mt-2">
          Click or drag on the waveform to move the fixed {windowLen.toFixed(0)}-second window.
        </p>
        <div className="mt-4">
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
