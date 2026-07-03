"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SampleEditor from "./SampleEditor";

interface AdminTrack {
  id: number;
  title: string;
  audio_url: string | null;
  preview_start: number;
  preview_end: number;
  duration_seconds: number | null;
  price: number | null;
  is_published: boolean;
  release_id: number | null;
  release_title: string | null;
  artist_name: string | null;
}

type View = "list" | "upload" | "sample";

// Draft for a new upload that is waiting for its sample window to be set.
interface UploadDraft {
  title: string;
  releaseId: string;
  publish: boolean;
  audioPath: string; // storage path saved into tracks.audio_url
  audioSignedUrl: string; // playable URL for the editor
  duration: number | null;
}

const AUDIO_TYPES = [
  "audio/mpeg",
  "audio/wav",
  "audio/flac",
  "audio/x-wav",
  "audio/x-flac",
];

export default function AdminTracksPage() {
  const router = useRouter();
  const [view, setView] = useState<View>("list");
  const [tracks, setTracks] = useState<AdminTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Upload form state
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [releaseId, setReleaseId] = useState("");
  const [publish, setPublish] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragActive, setDragActive] = useState(false);

  // Sample editor state (used for both new uploads and editing existing tracks)
  const [draft, setDraft] = useState<UploadDraft | null>(null);
  const [editing, setEditing] = useState<AdminTrack | null>(null);
  const [editUrl, setEditUrl] = useState<string | null>(null);
  const [savingSample, setSavingSample] = useState(false);

  const savingDraftRef = useRef(false);

  const loadTracks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/tracks", { cache: "no-store" });
      if (res.status === 401) {
        router.push("/admin");
        return;
      }
      const data = await res.json();
      setTracks(data.tracks ?? []);
      setError(null);
    } catch {
      setError("Failed to load tracks.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadTracks();
  }, [loadTracks]);

  const resetUpload = () => {
    setFile(null);
    setTitle("");
    setReleaseId("");
    setPublish(false);
    setProgress(0);
    setUploading(false);
  };

  const pickFile = (f: File) => {
    if (!AUDIO_TYPES.includes(f.type) && !f.name.match(/\.(mp3|wav|flac)$/i)) {
      alert("Please upload an MP3, WAV, or FLAC file.");
      return;
    }
    if (f.size > 100 * 1024 * 1024) {
      alert("File exceeds the 100MB limit.");
      return;
    }
    setFile(f);
    if (!title) {
      setTitle(f.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " "));
    }
  };

  const probeDuration = (f: File): Promise<number | null> =>
    new Promise((resolve) => {
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

  const startUpload = async () => {
    if (!file || !title.trim()) {
      alert("Select an audio file and enter a title.");
      return;
    }
    setUploading(true);
    setProgress(10);
    try {
      const urlRes = await fetch("/api/admin/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, type: "audio" }),
      });
      if (!urlRes.ok) throw new Error("Could not get upload URL");
      const { signedUrl, path } = await urlRes.json();

      setProgress(30);
      const putRes = await fetch(signedUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      if (!putRes.ok) throw new Error("Upload failed");

      setProgress(70);
      const duration = await probeDuration(file);

      // Get a signed read URL so the sample editor can decode the audio.
      const signRes = await fetch("/api/admin/sign-download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, bucket: "audio-files" }),
      });
      const { url: audioSignedUrl } = await signRes.json();

      setProgress(100);
      setDraft({
        title: title.trim(),
        releaseId,
        publish,
        audioPath: path,
        audioSignedUrl,
        duration,
      });
      setView("sample");
    } catch (err: any) {
      console.error(err);
      alert(err?.message ?? "Upload failed.");
      setUploading(false);
      setProgress(0);
    }
  };

  const saveNewTrack = async (start: number, end: number) => {
    if (!draft || savingDraftRef.current) return;
    savingDraftRef.current = true;
    setSavingSample(true);
    try {
      const res = await fetch("/api/admin/tracks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title,
          release_id: draft.releaseId || null,
          audio_url: draft.audioPath,
          duration_seconds: draft.duration,
          preview_start: start,
          preview_end: end,
          is_published: draft.publish,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Create failed");
      }
      setDraft(null);
      resetUpload();
      setView("list");
      await loadTracks();
    } catch (err: any) {
      alert(err?.message ?? "Could not save track.");
    } finally {
      savingDraftRef.current = false;
      setSavingSample(false);
    }
  };

  const openSampleEditor = async (track: AdminTrack) => {
    if (!track.audio_url) {
      alert("This track has no audio file to edit.");
      return;
    }
    setEditing(track);
    setEditUrl(null);
    setView("sample");
    try {
      const res = await fetch("/api/admin/sign-download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: track.audio_url, bucket: "audio-files" }),
      });
      const { url } = await res.json();
      setEditUrl(url);
    } catch {
      alert("Could not load audio for editing.");
      setView("list");
      setEditing(null);
    }
  };

  const saveExistingSample = async (start: number, end: number) => {
    if (!editing) return;
    setSavingSample(true);
    try {
      const res = await fetch(`/api/admin/tracks/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preview_start: start, preview_end: end }),
      });
      if (!res.ok) throw new Error("Save failed");
      setEditing(null);
      setEditUrl(null);
      setView("list");
      await loadTracks();
    } catch {
      alert("Could not save sample window.");
    } finally {
      setSavingSample(false);
    }
  };

  const togglePublish = async (track: AdminTrack) => {
    setTracks((prev) =>
      prev.map((t) =>
        t.id === track.id ? { ...t, is_published: !t.is_published } : t,
      ),
    );
    try {
      const res = await fetch(`/api/admin/tracks/${track.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_published: !track.is_published }),
      });
      if (!res.ok) throw new Error();
    } catch {
      // revert on failure
      setTracks((prev) =>
        prev.map((t) =>
          t.id === track.id ? { ...t, is_published: track.is_published } : t,
        ),
      );
      alert("Could not update publish state.");
    }
  };

  const deleteTrack = async (track: AdminTrack) => {
    if (!confirm(`Delete "${track.title}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/admin/tracks/${track.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      setTracks((prev) => prev.filter((t) => t.id !== track.id));
    } catch {
      alert("Could not delete track.");
    }
  };

  const fmt = (s: number | null) => {
    if (s == null) return "—";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <header className="border-b border-white/[0.06] px-6 md:px-10 py-5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/admin/dashboard" className="text-sm text-[#888] hover:text-[#c9a96e]">
            ← Dashboard
          </Link>
          <h1 className="text-xl font-bold">Music Manager</h1>
        </div>
        {view === "list" && (
          <button
            onClick={() => {
              resetUpload();
              setView("upload");
            }}
            className="px-5 py-2.5 bg-gradient-to-r from-[#c9a96e] to-[#a08050] text-[#0a0a0a] font-bold rounded-xl"
          >
            + Upload track
          </button>
        )}
      </header>

      <main className="p-6 md:p-10 max-w-6xl mx-auto">
        {view === "list" && (
          <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl overflow-hidden">
            {loading ? (
              <div className="p-10 text-center text-[#888]">Loading tracks…</div>
            ) : error ? (
              <div className="p-10 text-center text-red-400">{error}</div>
            ) : tracks.length === 0 ? (
              <div className="p-10 text-center text-[#888]">
                No tracks yet. Click “Upload track” to add one.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[#888] border-b border-white/[0.06]">
                    <th className="px-5 py-3 font-medium">Title</th>
                    <th className="px-5 py-3 font-medium">Artist</th>
                    <th className="px-5 py-3 font-medium">Sample</th>
                    <th className="px-5 py-3 font-medium">Published</th>
                    <th className="px-5 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tracks.map((t) => (
                    <tr key={t.id} className="border-b border-white/[0.04]">
                      <td className="px-5 py-3">
                        <div className="font-medium">{t.title}</div>
                        {t.release_title && (
                          <div className="text-xs text-[#666]">{t.release_title}</div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-[#ccc]">{t.artist_name ?? "—"}</td>
                      <td className="px-5 py-3 text-[#ccc]">
                        {fmt(t.preview_start)} – {fmt(t.preview_end)}
                      </td>
                      <td className="px-5 py-3">
                        <button
                          onClick={() => togglePublish(t)}
                          className={`px-3 py-1 rounded-full text-xs font-semibold ${
                            t.is_published
                              ? "bg-green-500/15 text-green-400"
                              : "bg-white/10 text-[#888]"
                          }`}
                        >
                          {t.is_published ? "Published" : "Draft"}
                        </button>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => openSampleEditor(t)}
                            className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs hover:border-[#c9a96e]/40"
                          >
                            Edit sample
                          </button>
                          <button
                            onClick={() => deleteTrack(t)}
                            className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-red-400 hover:border-red-400/40"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {view === "upload" && (
          <div className="max-w-2xl mx-auto space-y-6">
            <button
              onClick={() => {
                resetUpload();
                setView("list");
              }}
              className="text-sm text-[#888] hover:text-[#c9a96e]"
            >
              ← Back to tracks
            </button>

            <div
              onDragEnter={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragActive(false);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                if (e.dataTransfer.files?.[0]) pickFile(e.dataTransfer.files[0]);
              }}
              className={`border-2 border-dashed rounded-2xl p-10 text-center transition-all ${
                dragActive
                  ? "border-[#c9a96e] bg-[#c9a96e]/5"
                  : file
                    ? "border-green-500/50 bg-green-500/5"
                    : "border-white/10 hover:border-white/20"
              }`}
            >
              <input
                type="file"
                accept=".mp3,.wav,.flac,audio/*"
                onChange={(e) => e.target.files?.[0] && pickFile(e.target.files[0])}
                className="hidden"
                id="admin-audio-upload"
              />
              <label htmlFor="admin-audio-upload" className="cursor-pointer block">
                <div className="text-4xl mb-3">{file ? "🎵" : "📤"}</div>
                <p className="font-semibold text-lg mb-1">
                  {file ? file.name : "Drop your audio file here"}
                </p>
                <p className="text-sm text-[#888]">
                  {file
                    ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
                    : "MP3, WAV, or FLAC up to 100MB"}
                </p>
              </label>
            </div>

            <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6 space-y-4">
              <div>
                <label className="text-sm text-[#888] block mb-1">Title *</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-[#c9a96e]/50"
                  placeholder="Track title"
                />
              </div>
              <div>
                <label className="text-sm text-[#888] block mb-1">
                  Release ID (optional)
                </label>
                <input
                  value={releaseId}
                  onChange={(e) => setReleaseId(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-[#c9a96e]/50"
                  placeholder="Link to a release (numeric id)"
                  inputMode="numeric"
                />
              </div>
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={publish}
                  onChange={(e) => setPublish(e.target.checked)}
                  className="accent-[#c9a96e] w-4 h-4"
                />
                Publish immediately
              </label>
            </div>

            <button
              onClick={startUpload}
              disabled={uploading || !file || !title.trim()}
              className="w-full py-4 bg-gradient-to-r from-[#c9a96e] to-[#a08050] text-[#0a0a0a] font-bold text-lg rounded-xl disabled:opacity-50"
            >
              {uploading
                ? `Uploading… ${progress}%`
                : "Upload & set 30-sec sample →"}
            </button>
          </div>
        )}

        {view === "sample" && (
          <div className="max-w-4xl mx-auto space-y-5">
            <div>
              <button
                onClick={() => {
                  setDraft(null);
                  setEditing(null);
                  setEditUrl(null);
                  resetUpload();
                  setView("list");
                }}
                className="text-sm text-[#888] hover:text-[#c9a96e]"
              >
                ← Back to tracks
              </button>
              <h2 className="text-2xl font-bold mt-2">
                {editing ? editing.title : draft?.title}
              </h2>
              <p className="text-[#888] text-sm">
                Drag the fixed 30-second window to choose what free listeners hear.
              </p>
            </div>

            {draft ? (
              <SampleEditor
                audioUrl={draft.audioSignedUrl}
                initialStart={0}
                saving={savingSample}
                onSave={saveNewTrack}
                onCancel={() => {
                  setDraft(null);
                  resetUpload();
                  setView("list");
                }}
              />
            ) : editing && editUrl ? (
              <SampleEditor
                audioUrl={editUrl}
                initialStart={editing.preview_start ?? 0}
                saving={savingSample}
                onSave={saveExistingSample}
                onCancel={() => {
                  setEditing(null);
                  setEditUrl(null);
                  setView("list");
                }}
              />
            ) : (
              <div className="text-center py-16 text-[#888]">Loading audio…</div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
