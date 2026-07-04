"use client";

import { useRef, useState } from "react";
import { authFetch } from "@/lib/authClient";

type Slot = "avatar" | "cover";

interface ProfilePhotoUploaderProps {
  slot: Slot;
  label: string;
  currentUrl?: string | null;
  // Aspect hint for the preview box only.
  shape?: "circle" | "banner";
  onUploaded?: (publicUrl: string) => void;
}

// Uploads a profile picture (avatar) or top-bar banner (cover) for the
// signed-in artist. Flow: POST for a signed URL -> PUT the file to storage
// -> PATCH to persist the public URL on the artist row.
export default function ProfilePhotoUploader({
  slot,
  label,
  currentUrl,
  shape = "circle",
  onUploaded,
}: ProfilePhotoUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(currentUrl ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = () => inputRef.current?.click();

  const handleFile = async (file: File) => {
    const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!validTypes.includes(file.type)) {
      setError("Please choose a JPG, PNG, WEBP, or GIF image.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError("Image must be 8MB or smaller.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const urlRes = await authFetch("/api/artist/profile-media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, slot }),
      });
      const urlBody = await urlRes.json().catch(() => ({}) as any);
      if (!urlRes.ok || !urlBody?.signedUrl || !urlBody?.publicUrl) {
        setError(urlBody?.error ?? "Could not start the upload.");
        setBusy(false);
        return;
      }

      const putRes = await fetch(urlBody.signedUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!putRes.ok) {
        setError("Upload failed. Please try again.");
        setBusy(false);
        return;
      }

      const saveRes = await authFetch("/api/artist/profile-media", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicUrl: urlBody.publicUrl, slot }),
      });
      const saveBody = await saveRes.json().catch(() => ({}) as any);
      if (!saveRes.ok) {
        setError(saveBody?.error ?? "Uploaded, but could not save the photo.");
        setBusy(false);
        return;
      }

      setPreview(urlBody.publicUrl);
      onUploaded?.(urlBody.publicUrl);
      setBusy(false);
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong. Please try again.");
      setBusy(false);
    }
  };

  const previewClasses =
    shape === "banner"
      ? "w-full h-32 rounded-xl object-cover"
      : "w-24 h-24 rounded-full object-cover";

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-melori-text">{label}</span>
      <div className="flex items-center gap-4">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt={label} className={previewClasses} />
        ) : (
          <div
            className={`${
              shape === "banner" ? "w-full h-32 rounded-xl" : "w-24 h-24 rounded-full"
            } bg-melori-elevated border border-melori-border flex items-center justify-center text-xs text-melori-muted`}
          >
            No photo
          </div>
        )}
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={pick}
            disabled={busy}
            className="btn-primary px-4 py-2 rounded-full text-sm font-semibold disabled:opacity-50"
          >
            {busy ? "Uploading\u2026" : preview ? "Change photo" : "Upload photo"}
          </button>
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
