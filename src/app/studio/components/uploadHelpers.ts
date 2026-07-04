// Shared client-side helpers for uploading full-quality audio masters from the
// Artist Studio. Masters are PUT directly to Supabase Storage using a signed
// upload URL from /api/studio/upload-url, so the file never passes through the
// Vercel serverless function (which has a small request-body limit) — only the
// small JSON metadata does. Mirrors the admin uploadHelpers pattern (PR #33)
// but targets the studio endpoints and forwards the artist's auth token.

import { authFetch } from "@/lib/authClient";

export const AUDIO_TYPES = [
  "audio/mpeg",
  "audio/wav",
  "audio/flac",
  "audio/x-wav",
  "audio/x-flac",
];

export const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

// Returns an error message if the file is not an acceptable master, else null.
export function validateAudioFile(f: File): string | null {
  if (!AUDIO_TYPES.includes(f.type) && !f.name.match(/\.(mp3|wav|flac)$/i)) {
    return "Please choose an MP3, WAV, or FLAC file.";
  }
  if (f.size > MAX_AUDIO_BYTES) {
    return "File exceeds the 100MB limit.";
  }
  return null;
}

// Read the duration from the file locally (best-effort; resolves null on failure).
export function probeDuration(f: File): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(f);
      const audio = new Audio();
      audio.preload = "metadata";
      audio.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(audio.duration) ? audio.duration : null);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      audio.src = url;
    } catch {
      resolve(null);
    }
  });
}

// PUT the file to the signed URL with real upload progress via XHR (fetch does
// not expose upload progress).
export function putWithProgress(
  url: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader(
      "Content-Type",
      file.type || "application/octet-stream",
    );
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Storage upload failed (HTTP ${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.onabort = () => reject(new Error("Upload was cancelled."));
    xhr.send(file);
  });
}

export interface UploadedMaster {
  publicUrl: string; // permanent public URL saved into studio_tracks.file_url
  path: string; // storage path saved into studio_tracks.file_path
  duration: number | null;
}

// Full presigned upload flow for a studio audio master:
//   1. ask the server for a signed upload URL,
//   2. PUT the file straight to storage (with real progress),
//   3. probe the duration locally.
export async function uploadStudioMaster(
  file: File,
  onProgress: (pct: number) => void,
): Promise<UploadedMaster> {
  const urlRes = await authFetch("/api/studio/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      type: "audio",
    }),
  });
  if (!urlRes.ok) {
    const d = await urlRes.json().catch(() => ({}));
    throw new Error(d.error ?? "Could not get an upload URL.");
  }
  const { signedUrl, publicUrl, path } = await urlRes.json();
  if (!signedUrl) {
    throw new Error("Could not get an upload URL.");
  }

  await putWithProgress(signedUrl, file, onProgress);

  const duration = await probeDuration(file);

  return { publicUrl, path, duration };
}
