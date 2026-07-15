"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalStem } from "./humanizerClient";

interface FinalDraftProps {
  // The blended master (final product).
  masterPath: string | null;
  masterDownloadUrl: string | null;
  masterAudioBuffer: AudioBuffer | null;
  onDownloadMaster: () => void;
  // The edited (humanized) stems.
  stems: LocalStem[];
  onDownloadStem: (path: string, filename: string) => void;
  onDownloadAll: () => void;
}

// -----------------------------------------------------------------------------
// Final Draft
// -----------------------------------------------------------------------------
// The dedicated "done" space that appears once humanizing finishes: the final
// blended MASTER up top (inline player + download), then every edited stem
// below with an A/B (Original vs Humanized) toggle + its own download, plus a
// "Download all" action. This is where the finished product lives — previously
// the master hid in the right inspector and stem downloads were tiny per-lane
// links.
export default function FinalDraft({
  masterPath,
  masterDownloadUrl,
  masterAudioBuffer,
  onDownloadMaster,
  stems,
  onDownloadStem,
  onDownloadAll,
}: FinalDraftProps) {
  const doneStems = stems.filter((s) => s.status === "done" && s.outPath);

  return (
    <div className="rounded-2xl border border-green-500/25 bg-green-500/[0.04] p-5 space-y-5">
      <div className="flex items-center gap-2">
        <span className="text-green-400 text-lg">✓</span>
        <h3 className="text-lg font-bold text-white">Final Draft</h3>
        <span className="text-xs text-[#888]">Your humanized master and stems are ready</span>
      </div>

      {/* Final product — the blended master */}
      {masterPath && (
        <div className="rounded-xl border border-[#c9a96e]/30 bg-[#c9a96e]/[0.06] p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-[#c9a96e]">Final Master</p>
              <p className="text-xs text-[#888]">All humanized stems blended into one track</p>
            </div>
            <button
              type="button"
              onClick={onDownloadMaster}
              disabled={!masterDownloadUrl}
              className="shrink-0 px-4 py-2 rounded-lg bg-gradient-to-r from-[#c9a96e] to-[#a08050] text-[#0a0a0a] text-xs font-bold disabled:opacity-40 hover:-translate-y-0.5 transition-all"
            >
              ⬇ Download master
            </button>
          </div>
          <AudioPlayer buffer={masterAudioBuffer} label="Master" />
        </div>
      )}

      {/* Edited stems */}
      {doneStems.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">
              Edited stems{" "}
              <span className="text-[#888] font-normal">({doneStems.length})</span>
            </p>
            <button
              type="button"
              onClick={onDownloadAll}
              className="text-xs font-semibold text-[#c9a96e] hover:text-white transition-colors"
            >
              ⬇ Download all
            </button>
          </div>
          <div className="space-y-2">
            {doneStems.map((s) => (
              <FinalStemRow
                key={s.id}
                stem={s}
                onDownload={() =>
                  onDownloadStem(s.outPath!, `${s.name}_humanized.wav`)
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// A single edited-stem row: name, A/B toggle (Original vs Humanized), inline
// play, detection score, and a download link.
function FinalStemRow({
  stem,
  onDownload,
}: {
  stem: LocalStem;
  onDownload: () => void;
}) {
  const [abMode, setAbMode] = useState<"original" | "humanized">("humanized");
  const activeBuffer =
    abMode === "humanized" && stem.humanizedAudioBuffer
      ? stem.humanizedAudioBuffer
      : stem.audioBuffer;
  const canAb = !!stem.humanizedAudioBuffer;

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white truncate">{stem.name}</p>
          {stem.detection != null && (
            <p className="text-[11px] text-[#888]">
              Detection risk {Math.round(stem.detection * 100)}%
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canAb && (
            <div className="flex rounded-lg overflow-hidden border border-white/10 text-[11px]">
              <button
                type="button"
                onClick={() => setAbMode("original")}
                className={`px-2 py-1 font-semibold transition-colors ${
                  abMode === "original"
                    ? "bg-white/10 text-white"
                    : "text-[#888] hover:text-white"
                }`}
              >
                Original
              </button>
              <button
                type="button"
                onClick={() => setAbMode("humanized")}
                className={`px-2 py-1 font-semibold transition-colors ${
                  abMode === "humanized"
                    ? "bg-[#c9a96e]/20 text-[#c9a96e]"
                    : "text-[#888] hover:text-white"
                }`}
              >
                Humanized
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={onDownload}
            className="text-xs font-semibold text-[#c9a96e] hover:text-white transition-colors"
          >
            ⬇
          </button>
        </div>
      </div>
      <AudioPlayer buffer={activeBuffer} label={abMode === "humanized" ? "Humanized" : "Original"} />
    </div>
  );
}

// Minimal Web Audio play/stop control. Decodes are done upstream (the workspace
// fetches signed URLs and decodes them into AudioBuffers); here we just play.
function AudioPlayer({ buffer, label }: { buffer: AudioBuffer | null; label: string }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const srcRef = useRef<AudioBufferSourceNode | null>(null);

  const stop = useCallback(() => {
    if (srcRef.current) {
      try {
        srcRef.current.stop();
      } catch {
        /* already stopped */
      }
      srcRef.current.disconnect();
      srcRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  const play = useCallback(() => {
    if (!buffer) return;
    stop();
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!ctxRef.current) ctxRef.current = new AudioCtx();
    const ctx = ctxRef.current;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => setIsPlaying(false);
    source.start();
    srcRef.current = source;
    setIsPlaying(true);
  }, [buffer, stop]);

  useEffect(() => stop, [stop]);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={isPlaying ? stop : play}
        disabled={!buffer}
        aria-label={isPlaying ? "Stop" : "Play"}
        className="w-8 h-8 rounded-full bg-white/5 border border-white/10 hover:border-[#c9a96e]/40 flex items-center justify-center text-sm disabled:opacity-30 transition-all"
      >
        {isPlaying ? "⏹" : "▶"}
      </button>
      <span className="text-[11px] text-[#888]">
        {buffer ? (isPlaying ? `Playing ${label}…` : `Play ${label}`) : "Loading audio…"}
      </span>
    </div>
  );
}
