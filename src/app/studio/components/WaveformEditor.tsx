"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { authFetch } from "@/lib/authClient";

interface WaveformEditorProps {
  trackId: string | null;
  onBack: () => void;
}

interface TrackData {
  id: string;
  title: string;
  artist: string;
  audioUrl: string;
  previewUrl?: string;
  previewStart?: number;
  previewEnd?: number;
  duration: number;
}

const PREVIEW_DURATION = 30; // seconds
const CANVAS_HEIGHT = 160;
const BAR_WIDTH = 2;
const BAR_GAP = 1;

export default function WaveformEditor({ trackId, onBack }: WaveformEditorProps) {
  const [track, setTrack] = useState<TrackData | null>(null);
  const [loading, setLoading] = useState(true);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [previewStart, setPreviewStart] = useState(0);
  const [previewEnd, setPreviewEnd] = useState(30);
  const [isDragging, setIsDragging] = useState<"start" | "end" | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const animationRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch track data
  useEffect(() => {
    if (!trackId) {
      setLoading(false);
      return;
    }

    authFetch(`/api/studio/track/${trackId}`)
      .then((r) => r.json())
      .then((data) => {
        setTrack(data);
        setPreviewStart(data.previewStart ?? 0);
        setPreviewEnd(data.previewEnd ?? Math.min(30, data.duration));
        loadAudio(data.audioUrl);
      })
      .catch(() => setLoading(false));
  }, [trackId]);

  // Load audio into Web Audio API
  const loadAudio = async (url: string) => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = ctx;

      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = await ctx.decodeAudioData(arrayBuffer);

      setAudioBuffer(buffer);
      setLoading(false);
    } catch (err) {
      console.error("Failed to load audio:", err);
      setLoading(false);
    }
  };

  // Draw waveform on canvas
  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !audioBuffer) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const data = audioBuffer.getChannelData(0);
    const step = Math.ceil(data.length / width);
    const bars = Math.floor(width / (BAR_WIDTH + BAR_GAP));

    ctx.clearRect(0, 0, width, height);

    // Draw background bars
    for (let i = 0; i < bars; i++) {
      const start = i * step;
      let sum = 0;
      for (let j = 0; j < step; j++) {
        sum += Math.abs(data[start + j] || 0);
      }
      const avg = sum / step;
      const barHeight = avg * height * 0.9;
      const x = i * (BAR_WIDTH + BAR_GAP);
      const y = (height - barHeight) / 2;

      // Determine if this bar is inside the preview selection
      const barTime = (i / bars) * audioBuffer.duration;
      const isInPreview = barTime >= previewStart && barTime <= previewEnd;

      ctx.fillStyle = isInPreview ? "#c9a96e" : "rgba(255,255,255,0.15)";
      ctx.fillRect(x, y, BAR_WIDTH, barHeight);
    }

    // Draw preview region overlay
    const startX = (previewStart / audioBuffer.duration) * width;
    const endX = (previewEnd / audioBuffer.duration) * width;

    // Start handle
    ctx.fillStyle = "#fff";
    ctx.fillRect(startX - 2, 0, 4, height);
    ctx.beginPath();
    ctx.moveTo(startX - 6, 0);
    ctx.lineTo(startX + 6, 0);
    ctx.lineTo(startX, 10);
    ctx.fill();

    // End handle
    ctx.fillRect(endX - 2, 0, 4, height);
    ctx.beginPath();
    ctx.moveTo(endX - 6, height);
    ctx.lineTo(endX + 6, height);
    ctx.lineTo(endX, height - 10);
    ctx.fill();

    // Playhead
    if (isPlaying) {
      const playX = (currentTime / audioBuffer.duration) * width;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playX, 0);
      ctx.lineTo(playX, height);
      ctx.stroke();
    }
  }, [audioBuffer, previewStart, previewEnd, isPlaying, currentTime]);

  useEffect(() => {
    drawWaveform();
  }, [drawWaveform]);

  // Handle canvas interactions
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!audioBuffer || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const time = (x / rect.width) * audioBuffer.duration;

    const startX = (previewStart / audioBuffer.duration) * rect.width;
    const endX = (previewEnd / audioBuffer.duration) * rect.width;

    // Check if clicking near handles
    if (Math.abs(x - startX) < 15) {
      setIsDragging("start");
    } else if (Math.abs(x - endX) < 15) {
      setIsDragging("end");
    } else {
      // Click to set play position
      setCurrentTime(time);
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging || !audioBuffer || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const time = Math.max(0, Math.min(audioBuffer.duration, (x / rect.width) * audioBuffer.duration));

    if (isDragging === "start") {
      setPreviewStart(Math.min(time, previewEnd - 5));
    } else {
      setPreviewEnd(Math.max(time, previewStart + 5));
    }
  };

  const handleCanvasMouseUp = () => {
    setIsDragging(null);
  };

  // Playback
  const playPreview = () => {
    if (!audioBuffer || !audioContextRef.current) return;

    // Stop existing playback
    if (sourceRef.current) {
      sourceRef.current.stop();
      sourceRef.current = null;
    }

    const ctx = audioContextRef.current;
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    source.start(0, previewStart, previewEnd - previewStart);
    sourceRef.current = source;
    setIsPlaying(true);

    const startTime = ctx.currentTime;
    const updatePlayhead = () => {
      const elapsed = ctx.currentTime - startTime;
      const trackTime = previewStart + elapsed;
      setCurrentTime(trackTime);

      if (trackTime < previewEnd) {
        animationRef.current = requestAnimationFrame(updatePlayhead);
      } else {
        setIsPlaying(false);
        setCurrentTime(previewEnd);
      }
    };
    animationRef.current = requestAnimationFrame(updatePlayhead);

    source.onended = () => {
      setIsPlaying(false);
      cancelAnimationFrame(animationRef.current);
    };
  };

  const stopPlayback = () => {
    if (sourceRef.current) {
      sourceRef.current.stop();
      sourceRef.current = null;
    }
    cancelAnimationFrame(animationRef.current);
    setIsPlaying(false);
  };

  // Generate 30-second preview using FFmpeg.wasm
  const generatePreview = async () => {
    if (!track || !audioBuffer) return;
    setGenerating(true);
    setSaveMessage(null);

    try {
      // For now, use server-side API (FFmpeg.wasm is heavy for client)
      // In production, you'd load FFmpeg.wasm client-side
      const response = await authFetch("/api/studio/generate-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackId: track.id,
          start: previewStart,
          end: previewEnd,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? "Preview save failed.");
      }

      if (data.previewUrl) {
        setGeneratedUrl(data.previewUrl);
      }

      // Persist the preview window even when the rendered clip isn't ready
      // yet (background worker). Without this, the [start, end] the artist
      // scrubbed was thrown away after the loading spinner disappeared.
      const patchRes = await authFetch(`/api/studio/track/${track.id}/preview`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          previewUrl: data.previewUrl ?? null,
          previewStart,
          previewEnd,
        }),
      });
      if (!patchRes.ok) {
        const patchBody = await patchRes.json().catch(() => ({}));
        throw new Error(patchBody?.error ?? "Could not save preview.");
      }

      setSaveMessage({
        kind: "success",
        text: data.previewUrl
          ? "Preview saved."
          : `Preview window saved (${Math.round(previewEnd - previewStart)}s). Clip renders in the background.`,
      });
    } catch (err) {
      console.error("Preview generation failed:", err);
      setSaveMessage({
        kind: "error",
        text: err instanceof Error ? err.message : "Preview save failed.",
      });
    } finally {
      setGenerating(false);
    }
  };

  // Format time
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  if (!trackId) {
    return (
      <div className="text-center py-20">
        <p className="text-[#888] text-lg">Select a track from "My Tracks" to edit its preview.</p>
        <button
          onClick={onBack}
          className="mt-4 px-6 py-3 bg-gradient-to-r from-[#c9a96e] to-[#a08050] text-[#0a0a0a] font-bold rounded-xl"
        >
          Go to My Tracks
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="text-center py-20">
        <div className="w-10 h-10 border-3 border-[#c9a96e]/20 border-t-[#c9a96e] rounded-full animate-spin mx-auto mb-4" />
        <p className="text-[#888]">Loading audio waveform...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <button onClick={onBack} className="text-sm text-[#888] hover:text-[#c9a96e] mb-2">
            ← Back to tracks
          </button>
          <h2 className="text-2xl font-bold">{track?.title}</h2>
          <p className="text-[#888]">{track?.artist}</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={isPlaying ? stopPlayback : playPreview}
            className="px-6 py-3 bg-white/5 border border-white/10 rounded-xl font-semibold hover:border-[#c9a96e]/40 transition-all flex items-center gap-2"
          >
            {isPlaying ? "⏹ Stop" : "▶ Play Preview"}
          </button>
          <button
            onClick={generatePreview}
            disabled={generating}
            className="px-6 py-3 bg-gradient-to-r from-[#c9a96e] to-[#a08050] text-[#0a0a0a] font-bold rounded-xl hover:-translate-y-0.5 transition-all disabled:opacity-50"
          >
            {generating ? "Generating..." : "✂️ Generate 30-sec Preview"}
          </button>
        </div>
      </div>

      {saveMessage && (
        <div
          className={`rounded-xl px-4 py-3 text-sm ${
            saveMessage.kind === "success"
              ? "bg-green-500/10 border border-green-500/30 text-green-400"
              : "bg-red-500/10 border border-red-500/30 text-red-400"
          }`}
        >
          {saveMessage.text}
        </div>
      )}

      {/* Waveform Canvas */}
      <div
        ref={containerRef}
        className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6"
      >
        <div className="flex justify-between text-sm text-[#888] mb-2">
          <span>{formatTime(0)}</span>
          <span>{formatTime(audioBuffer?.duration || 0)}</span>
        </div>
        <canvas
          ref={canvasRef}
          width={1200}
          height={CANVAS_HEIGHT}
          className="w-full h-40 cursor-crosshair rounded-lg"
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
        />
        <div className="flex justify-between text-xs text-[#666] mt-2">
          <span>Drag the white handles to set your 30-second preview</span>
          <span>Selected: {formatTime(previewStart)} — {formatTime(previewEnd)} ({(previewEnd - previewStart).toFixed(1)}s)</span>
        </div>
      </div>

      {/* Preview Settings */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
          <h3 className="font-semibold mb-4">Preview Settings</h3>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-[#888] block mb-1">Start Time</label>
              <input
                type="range"
                min={0}
                max={(audioBuffer?.duration || 30) - 5}
                step={0.1}
                value={previewStart}
                onChange={(e) => setPreviewStart(Math.min(parseFloat(e.target.value), previewEnd - 5))}
                className="w-full accent-[#c9a96e]"
              />
              <span className="text-sm text-[#c9a96e]">{formatTime(previewStart)}</span>
            </div>
            <div>
              <label className="text-sm text-[#888] block mb-1">End Time</label>
              <input
                type="range"
                min={5}
                max={audioBuffer?.duration || 30}
                step={0.1}
                value={previewEnd}
                onChange={(e) => setPreviewEnd(Math.max(parseFloat(e.target.value), previewStart + 5))}
                className="w-full accent-[#c9a96e]"
              />
              <span className="text-sm text-[#c9a96e]">{formatTime(previewEnd)}</span>
            </div>
          </div>
        </div>

        <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
          <h3 className="font-semibold mb-4">Generated Preview</h3>
          {generatedUrl || track?.previewUrl ? (
            <div className="space-y-3">
              <audio
                controls
                src={generatedUrl || track?.previewUrl}
                className="w-full"
              />
              <p className="text-sm text-green-400">✓ Preview saved and active on catalog</p>
            </div>
          ) : (
            <p className="text-[#888] text-sm">No preview generated yet. Click "Generate 30-sec Preview" to create one.</p>
          )}
        </div>
      </div>
    </div>
  );
}
