"use client";

import { useRef, useState } from "react";
import CoverImage from "@/components/CoverImage";

export const COVER_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_COVER_BYTES = 10 * 1024 * 1024;

export function validateCoverFile(f: File): string | null {
  if (!COVER_TYPES.includes(f.type)) return "Use a JPG, PNG or WebP image.";
  if (f.size > MAX_COVER_BYTES) return "Cover must be 10 MB or smaller.";
  return null;
}

interface CoverReplaceButtonProps {
  src: string | null | undefined;
  title: string;
  className?: string;
  // Uploads the file and saves it on the track. Resolves to the new public URL,
  // or throws with a user-facing message.
  onReplace: (file: File) => Promise<string>;
  onReplaced?: (newUrl: string) => void;
}

// A cover tile that doubles as a "replace cover" control: click it, pick an
// image, and it uploads + saves in place. Shared by the artist Studio list and
// the admin uploads page, which differ only in how `onReplace` uploads/saves.
export default function CoverReplaceButton({
  src,
  title,
  className = "",
  onReplace,
  onReplaced,
}: CoverReplaceButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const problem = validateCoverFile(file);
    if (problem) {
      window.alert(problem);
      return;
    }
    setBusy(true);
    try {
      const url = await onReplace(file);
      onReplaced?.(url);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not replace the cover.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <>
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      disabled={busy}
      title={`Replace cover for “${title}”`}
      aria-label={`Replace cover for ${title}`}
      className={`group relative shrink-0 overflow-hidden rounded-xl border border-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c9a96e] disabled:cursor-wait ${className}`}
    >
      {/* key={src} resets CoverImage's "failed to load" state when the URL changes. */}
      <CoverImage key={src ?? "none"} src={src} alt={title} name={title} rounded="rounded-xl" className="w-full h-full" />
      <span
        className={`absolute inset-0 flex items-center justify-center bg-black/60 text-[11px] font-medium text-white transition-opacity ${
          busy ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
        }`}
      >
        {busy ? "Uploading…" : "Replace"}
      </span>
    </button>
    {/* Kept outside the button so the programmatic click doesn't bubble back into it. */}
    <input
      ref={inputRef}
      type="file"
      accept={COVER_TYPES.join(",")}
      className="hidden"
      onChange={(e) => handleFile(e.target.files?.[0])}
    />
    </>
  );
}
