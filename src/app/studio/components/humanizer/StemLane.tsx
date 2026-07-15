"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatTime,
  PRESETS,
  type LocalStem,
  type PresetId,
} from "./humanizerClient";

interface StemLaneProps {
  stem: LocalStem;
  index: number;
  onRemove: (id: string) => void;
  onPresetOverride: (id: string, preset: PresetId | null) => void;
}

const CANVAS_HEIGHT = 72;
const BAR_WIDTH = 2;
const BAR_GAP = 1;

function drawWaveformToCanvas(
  canvas: HTMLCanvasElement,
  buffer: AudioBuffer,
  color: string,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const width = canvas.width;
  const height = canvas.height;
  const data = buffer.getChannelData(0);
  const bars = Math.floor(width / (BAR_WIDTH + BAR_GAP));
  const step = Math.max(1, Math.floor(data.length / bars));

  ctx.clearRect(0, 0, width, height);
  for (let i = 0; i < bars; i++) {
    const start = i * step;
    let sum = 0;
    for (let j = 0; j < step; j++) {
      sum += Math.abs(data[start + j] || 0);
    }
    const avg = sum / step;
    const barHeight = Math.max(1, avg * height * 1.8);
    const x = i * (BAR_WIDTH + BAR_GAP);
    const y = (height - barHeight) / 2;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, BAR_WIDTH, barHeight);
  }
}

const STATUS_LABEL: Record<LocalStem["status"], string> = {
  pending: "Pending",
  processing: "Processing…",
  done: "Done",
  failed: "Failed",
};

const STATUS_CLASS: Record<LocalStem["status"], string> = {
  pending: "bg-white/10 text-[#aaa]",
  processing: "bg-[#c9a96e]/20 text-[#c9a96e] animate-pulse",
  done: "bg-green-500/15 text-green-400",
  failed: "bg-red-500/15 text-red-400",
};

// One multitrack lane: colored left stripe (Suno-Studio style), uppercase
// label, waveform, status badge, per-stem preset override, and an A/B toggle
// that swaps playback between the original upload and the humanized result
// once it's available.
export default function StemLane({ stem, index, onRemove, onPresetOverride }: StemLaneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [abMode, setAbMode] = useState<"original" | "humanized">("original");
  const [menuOpen, setMenuOpen] = useState(false);

  const activeBuffer =
    abMode === "humanized" && stem.humanizedAudioBuffer
      ? stem.humanizedAudioBuffer
      : stem.audioBuffer;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !activeBuffer) return;
    drawWaveformToCanvas(canvas, activeBuffer, stem.color);
  }, [activeBuffer, stem.color]);

  const stopPlayback = useCallback(() => {
    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch {
        /* already stopped */
      }
      sourceRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  const play = useCallback(() => {
    if (!activeBuffer) return;
    stopPlayback();
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    const ctx = audioContextRef.current;
    const source = ctx.createBufferSource();
    source.buffer = activeBuffer;
    source.connect(ctx.destination);
    source.onended = () => setIsPlaying(false);
    source.start(0);
    sourceRef.current = source;
    setIsPlaying(true);
  }, [activeBuffer, stopPlayback]);

  useEffect(() => stopPlayback, [stopPlayback]);

  const duration = activeBuffer?.duration ?? 0;
  const canAb = !!stem.humanizedAudioBuffer;

  return (
    <div
      className="relative flex rounded-xl overflow-hidden border border-white/[0.08] bg-white/[0.02]"
      style={{ borderLeftWidth: 4, borderLeftColor: stem.color }}
    >
      {/* Left control strip */}
      <div className="w-44 sm:w-52 shrink-0 p-3 flex flex-col gap-2 border-r border-white/[0.06] bg-black/20">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={isPlaying ? stopPlayback : play}
            disabled={!activeBuffer}
            className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-xs shrink-0 disabled:opacity-40"
            aria-label={isPlaying ? "Stop" : "Play"}
          >
            {isPlaying ? "⏹" : "▶"}
          </button>
          <span className="text-[11px] font-bold uppercase tracking-wide truncate flex-1" title={stem.name}>
            {stem.name}
          </span>
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="w-6 h-6 rounded hover:bg-white/10 flex items-center justify-center text-[#888]"
              aria-label="Stem options"
            >
              ⋮
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-7 z-10 w-32 rounded-lg border border-white/10 bg-[#141414] shadow-xl py-1">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onRemove(stem.id);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-white/5"
                >
                  Remove stem
                </button>
              </div>
            )}
          </div>
        </div>

        <span className={`self-start rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_CLASS[stem.status]}`}>
          {STATUS_LABEL[stem.status]}
          {stem.status === "pending" && stem.uploadProgress > 0 && stem.uploadProgress < 100
            ? ` ${stem.uploadProgress}%`
            : ""}
        </span>

        <select
          value={stem.presetOverride ?? ""}
          onChange={(e) =>
            onPresetOverride(stem.id, (e.target.value || null) as PresetId | null)
          }
          className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-[11px] focus:outline-none focus:border-[#c9a96e]"
          title="Per-stem preset override (blank = use global preset)"
        >
          <option value="">Global preset</option>
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>

        {canAb && (
          <div className="flex rounded-lg border border-white/10 overflow-hidden text-[10px] font-semibold">
            <button
              type="button"
              onClick={() => setAbMode("original")}
              className={`flex-1 py-1 ${abMode === "original" ? "bg-[#c9a96e] text-black" : "bg-transparent text-[#888]"}`}
            >
              Original
            </button>
            <button
              type="button"
              onClick={() => setAbMode("humanized")}
              className={`flex-1 py-1 ${abMode === "humanized" ? "bg-[#c9a96e] text-black" : "bg-transparent text-[#888]"}`}
            >
              Humanized
            </button>
          </div>
        )}

        {stem.detection != null && (
          <p className="text-[10px] text-[#888]">
            Detection score: <span className="text-[#c9a96e] font-semibold">{Math.round(stem.detection * 100)}%</span>
          </p>
        )}
        {stem.error && (
          <p className="text-[10px] text-red-400 truncate" title={stem.error}>
            {stem.error}
          </p>
        )}
      </div>

      {/* Waveform area */}
      <div className="flex-1 min-w-0 relative flex flex-col">
        <div
          className="absolute left-2 top-1.5 z-10 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-black/50"
          style={{ color: stem.color }}
        >
          {stem.name}
        </div>
        <canvas
          ref={canvasRef}
          width={1400}
          height={CANVAS_HEIGHT}
          className="w-full block"
          style={{ height: CANVAS_HEIGHT, background: "rgba(0,0,0,0.35)" }}
        />
        <div className="px-2 pb-1 text-[10px] text-[#666] flex justify-between">
          <span>#{index + 1}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}
