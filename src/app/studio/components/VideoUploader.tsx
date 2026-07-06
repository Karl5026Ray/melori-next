"use client";

import { useState, useCallback } from "react";
import { authFetch } from "@/lib/authClient";
import { putWithProgress, validateVideoFile } from "./uploadHelpers";

interface UploadState {
  file: File | null;
  title: string;
  description: string;
  thumbnail: File | null;
  uploading: boolean;
  progress: number;
}

export default function VideoUploader() {
  const [state, setState] = useState<UploadState>({
    file: null,
    title: "",
    description: "",
    thumbnail: null,
    uploading: false,
    progress: 0,
  });
  const [dragActive, setDragActive] = useState(false);
  const [uploadedVideo, setUploadedVideo] = useState<{ id: string; title: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleVideoFile = (file: File) => {
    const msg = validateVideoFile(file);
    if (msg) {
      setError(msg);
      return;
    }

    // Auto-fill title from filename
    const baseName = file.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");
    setError(null);
    setState((prev) => ({
      ...prev,
      file,
      title: prev.title || baseName,
    }));
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = e.dataTransfer.files;
    if (files?.[0]) {
      handleVideoFile(files[0]);
    }
  }, []);

  const handleUpload = async () => {
    if (!state.file || !state.title) {
      setError("Please select a video file and enter a title.");
      return;
    }

    setError(null);
    setState((prev) => ({ ...prev, uploading: true, progress: 0 }));

    try {
      // 1. Get signed URL for the video upload.
      const videoRes = await authFetch("/api/studio/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: state.file.name,
          contentType: state.file.type,
          type: "video",
        }),
      });
      if (!videoRes.ok) {
        const d = await videoRes.json().catch(() => ({}));
        throw new Error(d.error ?? "Could not get an upload URL.");
      }
      const { signedUrl: videoSignedUrl, publicUrl: videoPublicUrl } = await videoRes.json();

      // 2. Upload the video straight to Supabase Storage with real progress.
      await putWithProgress(videoSignedUrl, state.file, (pct) =>
        setState((prev) => ({ ...prev, progress: pct })),
      );

      // 3. Upload an optional thumbnail image (reuses the cover branch).
      let thumbnailPublicUrl: string | null = null;
      if (state.thumbnail) {
        const thumbRes = await authFetch("/api/studio/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: state.thumbnail.name,
            contentType: state.thumbnail.type,
            type: "cover",
          }),
        });
        if (!thumbRes.ok) {
          const d = await thumbRes.json().catch(() => ({}));
          throw new Error(d.error ?? "Could not get a thumbnail upload URL.");
        }
        const { signedUrl: thumbSignedUrl, publicUrl: thumbUrl } = await thumbRes.json();

        await putWithProgress(thumbSignedUrl, state.thumbnail, () => {});
        thumbnailPublicUrl = thumbUrl;
      }

      // 4. Persist the video row.
      const saveRes = await authFetch("/api/social/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: state.title,
          description: state.description || null,
          video_url: videoPublicUrl,
          thumbnail_url: thumbnailPublicUrl,
        }),
      });
      if (!saveRes.ok) {
        const d = await saveRes.json().catch(() => ({}));
        throw new Error(d.error ?? "Could not save the video.");
      }

      const videoData = await saveRes.json();
      setState((prev) => ({ ...prev, progress: 100, uploading: false }));
      setUploadedVideo({ id: videoData.id, title: state.title });
    } catch (err: any) {
      console.error("Video upload failed:", err);
      setState((prev) => ({ ...prev, uploading: false }));
      setError(err?.message ?? "Upload failed. Please try again.");
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      {uploadedVideo ? (
        <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-8 text-center">
          <div className="text-4xl mb-3">🎬</div>
          <h3 className="text-xl font-bold text-green-400 mb-2">Upload Complete!</h3>
          <p className="text-[#ccc] mb-4">
            "{uploadedVideo.title}" has been published to your video feed.
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => {
                setUploadedVideo(null);
                setState({
                  file: null,
                  title: "",
                  description: "",
                  thumbnail: null,
                  uploading: false,
                  progress: 0,
                });
              }}
              className="px-6 py-3 bg-white/5 border border-white/10 rounded-xl font-semibold hover:border-[#c9a96e]/40"
            >
              Upload Another
            </button>
            <a
              href="/social/video"
              className="px-6 py-3 bg-gradient-to-r from-[#c9a96e] to-[#a08050] text-[#0a0a0a] font-bold rounded-xl"
            >
              View Feed →
            </a>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {error && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Video Drop Zone */}
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-2xl p-10 text-center transition-all cursor-pointer
              ${dragActive
                ? "border-[#c9a96e] bg-[#c9a96e]/5"
                : state.file
                  ? "border-green-500/50 bg-green-500/5"
                  : "border-white/10 hover:border-white/20"
              }`}
          >
            <input
              type="file"
              accept="video/*"
              onChange={(e) => e.target.files?.[0] && handleVideoFile(e.target.files[0])}
              className="hidden"
              id="video-upload"
            />
            <label htmlFor="video-upload" className="cursor-pointer block">
              <div className="text-4xl mb-3">{state.file ? "🎬" : "📤"}</div>
              <p className="font-semibold text-lg mb-1">
                {state.file ? state.file.name : "Drop your video file here"}
              </p>
              <p className="text-sm text-[#888]">
                {state.file
                  ? `${(state.file.size / 1024 / 1024).toFixed(1)} MB`
                  : "MP4, MOV, WEBM, or MKV up to 500MB"
                }
              </p>
            </label>
          </div>

          {/* Metadata Form */}
          <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6 space-y-4">
            <h3 className="font-semibold text-[#c9a96e]">Video Details</h3>

            <div>
              <label className="text-sm text-[#888] block mb-1">Title *</label>
              <input
                type="text"
                value={state.title}
                onChange={(e) => setState((p) => ({ ...p, title: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-[#c9a96e]/50"
                placeholder="Video title"
              />
            </div>

            <div>
              <label className="text-sm text-[#888] block mb-1">Description (optional)</label>
              <textarea
                value={state.description}
                onChange={(e) => setState((p) => ({ ...p, description: e.target.value }))}
                rows={3}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-[#c9a96e]/50 resize-y"
                placeholder="Tell fans about this video"
              />
            </div>

            {/* Thumbnail Upload */}
            <div>
              <label className="text-sm text-[#888] block mb-1">Thumbnail (optional)</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setState((p) => ({ ...p, thumbnail: e.target.files?.[0] || null }))}
                className="w-full text-sm text-[#888] file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-white/5 file:text-white hover:file:bg-white/10"
              />
              {state.thumbnail && (
                <p className="text-xs text-green-400 mt-1">✓ {state.thumbnail.name}</p>
              )}
            </div>
          </div>

          {/* Upload Button */}
          <button
            onClick={handleUpload}
            disabled={state.uploading || !state.file || !state.title}
            className="w-full py-4 bg-gradient-to-r from-[#c9a96e] to-[#a08050] text-[#0a0a0a] font-bold text-lg rounded-xl transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_30px_rgba(201,169,110,0.3)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {state.uploading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-5 h-5 border-2 border-[#0a0a0a]/30 border-t-[#0a0a0a] rounded-full animate-spin" />
                Uploading... {state.progress}%
              </span>
            ) : (
              "Upload Video"
            )}
          </button>
        </div>
      )}
    </div>
  );
}
