"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Film,
  Link2,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { authFetch } from "@/lib/authClient";
import { classifySource } from "@/lib/cinemaPlayback";
import type { SocialVideo } from "@/types/social";

/**
 * How the host chooses what the room watches.
 *
 * Three sources, because a host arrives in one of three states: the file is on
 * their device, it's already on Melori, or it's hosted somewhere else. Before
 * this, only the third case worked — the room accepted a pasted URL and
 * nothing else, which made a phone full of video useless.
 *
 * Every path ends at the same place: an https URL to a directly playable file,
 * handed to `onPick`. The room's playback sync doesn't care where it came from.
 */

type Tab = "upload" | "library" | "link";

/**
 * Cinema screenings are feature-length, not 60-second reels, so the 200 MB reel
 * cap would be absurd here. This is still bounded: an unbounded browser PUT of
 * a multi-gigabyte file will die on a phone connection long before it lands,
 * and failing fast with a readable message beats a twenty-minute upload that
 * silently drops.
 */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

/**
 * Uploads via XHR rather than fetch purely for `upload.onprogress`. A host
 * watching a 1.4 GB file go up needs a progress bar; fetch still can't give one
 * for request bodies.
 */
function putWithProgress(
  signedUrl: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl);
    xhr.setRequestHeader(
      "Content-Type",
      file.type || "application/octet-stream",
    );
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress((e.loaded / e.total) * 100);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error("Upload failed — check your connection."));
    xhr.onabort = () => reject(new Error("Upload cancelled."));
    xhr.send(file);
  });
}

export function CinemaSourcePicker({
  onPick,
  compact = false,
}: {
  /** Called with a validated, directly playable https URL. */
  onPick: (url: string) => void;
  /** Dense variant for the bar under a screen that's already playing. */
  compact?: boolean;
}) {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("upload");
  const [error, setError] = useState<string | null>(null);

  // Upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadName, setUploadName] = useState<string | null>(null);

  // Library
  const [library, setLibrary] = useState<SocialVideo[] | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(false);

  // Link
  const [urlDraft, setUrlDraft] = useState("");

  /** Single funnel for all three tabs, so validation can't be skipped. */
  const commit = useCallback(
    (rawUrl: string) => {
      const verdict = classifySource(rawUrl);
      if (!verdict.ok) {
        setError(verdict.reason);
        return;
      }
      setError(null);
      setUrlDraft("");
      onPick(verdict.url);
    },
    [onPick],
  );

  // --- Upload ---------------------------------------------------------------
  const handleFile = useCallback(
    async (file: File) => {
      if (file.size > MAX_UPLOAD_BYTES) {
        setError(
          `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(
            MAX_UPLOAD_BYTES,
          )} — try a compressed version, or host it and paste the link.`,
        );
        return;
      }

      setError(null);
      setUploading(true);
      setProgress(0);
      setUploadName(file.name);

      try {
        // Reuses the same signed-URL endpoint as social video posts, which
        // namespaces every file under social/{userId}/ — a Cinema upload can't
        // stomp anyone else's media.
        const urlRes = await authFetch("/api/social/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, type: "video" }),
        });
        if (!urlRes.ok) {
          const d = await urlRes.json().catch(() => ({}));
          throw new Error(d.error ?? "Could not start the upload.");
        }
        const { signedUrl, publicUrl } = await urlRes.json();

        await putWithProgress(signedUrl, file, setProgress);
        commit(publicUrl);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setUploading(false);
        setUploadName(null);
        setProgress(0);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [commit],
  );

  // --- Library --------------------------------------------------------------
  useEffect(() => {
    if (tab !== "library" || library !== null || libraryLoading) return;
    setLibraryLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/social/videos");
        const json = (await res.json()) as { videos?: SocialVideo[] };
        // Only things this player can actually play: real uploads (not YouTube
        // rows, which need an embed the shared screen doesn't have yet) whose
        // URL passes the same check as a pasted link.
        const playable = (json.videos ?? []).filter(
          (v) =>
            v.media_type === "video" &&
            v.source !== "youtube" &&
            classifySource(v.video_url).ok,
        );
        setLibrary(playable);
      } catch {
        setLibrary([]);
        setError("Couldn't load your Melori videos.");
      } finally {
        setLibraryLoading(false);
      }
    })();
  }, [tab, library, libraryLoading]);

  const mine = (library ?? []).filter((v) => v.user_id === user?.id);
  const theirs = (library ?? []).filter((v) => v.user_id !== user?.id);

  const tabs: { id: Tab; label: string; icon: typeof Upload }[] = [
    { id: "upload", label: "Upload", icon: Upload },
    { id: "library", label: "My Melori videos", icon: Film },
    { id: "link", label: "Paste a link", icon: Link2 },
  ];

  return (
    <div className={compact ? "" : "border-t border-cinema-border p-3"}>
      <div
        role="tablist"
        aria-label="Choose what to play"
        className="mb-3 flex gap-1"
      >
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setTab(t.id);
                setError(null);
              }}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                active
                  ? "bg-cinema-gold text-black"
                  : "text-white/50 hover:text-cinema-gold"
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "upload" && (
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          {uploading ? (
            <div className="rounded-lg border border-cinema-border bg-black/40 px-3 py-3">
              <div className="mb-2 flex items-center gap-2 text-xs text-white/70">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-cinema-gold" aria-hidden />
                <span className="truncate">{uploadName}</span>
                <span className="ml-auto font-mono tabular-nums text-cinema-gold">
                  {Math.round(progress)}%
                </span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full bg-cinema-gold transition-[width]"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-cinema-border px-4 py-4 text-sm font-medium text-white/70 transition hover:border-cinema-gold/50 hover:text-cinema-gold"
            >
              <Upload className="h-4 w-4" aria-hidden />
              Choose a video from your device
            </button>
          )}
          {!uploading && (
            <p className="mt-2 text-[11px] text-white/35">
              Up to {formatBytes(MAX_UPLOAD_BYTES)}. It uploads to your Melori
              library, so you can screen it again without re-uploading.
            </p>
          )}
        </div>
      )}

      {tab === "library" && (
        <div className="max-h-64 overflow-y-auto">
          {libraryLoading && (
            <div className="flex items-center gap-2 px-1 py-6 text-xs text-white/50">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Loading your videos…
            </div>
          )}

          {!libraryLoading && library !== null && library.length === 0 && (
            <p className="px-1 py-6 text-center text-xs text-white/40">
              Nothing playable on Melori yet. Upload a file, or paste a link.
            </p>
          )}

          {!libraryLoading && (mine.length > 0 || theirs.length > 0) && (
            <div className="space-y-4">
              {mine.length > 0 && (
                <VideoGroup label="Yours" videos={mine} onPick={commit} />
              )}
              {theirs.length > 0 && (
                <VideoGroup label="Recent on Melori" videos={theirs} onPick={commit} />
              )}
            </div>
          )}
        </div>
      )}

      {tab === "link" && (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Link2
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30"
              aria-hidden
            />
            <input
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && commit(urlDraft)}
              placeholder="https://… .mp4"
              aria-label="Video link"
              className="w-full rounded-lg border border-cinema-border bg-black/40 py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-white/25 focus:border-cinema-gold/50 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => commit(urlDraft)}
            className="shrink-0 rounded-lg bg-cinema-gold px-4 text-sm font-semibold text-black transition hover:brightness-110"
          >
            Load
          </button>
        </div>
      )}

      {error && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-red-400">
          <X className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}

function VideoGroup({
  label,
  videos,
  onPick,
}: {
  label: string;
  videos: SocialVideo[];
  onPick: (url: string) => void;
}) {
  return (
    <div>
      <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">
        {label}
      </p>
      <div className="space-y-1">
        {videos.map((video) => (
          <button
            key={video.id}
            type="button"
            onClick={() => onPick(video.video_url)}
            className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-white/5"
          >
            <span className="grid h-10 w-16 shrink-0 place-items-center overflow-hidden rounded bg-black/60">
              {video.thumbnail_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={video.thumbnail_url}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <Film className="h-4 w-4 text-white/25" aria-hidden />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-white">
                {video.title}
              </span>
              {video.user?.display_name && (
                <span className="block truncate text-[11px] text-white/40">
                  {video.user.display_name}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
