"use client";

import { useState } from "react";
import { authFetch } from "@/lib/authClient";
import WaveformEditor from "./WaveformEditor";
import {
  uploadStudioMaster,
  validateAudioFile,
} from "./uploadHelpers";

interface TrackReplacePanelProps {
  trackId: string;
  trackTitle: string;
  onClose: () => void;
  // Called after the master is replaced so the list can refresh its rows.
  onReplaced: () => void;
}

type Stage = "select" | "uploading" | "preview";

// Inline, expanding panel shown beneath a studio track card. Lets an artist
// replace the full-quality master for an EXISTING track and then re-pick its
// 30-second preview window on the new audio — all without leaving the list.
export default function TrackReplacePanel({
  trackId,
  trackTitle,
  onClose,
  onReplaced,
}: TrackReplacePanelProps) {
  const [stage, setStage] = useState<Stage>("select");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const pickFile = (f: File) => {
    const msg = validateAudioFile(f);
    if (msg) {
      setError(msg);
      return;
    }
    setError(null);
    setFile(f);
  };

  const startUpload = async () => {
    if (!file) return;
    setStage("uploading");
    setProgress(0);
    setError(null);
    try {
      const master = await uploadStudioMaster(file, setProgress);

      const res = await authFetch(`/api/studio/track/${trackId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_url: master.publicUrl,
          file_path: master.path,
          duration: master.duration,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Could not save the new master.");
      }

      // Master persisted; the old preview was cleared server-side. Let the list
      // refresh, then move on to re-picking the preview on the new master.
      onReplaced();
      setStage("preview");
    } catch (err: any) {
      setError(err?.message ?? "Upload failed.");
      setStage("select");
    }
  };

  return (
    <div className="mt-4 bg-black/30 border border-[#c9a96e]/20 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-[#c9a96e]">
          Replace master — {trackTitle}
        </h4>
        <button
          onClick={onClose}
          disabled={stage === "uploading"}
          className="text-xs text-[#888] hover:text-white disabled:opacity-40"
        >
          Close
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-2.5 text-sm text-red-400">
          {error}
        </div>
      )}

      {stage === "preview" ? (
        <div className="space-y-3">
          <p className="text-xs text-[#888]">
            New master uploaded. The old preview was cleared — drag the handles
            to set a fresh 30-second preview on the new audio, then generate it.
          </p>
          <WaveformEditor trackId={trackId} onBack={onClose} />
        </div>
      ) : (
        <>
          <div
            onDragEnter={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragActive(false);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              if (e.dataTransfer.files?.[0]) pickFile(e.dataTransfer.files[0]);
            }}
            className={`border-2 border-dashed rounded-xl p-6 text-center transition-all ${
              dragActive
                ? "border-[#c9a96e] bg-[#c9a96e]/5"
                : file
                  ? "border-green-500/50 bg-green-500/5"
                  : "border-white/10 hover:border-white/20"
            }`}
          >
            <input
              type="file"
              accept=".mp3,.wav,.flac,audio/*"
              disabled={stage === "uploading"}
              onChange={(e) =>
                e.target.files?.[0] && pickFile(e.target.files[0])
              }
              className="hidden"
              id={`master-replace-${trackId}`}
            />
            <label
              htmlFor={`master-replace-${trackId}`}
              className="cursor-pointer block"
            >
              <div className="text-3xl mb-2">{file ? "🎵" : "📤"}</div>
              <p className="font-semibold mb-0.5">
                {file ? file.name : "Drop the new master audio here"}
              </p>
              <p className="text-xs text-[#888]">
                {file
                  ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
                  : "MP3, WAV, or FLAC up to 100MB"}
              </p>
            </label>
          </div>

          {stage === "uploading" && (
            <div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#c9a96e] to-[#a08050] transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-[#888]">
                Uploading… {progress}%
              </p>
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button
              onClick={onClose}
              disabled={stage === "uploading"}
              className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm font-semibold disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={startUpload}
              disabled={!file || stage === "uploading"}
              className="px-5 py-2 bg-gradient-to-r from-[#c9a96e] to-[#a08050] text-[#0a0a0a] font-bold rounded-lg text-sm disabled:opacity-50"
            >
              {stage === "uploading"
                ? `Uploading… ${progress}%`
                : "Upload & set preview →"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
