"use client";

import { useState, useCallback } from "react";

interface UploadState {
  file: File | null;
  title: string;
  artist: string;
  album: string;
  genre: string;
  releaseDate: string;
  coverArt: File | null;
  uploading: boolean;
  progress: number;
}

export default function TrackUploader() {
  const [state, setState] = useState<UploadState>({
    file: null,
    title: "",
    artist: "",
    album: "",
    genre: "",
    releaseDate: "",
    coverArt: null,
    uploading: false,
    progress: 0,
  });
  const [dragActive, setDragActive] = useState(false);
  const [uploadedTrack, setUploadedTrack] = useState<{ id: string; title: string } | null>(null);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = e.dataTransfer.files;
    if (files?.[0]) {
      handleAudioFile(files[0]);
    }
  }, []);

  const handleAudioFile = (file: File) => {
    const validTypes = ["audio/mpeg", "audio/wav", "audio/flac", "audio/x-wav", "audio/x-flac"];
    if (!validTypes.includes(file.type) && !file.name.match(/\.(mp3|wav|flac)$/i)) {
      alert("Please upload an MP3, WAV, or FLAC file.");
      return;
    }

    // Auto-fill title from filename
    const baseName = file.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");
    setState((prev) => ({
      ...prev,
      file,
      title: baseName,
    }));
  };

  const handleUpload = async () => {
    if (!state.file || !state.title) {
      alert("Please select an audio file and enter a title.");
      return;
    }

    setState((prev) => ({ ...prev, uploading: true, progress: 0 }));

    try {
      // 1. Get signed URL for audio upload
      const audioRes = await fetch("/api/studio/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: state.file.name,
          contentType: state.file.type,
          type: "audio",
        }),
      });
      const { signedUrl: audioSignedUrl, publicUrl: audioPublicUrl, path: audioPath } = await audioRes.json();

      // 2. Upload audio to Supabase Storage
      await fetch(audioSignedUrl, {
        method: "PUT",
        body: state.file,
        headers: { "Content-Type": state.file.type },
      });

      setState((prev) => ({ ...prev, progress: 50 }));

      // 3. Upload cover art if provided
      let coverPublicUrl = null;
      if (state.coverArt) {
        const coverRes = await fetch("/api/studio/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: state.coverArt.name,
            contentType: state.coverArt.type,
            type: "cover",
          }),
        });
        const { signedUrl: coverSignedUrl, publicUrl: coverUrl } = await coverRes.json();

        await fetch(coverSignedUrl, {
          method: "PUT",
          body: state.coverArt,
          headers: { "Content-Type": state.coverArt.type },
        });
        coverPublicUrl = coverUrl;
      }

      setState((prev) => ({ ...prev, progress: 75 }));

      // 4. Create track record in Supabase
      const trackRes = await fetch("/api/studio/tracks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: state.title,
          artist: state.artist || "Karl Ray",
          album: state.album || null,
          genre: state.genre || null,
          release_date: state.releaseDate || null,
          file_url: audioPublicUrl,
          file_path: audioPath,
          cover_url: coverPublicUrl,
          type: state.album ? "album_track" : "single",
          status: "draft",
        }),
      });

      const trackData = await trackRes.json();
      setState((prev) => ({ ...prev, progress: 100, uploading: false }));
      setUploadedTrack({ id: trackData.id, title: state.title });

    } catch (err) {
      console.error("Upload failed:", err);
      setState((prev) => ({ ...prev, uploading: false }));
      alert("Upload failed. Please try again.");
    }
  };

  const genres = [
    "Gospel", "R&B", "Hip-Hop", "Electronic", "Soul", "Jazz", "Pop", "Rock", "Classical", "Other"
  ];

  return (
    <div className="max-w-2xl mx-auto">
      {uploadedTrack ? (
        <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-8 text-center">
          <div className="text-4xl mb-3">🎉</div>
          <h3 className="text-xl font-bold text-green-400 mb-2">Upload Complete!</h3>
          <p className="text-[#ccc] mb-4">
            "{uploadedTrack.title}" has been uploaded as a draft.
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => setUploadedTrack(null)}
              className="px-6 py-3 bg-white/5 border border-white/10 rounded-xl font-semibold hover:border-[#c9a96e]/40"
            >
              Upload Another
            </button>
            <a
              href={`/studio?tab=waveform&track=${uploadedTrack.id}`}
              className="px-6 py-3 bg-gradient-to-r from-[#c9a96e] to-[#a08050] text-[#0a0a0a] font-bold rounded-xl"
            >
              Create Preview →
            </a>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Audio Drop Zone */}
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
              accept=".mp3,.wav,.flac,audio/*"
              onChange={(e) => e.target.files?.[0] && handleAudioFile(e.target.files[0])}
              className="hidden"
              id="audio-upload"
            />
            <label htmlFor="audio-upload" className="cursor-pointer block">
              <div className="text-4xl mb-3">{state.file ? "🎵" : "📤"}</div>
              <p className="font-semibold text-lg mb-1">
                {state.file ? state.file.name : "Drop your audio file here"}
              </p>
              <p className="text-sm text-[#888]">
                {state.file
                  ? `${(state.file.size / 1024 / 1024).toFixed(1)} MB`
                  : "MP3, WAV, or FLAC up to 100MB"
                }
              </p>
            </label>
          </div>

          {/* Metadata Form */}
          <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6 space-y-4">
            <h3 className="font-semibold text-[#c9a96e]">Track Details</h3>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-[#888] block mb-1">Title *</label>
                <input
                  type="text"
                  value={state.title}
                  onChange={(e) => setState((p) => ({ ...p, title: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-[#c9a96e]/50"
                  placeholder="Track title"
                />
              </div>
              <div>
                <label className="text-sm text-[#888] block mb-1">Artist</label>
                <input
                  type="text"
                  value={state.artist}
                  onChange={(e) => setState((p) => ({ ...p, artist: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-[#c9a96e]/50"
                  placeholder="Artist name"
                />
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-[#888] block mb-1">Album (optional)</label>
                <input
                  type="text"
                  value={state.album}
                  onChange={(e) => setState((p) => ({ ...p, album: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-[#c9a96e]/50"
                  placeholder="Album name"
                />
              </div>
              <div>
                <label className="text-sm text-[#888] block mb-1">Genre</label>
                <select
                  value={state.genre}
                  onChange={(e) => setState((p) => ({ ...p, genre: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-[#c9a96e]/50"
                >
                  <option value="" className="bg-[#1a1a2e]">Select genre</option>
                  {genres.map((g) => (
                    <option key={g} value={g} className="bg-[#1a1a2e]">{g}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-sm text-[#888] block mb-1">Release Date (optional)</label>
              <input
                type="date"
                value={state.releaseDate}
                onChange={(e) => setState((p) => ({ ...p, releaseDate: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-[#c9a96e]/50"
              />
            </div>

            {/* Cover Art Upload */}
            <div>
              <label className="text-sm text-[#888] block mb-1">Cover Art (optional)</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setState((p) => ({ ...p, coverArt: e.target.files?.[0] || null }))}
                className="w-full text-sm text-[#888] file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-white/5 file:text-white hover:file:bg-white/10"
              />
              {state.coverArt && (
                <p className="text-xs text-green-400 mt-1">✓ {state.coverArt.name}</p>
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
              "Upload Track"
            )}
          </button>
        </div>
      )}
    </div>
  );
}
