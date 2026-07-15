"use client";

import { useCallback, useRef, useState } from "react";
import { MAX_STEMS } from "./humanizerClient";

interface StemDropzoneProps {
  slotsUsed: number;
  disabled?: boolean;
  onFilesSelected: (files: File[]) => void;
}

// Drag-and-drop + file-picker zone for adding WAV stems. Caps the batch at
// however many slots remain (MAX_STEMS total) and silently drops anything
// that isn't a .wav — the caller still re-validates, this is just the UX
// guard so a mixed selection doesn't error out the whole drop.
export default function StemDropzone({ slotsUsed, disabled, onFilesSelected }: StemDropzoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const slotsRemaining = Math.max(0, MAX_STEMS - slotsUsed);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || disabled) return;
      const wavFiles = Array.from(fileList).filter((f) =>
        /\.wav$/i.test(f.name) || f.type === "audio/wav" || f.type === "audio/x-wav",
      );
      if (wavFiles.length === 0) return;
      onFilesSelected(wavFiles.slice(0, slotsRemaining));
    },
    [disabled, onFilesSelected, slotsRemaining],
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => {
        if (!disabled && slotsRemaining > 0) inputRef.current?.click();
      }}
      className={`rounded-2xl border-2 border-dashed p-8 text-center transition-all cursor-pointer
        ${isDragOver ? "border-[#c9a96e] bg-[#c9a96e]/5" : "border-white/10 bg-white/[0.02]"}
        ${disabled || slotsRemaining === 0 ? "opacity-50 cursor-not-allowed" : "hover:border-[#c9a96e]/40"}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".wav,audio/wav,audio/x-wav"
        multiple
        className="hidden"
        disabled={disabled || slotsRemaining === 0}
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="text-4xl mb-3">🎛️</div>
      <p className="text-white font-semibold mb-1">
        Drag &amp; drop WAV stems, or click to browse
      </p>
      <p className="text-[#888] text-sm">
        Drums, bass, vocals, strings — anything. Up to {MAX_STEMS} stems.
      </p>
      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-[#c9a96e]">
        {slotsUsed} / {MAX_STEMS} stems
      </p>
    </div>
  );
}
