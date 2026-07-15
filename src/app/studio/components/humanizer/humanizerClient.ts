"use client";

import { authFetch } from "@/lib/authClient";
import { supabase } from "@/lib/supabase";

// Shared types + fetch helpers for the Humanizer workspace. Kept separate
// from the components so HumanizerWorkspace, StemLane, and
// HumanizerInspector can all import the same shapes without a circular
// dependency.

export type PresetId = "subtle" | "natural" | "loose" | "vintage";
export type ForensicIntensity = "light" | "medium" | "heavy";
export type StemStatus = "pending" | "processing" | "done" | "failed";
export type JobStatus = "pending" | "processing" | "completed" | "failed";

export interface PresetInfo {
  id: PresetId;
  label: string;
  description: string;
}

export const PRESETS: PresetInfo[] = [
  { id: "subtle", label: "Subtle", description: "Barely noticeable · polished, radio-ready pop" },
  { id: "natural", label: "Natural", description: "Good studio session · safe default" },
  { id: "loose", label: "Loose", description: "Jam session energy · live band / hip-hop" },
  { id: "vintage", label: "Vintage", description: "Old tape, warm tubes · 1970s / lo-fi" },
];

export const DEFAULT_PRESET: PresetId = "natural";

export interface ForensicIntensityInfo {
  id: ForensicIntensity;
  label: string;
  description: string;
}

export const FORENSIC_INTENSITIES: ForensicIntensityInfo[] = [
  { id: "light", label: "Light", description: "~20% detection risk reduction" },
  { id: "medium", label: "Medium", description: "~12% detection risk reduction" },
  { id: "heavy", label: "Heavy", description: "~8% detection risk reduction" },
];

export const DEFAULT_FORENSIC_INTENSITY: ForensicIntensity = "medium";

export const MAX_STEMS = 15;

// Suno-Studio-style per-lane accent colors, cycled by stem index.
export const LANE_COLORS = [
  "#e0116f", // pink
  "#6d3ff0", // purple
  "#22c55e", // green
  "#ff5500", // brand orange
  "#3b82f6", // blue
  "#eab308", // amber
  "#06b6d4", // cyan
];

export function laneColor(index: number): string {
  return LANE_COLORS[index % LANE_COLORS.length];
}

export interface JobStem {
  name: string;
  inPath: string;
  status: StemStatus;
  outPath: string | null;
  detection: number | null;
}

export interface HumanizeJob {
  id: string;
  user_id: string;
  status: JobStatus;
  preset: PresetId;
  forensic: boolean;
  forensic_intensity: ForensicIntensity;
  blend: boolean;
  stems: JobStem[];
  master_path: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

// A stem as tracked client-side before/while a job exists — merges the local
// file + waveform state with whatever the server has reported back.
export interface LocalStem {
  id: string; // stable client-side key (crypto.randomUUID())
  name: string;
  file: File;
  color: string;
  path: string | null; // storage path once uploaded
  uploadProgress: number; // 0-100
  status: StemStatus;
  outPath: string | null;
  detection: number | null;
  audioBuffer: AudioBuffer | null;
  humanizedAudioBuffer: AudioBuffer | null;
  presetOverride: PresetId | null; // null = use global preset
  error: string | null;
}

export interface UploadUrlEntry {
  name: string;
  uploadUrl: string;
  path: string;
}

export async function requestUploadUrls(
  stems: { name: string }[],
): Promise<{ jobId: string; urls: UploadUrlEntry[] }> {
  const res = await authFetch("/api/studio/humanize/upload-urls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stems }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error ?? "Failed to get upload URLs");
  }
  return data as { jobId: string; urls: UploadUrlEntry[] };
}

export async function uploadStemFile(
  uploadUrl: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<void> {
  // Supabase signed upload URLs accept a plain PUT. XHR (not fetch) so we can
  // report upload progress into the per-lane progress bar.
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl, true);
    xhr.setRequestHeader("Content-Type", file.type || "audio/wav");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(file);
  });
}

export async function createHumanizeJob(params: {
  jobId: string;
  stems: { name: string; path: string }[];
  preset: PresetId;
  forensic: boolean;
  forensicIntensity: ForensicIntensity;
  blend: boolean;
}): Promise<{ jobId: string }> {
  const res = await authFetch("/api/studio/humanize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error ?? "Failed to start humanize job");
  }
  return data as { jobId: string };
}

// Lists the caller's own humanize jobs (default: completed only), newest
// first — powers the persistent "My Humanized Tracks" library.
export async function fetchHumanizeJobs(
  opts: { status?: "completed" | "all"; limit?: number } = {},
): Promise<HumanizeJob[]> {
  const params = new URLSearchParams();
  if (opts.status) params.set("status", opts.status);
  if (opts.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  const res = await authFetch(
    `/api/studio/humanize/jobs${qs ? `?${qs}` : ""}`,
    { method: "GET" },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error ?? "Failed to load humanize jobs");
  }
  return (data.jobs ?? []) as HumanizeJob[];
}

// The humanizer-stems bucket is private (no public URL), so downloads and A/B
// playback both need a short-lived signed URL minted server-side via
// /api/studio/humanize/sign. Shared here so both the workspace and the
// library use one implementation.
export async function getStemDownloadUrl(path: string): Promise<string | null> {
  try {
    const res = await authFetch(
      `/api/studio/humanize/sign?path=${encodeURIComponent(path)}`,
      { method: "GET" },
    );
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return data?.url ?? null;
  } catch (err) {
    console.error("Failed to sign stem download URL:", err);
    return null;
  }
}

export async function fetchJobStatus(jobId: string): Promise<HumanizeJob> {
  const res = await authFetch(`/api/studio/humanize/${jobId}`, { method: "GET" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error ?? "Failed to fetch job status");
  }
  return data.job as HumanizeJob;
}

// Subscribes to Realtime updates for a single humanize_jobs row. Returns an
// unsubscribe function. Falls back to polling is handled by the caller
// (HumanizerWorkspace) — this only wires the Realtime side.
export function subscribeJob(
  jobId: string,
  onUpdate: (job: HumanizeJob) => void,
): () => void {
  const channel = supabase
    .channel(`humanize_jobs-${jobId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "humanize_jobs",
        filter: `id=eq.${jobId}`,
      },
      (payload) => {
        if (payload.new) onUpdate(payload.new as HumanizeJob);
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  const arrayBuffer = await file.arrayBuffer();
  try {
    return await ctx.decodeAudioData(arrayBuffer);
  } finally {
    // Closing releases the audio graph promptly; playback uses fresh
    // AudioContexts elsewhere so this one is only needed for decoding.
    ctx.close().catch(() => {});
  }
}

export async function decodeAudioUrl(url: string): Promise<AudioBuffer> {
  const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  try {
    return await ctx.decodeAudioData(arrayBuffer);
  } finally {
    ctx.close().catch(() => {});
  }
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
