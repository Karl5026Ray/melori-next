"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Video, Upload, Circle, Square, AlertTriangle } from "lucide-react";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { authFetch } from "@/lib/authClient";

// Mirror-specific uploader: VIDEO ONLY, vertical-first. Mirror is a
// TikTok-style vertical video feed, so unlike the general "Post to feed"
// button this one drops the audio mode, frames capture/preview in 9:16, and
// WARNS (but still allows) when a clip is not portrait. It reuses the same
// upload pipeline: POST /api/social/upload-url (signed PUT URL) → PUT the blob
// → POST /api/social/videos to persist the row.

type Mode = "record" | "file";

const MAX_SECONDS = 60;

function pickVideoMime(): string {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

// Reads intrinsic width/height of a video blob/file so we can flag landscape
// clips. Resolves null if the browser can't read metadata.
function readVideoAspect(
  src: string,
): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      resolve(
        v.videoWidth && v.videoHeight
          ? { w: v.videoWidth, h: v.videoHeight }
          : null,
      );
    };
    v.onerror = () => resolve(null);
    v.src = src;
  });
}

export default function MirrorUploadButton() {
  const { user } = useAuth();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("record");
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aspectWarning, setAspectWarning] = useState(false);

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
    setAspectWarning(false);
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
    setDescription("");
    setOpen(false);
  }, [cleanup]);

  useEffect(() => cleanup, [cleanup]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closeModal]);

  // Live camera preview for record mode. Prefer the front camera in portrait.
  const startLivePreview = useCallback(async () => {
    stopStream();
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", aspectRatio: 9 / 16 },
        audio: true,
      });
      streamRef.current = stream;
      if (livePreviewRef.current) {
        livePreviewRef.current.srcObject = stream;
        livePreviewRef.current.play().catch(() => {});
      }
    } catch {
      setError(
        "Camera/mic blocked. Grant permission or use Upload File instead.",
      );
    }
  }, [stopStream]);

  const switchMode = useCallback(
    (m: Mode) => {
      resetCapture();
      setMode(m);
      if (m === "record") void startLivePreview();
      else stopStream();
    },
    [resetCapture, startLivePreview, stopStream],
  );

  // After we have a clip, check its aspect ratio and warn if it's landscape.
  const flagAspect = useCallback(async (src: string) => {
    const dims = await readVideoAspect(src);
    setAspectWarning(!!dims && dims.w > dims.h);
  }, []);

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) {
      void startLivePreview();
      return;
    }
    const mimeType = pickVideoMime();
    chunksRef.current = [];
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      setError("Recording is not supported in this browser.");
      return;
    }
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, {
        type: mimeType || "video/webm",
      });
      setRecordedBlob(blob);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      void flagAspect(url);
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
        if (next >= MAX_SECONDS) stopRecording();
        return next;
      });
    }, 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startLivePreview, clearTimer, stopStream, flagAspect]);

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
    void startLivePreview();
  }, [resetCapture, startLivePreview]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setError(null);
    setAspectWarning(false);
    if (file && !file.type.startsWith("video/")) {
      setPickedFile(null);
      setPreviewUrl(null);
      setError("Mirror is for video only — choose a video file.");
      return;
    }
    setPickedFile(file);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      if (!file) return null;
      const url = URL.createObjectURL(file);
      void flagAspect(url);
      return url;
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
      setError("Record or choose a video first.");
      return;
    }

    const ext =
      source instanceof File && source.name.includes(".")
        ? source.name.split(".").pop()
        : "webm";
    const filename =
      source instanceof File ? source.name : `mirror-${Date.now()}.${ext}`;
    const contentType = source.type || "video/webm";

    setPublishing(true);
    setError(null);
    try {
      const urlRes = await authFetch("/api/social/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, type: "video" }),
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

      const saveRes = await authFetch("/api/social/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: trimmed,
          description: description.trim() || undefined,
          video_url: publicUrl,
          media_type: "video",
        }),
      });
      if (!saveRes.ok) {
        const d = await saveRes.json().catch(() => ({}));
        throw new Error(d.error ?? "Could not publish your video.");
      }

      closeModal();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPublishing(false);
    }
  }, [title, description, mode, pickedFile, recordedBlob, closeModal, router]);

  const handleFabClick = () => {
    if (!user) {
      router.push("/social/auth");
      return;
    }
    setOpen(true);
    setMode("record");
    void startLivePreview();
  };

  if (!user) return null;

  const mmss = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const hasClip = mode === "file" ? !!pickedFile : !!recordedBlob;

  return (
    <>
      <button
        type="button"
        onClick={handleFabClick}
        aria-label="Post a Mirror video"
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
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-lg font-bold">Post a Mirror video</h3>
              <button
                type="button"
                onClick={closeModal}
                aria-label="Close"
                className="p-2 rounded-lg hover:bg-white/5 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-melori-muted mb-4">
              Mirror is a vertical video feed — record or upload a portrait
              (9:16) clip up to 60s.
            </p>

            {/* Mode tabs — video only */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              {(
                [
                  { key: "record" as Mode, label: "Record Video", icon: Video },
                  { key: "file" as Mode, label: "Upload Video", icon: Upload },
                ]
              ).map(({ key, label, icon: Icon }) => (
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

            {/* Capture / review area — always a 9:16 frame */}
            <div className="mb-4">
              <div className="relative mx-auto w-full max-w-[13rem] aspect-[9/16] rounded-xl overflow-hidden bg-melori-void border border-melori-border">
                {previewUrl ? (
                  <video
                    src={previewUrl}
                    controls
                    playsInline
                    className="h-full w-full object-contain bg-black"
                  />
                ) : mode === "record" ? (
                  <video
                    ref={livePreviewRef}
                    muted
                    autoPlay
                    playsInline
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <label className="flex h-full w-full flex-col items-center justify-center px-4 text-center cursor-pointer hover:bg-white/5 transition">
                    <Upload className="w-7 h-7 text-melori-muted mb-2" />
                    <span className="text-sm text-melori-muted">
                      {pickedFile ? pickedFile.name : "Choose a video file"}
                    </span>
                    <input
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={onFileChange}
                    />
                  </label>
                )}
                {recording && (
                  <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-xs text-white">
                    <Circle className="w-3 h-3 fill-red-500 text-red-500 animate-pulse" />
                    {mmss(elapsed)} / {mmss(MAX_SECONDS)}
                  </span>
                )}
              </div>
            </div>

            {/* Aspect warning — warn but allow */}
            {aspectWarning && (
              <p className="mb-4 flex items-start gap-2 rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-300">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                This clip looks landscape. Mirror is a vertical feed — it&apos;ll
                still post, but a portrait (9:16) video looks best.
              </p>
            )}

            {/* Capture controls (record mode only) */}
            {mode === "record" && (
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

            {/* Title + description */}
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder="Add a title…"
              className="w-full bg-melori-void/60 border border-melori-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-melori-purple transition"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={300}
              rows={2}
              placeholder="Add a description (optional)…"
              className="mt-3 w-full resize-none bg-melori-void/60 border border-melori-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-melori-purple transition"
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
                {publishing ? "Posting…" : "Post to Mirror"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
