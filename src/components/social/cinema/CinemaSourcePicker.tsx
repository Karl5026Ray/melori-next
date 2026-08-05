"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Film,
  Link2,
  Loader2,
  Pause,
  Play,
  Upload,
  X,
} from "lucide-react";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { authFetch } from "@/lib/authClient";
import { type CinemaSourceType, classifySource } from "@/lib/cinemaPlayback";
import {
  MAX_UPLOAD_BYTES,
  RESUMABLE_THRESHOLD_BYTES,
  buildObjectPath,
  formatBytes,
  startResumableUpload,
  type ResumableHandle,
} from "@/lib/cinemaResumableUpload";
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
 * Two upload paths, chosen by size.
 *
 * Small file: one signed PUT, same as every other upload in the app. Simple,
 * one round trip, and a failure is cheap to retry.
 *
 * Large file: Supabase's resumable TUS endpoint, which survives a dropped
 * connection, a backgrounded tab, or a closed browser by continuing from the
 * last committed byte instead of restarting. A feature-length screening over a
 * phone connection is exactly the case a single PUT cannot survive.
 *
 * See src/lib/cinemaResumableUpload.ts for the threshold and the auth model.
 */

/**
 * Small-file path. XHR rather than fetch purely for `upload.onprogress` —
 * fetch still cannot report request-body progress.
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
  onPick: (url: string, type: CinemaSourceType) => void;
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
  const [resumable, setResumable] = useState(false);
  const [paused, setPaused] = useState(false);
  const [resumedNote, setResumedNote] = useState<string | null>(null);
  const handleRef = useRef<ResumableHandle | null>(null);

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
      // The type travels with the URL. Without it the room would store a
      // YouTube watch link under source_type 'url' and mount a <video> that
      // can never play it.
      onPick(verdict.url, verdict.type);
    },
    [onPick],
  );

  // --- Upload ---------------------------------------------------------------
  const resetUploadUi = useCallback(() => {
    setUploading(false);
    setUploadName(null);
    setProgress(0);
    setResumable(false);
    setPaused(false);
    handleRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

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
      setResumedNote(null);
      setUploading(true);
      setProgress(0);
      setUploadName(file.name);
      setPaused(false);

      // ---- Large file: resumable -------------------------------------------
      if (file.size > RESUMABLE_THRESHOLD_BYTES) {
        if (!user?.id) {
          setError("Sign in again to upload.");
          resetUploadUi();
          return;
        }
        setResumable(true);
        try {
          handleRef.current = await startResumableUpload(
            file,
            buildObjectPath(user.id, file.name),
            {
              onProgress: (percent) => setProgress(percent),
              onResumeDetected: (already) =>
                setResumedNote(
                  `Picked up where you left off — ${Math.round(already)}% was already uploaded.`,
                ),
              onSuccess: (publicUrl) => {
                resetUploadUi();
                commit(publicUrl);
              },
              onError: (message) => {
                // Deliberately do NOT clear the upload UI: the bytes already on
                // the server are still valid, and re-picking the same file
                // resumes rather than restarts.
                setError(`${message} Pick the same file again to resume.`);
                setUploading(false);
                handleRef.current = null;
              },
            },
          );
        } catch (err) {
          setError(err instanceof Error ? err.message : "Upload failed.");
          resetUploadUi();
        }
        return;
      }

      // ---- Small file: one signed PUT ---------------------------------------
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
        resetUploadUi();
      }
    },
    [commit, resetUploadUi, user?.id],
  );

  const togglePause = useCallback(() => {
    const handle = handleRef.current;
    if (!handle) return;
    if (paused) {
      handle.resume();
      setPaused(false);
    } else {
      handle.pause();
      setPaused(true);
    }
  }, [paused]);

  const cancelUpload = useCallback(async () => {
    const handle = handleRef.current;
    if (handle) await handle.abort().catch(() => {});
    resetUploadUi();
  }, [resetUploadUi]);

  // Abandoning the room mid-upload shouldn't leave a zombie XHR running. The
  // partial object survives on the server either way, so this only stops the
  // client — the upload can still be resumed later.
  useEffect(() => {
    return () => {
      handleRef.current?.pause();
    };
  }, []);

  // --- Library --------------------------------------------------------------
  useEffect(() => {
    if (tab !== "library" || library !== null || libraryLoading) return;
    setLibraryLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/social/videos");
        const json = (await res.json()) as { videos?: SocialVideo[] };
        // Only things this player can actually play. YouTube rows are now
        // included -- the shared screen has an IFrame player for them -- so the
        // one gate left is classifySource, the same check a pasted link faces.
        const playable = (json.videos ?? []).filter(
          (v) => v.media_type === "video" && classifySource(v.video_url).ok,
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
                {paused ? (
                  <Pause className="h-3.5 w-3.5 text-white/40" aria-hidden />
                ) : (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-cinema-gold" aria-hidden />
                )}
                <span className="truncate">{uploadName}</span>
                <span className="ml-auto font-mono tabular-nums text-cinema-gold">
                  {Math.round(progress)}%
                </span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full transition-[width] ${paused ? "bg-white/30" : "bg-cinema-gold"}`}
                  style={{ width: `${progress}%` }}
                />
              </div>

              {/* Pause / cancel only exist for the resumable path — there is no
                  safe way to pause a single PUT. */}
              {resumable && (
                <div className="mt-2.5 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={togglePause}
                    className="flex items-center gap-1.5 text-[11px] font-medium text-white/60 transition hover:text-cinema-gold"
                  >
                    {paused ? (
                      <>
                        <Play className="h-3 w-3" aria-hidden />
                        Resume
                      </>
                    ) : (
                      <>
                        <Pause className="h-3 w-3" aria-hidden />
                        Pause
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => void cancelUpload()}
                    className="text-[11px] font-medium text-white/40 transition hover:text-red-400"
                  >
                    Cancel
                  </button>
                  <span className="ml-auto text-[11px] text-white/30">
                    {paused ? "Paused — nothing is lost" : "Resumable"}
                  </span>
                </div>
              )}
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
              Up to {formatBytes(MAX_UPLOAD_BYTES)}. Anything over{" "}
              {formatBytes(RESUMABLE_THRESHOLD_BYTES)} uploads resumably — if
              the connection drops or you close the tab, picking the same file
              again continues from where it stopped. It stays in your Melori
              library, so you can screen it again without re-uploading.
            </p>
          )}

          {resumedNote && (
            <p className="mt-2 text-[11px] text-cinema-gold">{resumedNote}</p>
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
              placeholder="YouTube link, or https://… .mp4"
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
  onPick: (url: string, type: CinemaSourceType) => void;
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
            onClick={() => {
              const verdict = classifySource(video.video_url);
              onPick(video.video_url, verdict.ok ? verdict.type : "url");
            }}
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
