"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Video, Mic, Upload, Circle, Square } from "lucide-react";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { authFetch } from "@/lib/authClient";

type Mode = "video" | "audio" | "file";
type MediaType = "video" | "audio";

const MAX_SECONDS: Record<MediaType, number> = { video: 60, audio: 120 };

// Reels should stay lightweight. Reject oversized uploads on the client before
// we ever start a multi-hundred-MB transfer (a 732 MB clip makes tiles blank
// and playback hang). Recorded clips are already short, so this only guards the
// "Upload File" path.
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MB

// Grab the first visible frame of a video as a JPEG poster so the profile /
// feed grids have something to show without downloading the whole file. Runs
// entirely in the browser via <canvas>; returns null if the frame can't be
// read (e.g. cross-origin or unsupported codec) so publishing still succeeds.
async function captureVideoPoster(source: Blob | File): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(source);
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.src = url;

      const cleanup = () => URL.revokeObjectURL(url);
      const fail = () => {
        cleanup();
        resolve(null);
      };

      video.onloadeddata = () => {
        // Seek slightly in so we don't grab a black leading frame.
        const target = Math.min(0.1, (video.duration || 1) / 2);
        const onSeeked = () => {
          try {
            const canvas = document.createElement("canvas");
            canvas.width = video.videoWidth || 720;
            canvas.height = video.videoHeight || 1280;
            const ctx = canvas.getContext("2d");
            if (!ctx) return fail();
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(
              (blob) => {
                cleanup();
                resolve(blob);
              },
              "image/jpeg",
              0.8,
            );
          } catch {
            fail();
          }
        };
        video.onseeked = onSeeked;
        try {
          video.currentTime = target;
        } catch {
          onSeeked();
        }
      };
      video.onerror = fail;
      // Safety timeout so a stuck decode never blocks publishing.
      setTimeout(fail, 8000);
    } catch {
      resolve(null);
    }
  });
}

function pickVideoMime(): string {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

function pickAudioMime(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

export default function CreatePostButton() {
  const { user } = useAuth();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("video");
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const livePreviewRef = useRef<HTMLVideoElement>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const resetCapture = useCallback(() => {
    clearTimer();
    setRecording(false);
    setElapsed(0);
    setRecordedBlob(null);
    setPickedFile(null);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    chunksRef.current = [];
    recorderRef.current = null;
  }, [clearTimer]);

  const cleanup = useCallback(() => {
    try {
      recorderRef.current?.stop();
    } catch {
      /* already stopped */
    }
    stopStream();
    resetCapture();
    setError(null);
  }, [stopStream, resetCapture]);

  const closeModal = useCallback(() => {
    cleanup();
    setTitle("");
    setOpen(false);
  }, [cleanup]);

  // Release the camera/mic if the component unmounts while open.
  useEffect(() => cleanup, [cleanup]);

  // Escape to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closeModal]);

  // Start (or stop) the live camera/mic preview when switching modes.
  const startLivePreview = useCallback(
    async (m: Mode) => {
      stopStream();
      setError(null);
      if (m === "file") return;
      try {
        const constraints =
          m === "video" ? { video: true, audio: true } : { audio: true };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        if (m === "video" && livePreviewRef.current) {
          livePreviewRef.current.srcObject = stream;
          livePreviewRef.current.play().catch(() => {});
        }
      } catch {
        setError(
          "Camera/mic blocked. Grant permission or use Upload File instead.",
        );
      }
    },
    [stopStream],
  );

  const switchMode = useCallback(
    (m: Mode) => {
      resetCapture();
      setMode(m);
      void startLivePreview(m);
    },
    [resetCapture, startLivePreview],
  );

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) {
      void startLivePreview(mode);
      return;
    }
    const mimeType = mode === "video" ? pickVideoMime() : pickAudioMime();
    const kind: MediaType = mode === "video" ? "video" : "audio";
    chunksRef.current = [];
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
    } catch {
      setError("Recording is not supported in this browser.");
      return;
    }
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, {
        type: mimeType || (kind === "video" ? "video/webm" : "audio/webm"),
      });
      setRecordedBlob(blob);
      setPreviewUrl(URL.createObjectURL(blob));
      // Free the camera light once we have the clip; review uses the blob URL.
      stopStream();
    };
    recorder.start();
    recorderRef.current = recorder;
    setRecording(true);
    setElapsed(0);
    clearTimer();
    timerRef.current = setInterval(() => {
      setElapsed((prev) => {
        const next = prev + 1;
        if (next >= MAX_SECONDS[kind]) {
          stopRecording();
        }
        return next;
      });
    }, 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, startLivePreview, clearTimer, stopStream]);

  const stopRecording = useCallback(() => {
    clearTimer();
    setRecording(false);
    try {
      recorderRef.current?.stop();
    } catch {
      /* ignore */
    }
  }, [clearTimer]);

  const reRecord = useCallback(() => {
    resetCapture();
    void startLivePreview(mode);
  }, [resetCapture, startLivePreview, mode]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setError(null);
    if (file && file.size > MAX_UPLOAD_BYTES) {
      // Reset the input so the same oversized file can be re-picked after the
      // user trims it, and surface a clear limit instead of silently uploading
      // a huge clip that later renders as a blank tile.
      e.target.value = "";
      setPickedFile(null);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setError(
        `That file is ${(file.size / (1024 * 1024)).toFixed(0)}MB. Reels must be under ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB — please trim or compress it.`,
      );
      return;
    }
    setPickedFile(file);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
  };

  const publish = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Add a title first.");
      return;
    }
    const source: Blob | File | null =
      mode === "file" ? pickedFile : recordedBlob;
    if (!source) {
      setError("Record or choose a file first.");
      return;
    }

    const mediaType: MediaType =
      mode === "audio"
        ? "audio"
        : mode === "video"
          ? "video"
          : source.type.startsWith("audio/")
            ? "audio"
            : "video";

    const ext =
      source instanceof File && source.name.includes(".")
        ? source.name.split(".").pop()
        : mediaType === "audio"
          ? "webm"
          : "webm";
    const filename =
      source instanceof File
        ? source.name
        : `recording-${Date.now()}.${ext}`;
    const contentType = source.type || "application/octet-stream";

    setPublishing(true);
    setError(null);
    try {
      const urlRes = await authFetch("/api/social/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, type: mediaType }),
      });
      if (!urlRes.ok) {
        const d = await urlRes.json().catch(() => ({}));
        throw new Error(d.error ?? "Could not get an upload URL.");
      }
      const { signedUrl, publicUrl } = await urlRes.json();

      const putRes = await fetch(signedUrl, {
        method: "PUT",
        body: source,
        headers: { "Content-Type": contentType },
      });
      if (!putRes.ok) throw new Error("Upload failed — please try again.");

      // For video reels, capture a poster frame client-side and upload it so
      // grids can show a real thumbnail instead of trying to paint an .mp4 in
      // an <img>. Best-effort: any failure here just leaves thumbnail_url null.
      let thumbnailUrl: string | null = null;
      if (mediaType === "video") {
        try {
          const poster = await captureVideoPoster(source);
          if (poster) {
            const thumbName = `${filename.replace(/\.[^.]+$/, "")}_poster.jpg`;
            const thumbUrlRes = await authFetch("/api/social/upload-url", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ filename: thumbName, type: "thumbnail" }),
            });
            if (thumbUrlRes.ok) {
              const { signedUrl: thumbSigned, publicUrl: thumbPublic } =
                await thumbUrlRes.json();
              const thumbPut = await fetch(thumbSigned, {
                method: "PUT",
                body: poster,
                headers: { "Content-Type": "image/jpeg" },
              });
              if (thumbPut.ok) thumbnailUrl = thumbPublic;
            }
          }
        } catch {
          /* poster is optional — publish without it */
        }
      }

      const saveRes = await authFetch("/api/social/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: trimmed,
          video_url: publicUrl,
          media_type: mediaType,
          thumbnail_url: thumbnailUrl,
        }),
      });
      if (!saveRes.ok) {
        const d = await saveRes.json().catch(() => ({}));
        throw new Error(d.error ?? "Could not publish your post.");
      }

      closeModal();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPublishing(false);
    }
  }, [title, mode, pickedFile, recordedBlob, closeModal, router]);

  const handleFabClick = () => {
    if (!user) {
      router.push("/social/auth");
      return;
    }
    setOpen(true);
    setMode("video");
    void startLivePreview("video");
  };

  // Hide entirely for logged-out users; they can still browse the feed.
  if (!user) return null;

  const mmss = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const hasClip = mode === "file" ? !!pickedFile : !!recordedBlob;

  const tabs: { key: Mode; label: string; icon: typeof Video }[] = [
    { key: "video", label: "Record Video", icon: Video },
    { key: "audio", label: "Record Audio", icon: Mic },
    { key: "file", label: "Upload File", icon: Upload },
  ];

  return (
    <>
      <button
        type="button"
        onClick={handleFabClick}
        aria-label="Post to feed"
        className="fixed bottom-44 right-4 md:bottom-28 md:right-8 z-[60] flex items-center justify-center w-14 h-14 rounded-full btn-primary shadow-2xl shadow-melori-purple/40 hover:scale-105 transition"
      >
        <Plus className="w-7 h-7" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm sm:p-4"
          onClick={closeModal}
        >
          <div
            className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-melori-elevated border border-melori-border p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Post to feed</h3>
              <button
                type="button"
                onClick={closeModal}
                aria-label="Close"
                className="p-2 rounded-lg hover:bg-white/5 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mode tabs */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              {tabs.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => switchMode(key)}
                  className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-xs font-medium transition ${
                    mode === key
                      ? "border-melori-purple bg-melori-purple/15 text-white"
                      : "border-melori-border text-melori-muted hover:bg-white/5"
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-center leading-tight">{label}</span>
                </button>
              ))}
            </div>

            {/* Capture / review area */}
            <div className="mb-4">
              {mode === "video" && (
                <div className="relative w-full aspect-[9/16] max-h-[45vh] rounded-xl overflow-hidden bg-melori-void border border-melori-border">
                  {previewUrl ? (
                    <video
                      src={previewUrl}
                      controls
                      playsInline
                      className="h-full w-full object-contain bg-black"
                    />
                  ) : (
                    <video
                      ref={livePreviewRef}
                      muted
                      autoPlay
                      playsInline
                      className="h-full w-full object-cover"
                    />
                  )}
                  {recording && (
                    <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-xs text-white">
                      <Circle className="w-3 h-3 fill-red-500 text-red-500 animate-pulse" />
                      {mmss(elapsed)} / {mmss(MAX_SECONDS.video)}
                    </span>
                  )}
                </div>
              )}

              {mode === "audio" && (
                <div className="w-full rounded-xl bg-melori-void border border-melori-border p-6 flex flex-col items-center gap-3">
                  <div
                    className={`w-20 h-20 rounded-full flex items-center justify-center ${
                      recording
                        ? "bg-red-500/20 animate-pulse"
                        : "bg-melori-purple/20"
                    }`}
                  >
                    <Mic className="w-9 h-9 text-melori-purple" />
                  </div>
                  {recording && (
                    <span className="text-sm text-white">
                      {mmss(elapsed)} / {mmss(MAX_SECONDS.audio)}
                    </span>
                  )}
                  {previewUrl && (
                    <audio src={previewUrl} controls className="w-full mt-2" />
                  )}
                </div>
              )}

              {mode === "file" && (
                <label className="flex flex-col items-center justify-center w-full min-h-[8rem] rounded-xl border border-dashed border-melori-border bg-melori-void px-4 py-6 text-center cursor-pointer hover:border-melori-purple transition">
                  <Upload className="w-7 h-7 text-melori-muted mb-2" />
                  <span className="text-sm text-melori-muted">
                    {pickedFile ? pickedFile.name : "Choose a video or audio file"}
                  </span>
                  <input
                    type="file"
                    accept="video/*,audio/*"
                    className="hidden"
                    onChange={onFileChange}
                  />
                </label>
              )}
            </div>

            {/* Capture controls */}
            {mode !== "file" && (
              <div className="flex justify-center mb-4">
                {!hasClip && !recording && (
                  <button
                    type="button"
                    onClick={startRecording}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-full btn-primary font-semibold text-sm"
                  >
                    <Circle className="w-4 h-4 fill-current" /> Start recording
                  </button>
                )}
                {recording && (
                  <button
                    type="button"
                    onClick={stopRecording}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-red-500 text-white font-semibold text-sm"
                  >
                    <Square className="w-4 h-4 fill-current" /> Stop
                  </button>
                )}
                {hasClip && (
                  <button
                    type="button"
                    onClick={reRecord}
                    className="px-5 py-2.5 rounded-full bg-melori-void/60 border border-melori-border text-sm font-medium hover:bg-white/5 transition"
                  >
                    Re-record
                  </button>
                )}
              </div>
            )}

            {/* Title */}
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder="Add a title…"
              className="w-full bg-melori-void/60 border border-melori-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-melori-purple transition"
            />

            {error && (
              <p className="mt-3 rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
                {error}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeModal}
                disabled={publishing}
                className="px-5 py-2.5 rounded-full bg-melori-void/60 border border-melori-border text-sm font-medium hover:bg-white/5 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={publish}
                disabled={publishing || !hasClip || !title.trim()}
                className="btn-primary px-6 py-2.5 rounded-full font-semibold text-sm disabled:opacity-50"
              >
                {publishing ? "Posting…" : "Post"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
