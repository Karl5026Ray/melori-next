"use client";

import { useState, useEffect, useCallback, Fragment } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import TrackUploadPanel from "./TrackUploadPanel";
import { validateAudioFile, probeDuration } from "./uploadHelpers";

interface AdminTrack {
  id: number;
  title: string;
  audio_url: string | null;
  duration_seconds: number | null;
  is_published: boolean;
  release_id: number | null;
  release_title: string | null;
  artist_name: string | null;
}

type View = "list" | "upload";

export default function AdminTracksPage() {
  const router = useRouter();
  const [view, setView] = useState<View>("list");
  const [tracks, setTracks] = useState<AdminTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);   const [search, setSearch] = useState("");
  // Which track row has its inline master-upload panel expanded (null = none).
  const [uploadingTrackId, setUploadingTrackId] = useState<number | null>(null);

  // Upload form state
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [releaseId, setReleaseId] = useState("");
  const [publish, setPublish] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragActive, setDragActive] = useState(false);

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
    const msg = validateAudioFile(f);
    if (msg) {
      alert(msg);
      return;
    }
    setFile(f);
    if (!title) {
      setTitle(f.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " "));
    }
  };

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

      const res = await fetch("/api/admin/tracks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          release_id: releaseId || null,
          audio_url: path,
          duration_seconds: duration,
          is_published: publish,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Create failed");
      }
      setProgress(100);
      resetUpload();
      setView("list");
      await loadTracks();
    } catch (err: any) {
      console.error(err);
      alert(err?.message ?? "Upload failed.");
      setUploading(false);
      setProgress(0);
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
    if (
      !confirm(
        `Delete "${track.title}"?\n\nThis permanently removes the track, its audio master, and its preview clip. If it is the only song on its release, the release and its cover art are removed too. This cannot be undone.`,
      )
    )
      return;
    try {
      const res = await fetch(`/api/admin/tracks/${track.id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}) as Record<string, unknown>);
      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "Request failed",
        );
      }
      // Row is gone from every listing — drop it from the UI immediately.
      setTracks((prev) => prev.filter((t) => t.id !== track.id));
      // Surface any storage-cleanup issues so orphaned files can be pruned
      // manually; the DB row is already removed regardless.
      if (Array.isArray(data?.storageErrors) && data.storageErrors.length) {
        alert(
          `Track deleted, but some files could not be removed from storage:\n\n${data.storageErrors.join(
            "\n",
          )}`,
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not delete track.";
      alert(`Could not delete track.\n\n${msg}`);
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
          <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl overflow-hidden"><div className="p-4 border-b border-white/[0.06]"><input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search songs, albums, or artists..." className="w-full px-4 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-sm outline-none focus:border-white/20" /></div>
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
                    <th className="px-5 py-3 font-medium">Length</th>
                    <th className="px-5 py-3 font-medium">Published</th>
                    <th className="px-5 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tracks.filter((t) => { const q = search.trim().toLowerCase(); return !q || t.title.toLowerCase().includes(q) || (t.release_title?.toLowerCase().includes(q) ?? false) || (t.artist_name?.toLowerCase().includes(q) ?? false); }).map((t) => (
                    <Fragment key={t.id}>
                    <tr className="border-b border-white/[0.04]">
                      <td className="px-5 py-3">
                        <div className="font-medium">{t.title}</div>
                        {t.release_title && (
                          <div className="text-xs text-[#666]">{t.release_title}</div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-[#ccc]">{t.artist_name ?? "—"}</td>
                      <td className="px-5 py-3 text-[#ccc]">
                        {fmt(t.duration_seconds)}
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
                            onClick={() =>
                              setUploadingTrackId((cur) =>
                                cur === t.id ? null : t.id,
                              )
                            }
                            className={`px-3 py-1.5 bg-white/5 border rounded-lg text-xs ${
                              uploadingTrackId === t.id
                                ? "border-[#c9a96e]/60 text-[#c9a96e]"
                                : "border-white/10 hover:border-[#c9a96e]/40"
                            }`}
                          >
                            Upload
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
                    {uploadingTrackId === t.id && (
                      <tr className="border-b border-white/[0.04]">
                        <td colSpan={5} className="px-5 pb-5 pt-0">
                          <TrackUploadPanel
                            trackId={t.id}
                            trackTitle={t.title}
                            onClose={() => setUploadingTrackId(null)}
                            onSaved={() => {
                              setUploadingTrackId(null);
                              loadTracks();
                            }}
                          />
                        </td>
                      </tr>
                    )}
                    </Fragment>
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
                : "Upload track →"}
            </button>
          </div>
        )}

      </main>
    </div>
  );
}
