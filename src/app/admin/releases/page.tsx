"use client";

import { useState, useEffect, useCallback, Fragment, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface AdminReleaseTrack {
  id: number;
  title: string;
  track_number: number | null;
  is_published: boolean;
  duration_seconds: number | null;
}

interface AdminRelease {
  id: number;
  title: string;
  slug: string;
  release_type: string;
  cover_art_url: string | null;
  price: number | null;
  is_published: boolean;
  artist_name: string | null;
  track_count: number;
  tracks: AdminReleaseTrack[];
}

export default function AdminReleasesPage() {
  const router = useRouter();
  const [releases, setReleases] = useState<AdminRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  // Which release is being edited inline, and the working copy of its fields.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Partial<AdminRelease>>({});
  // Which track is being renamed, and its working title.
  const [editingTrackId, setEditingTrackId] = useState<number | null>(null);
  const [trackDraft, setTrackDraft] = useState("");
  const [uploadingCover, setUploadingCover] = useState<number | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const coverTargetRef = useRef<number | null>(null);

  const loadReleases = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/releases", { cache: "no-store" });
      if (res.status === 401) {
        router.push("/admin");
        return;
      }
      const data = await res.json();
      setReleases(data.releases ?? []);
      setError(null);
    } catch {
      setError("Failed to load releases.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadReleases();
  }, [loadReleases]);

  // Generic PATCH to a release; merges the returned fields into local state.
  const patchRelease = async (id: number, patch: Record<string, unknown>) => {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/releases/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}) as Record<string, unknown>);
      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "Request failed",
        );
      }
      setReleases((prev) =>
        prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      );
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not save changes.";
      alert(`Could not save changes.\n\n${msg}`);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const startEdit = (r: AdminRelease) => {
    setEditingId(r.id);
    setDraft({
      title: r.title,
      slug: r.slug,
      release_type: r.release_type,
      price: r.price,
    });
  };

  const saveEdit = async (id: number) => {
    const patch: Record<string, unknown> = {};
    if (typeof draft.title === "string") patch.title = draft.title;
    if (typeof draft.slug === "string") patch.slug = draft.slug;
    if (typeof draft.release_type === "string")
      patch.release_type = draft.release_type;
    patch.price = draft.price === undefined ? null : draft.price;
    const ok = await patchRelease(id, patch);
    if (ok) {
      setEditingId(null);
      setDraft({});
    }
  };

  // Rename a single track via the tracks PATCH endpoint.
  const saveTrackTitle = async (releaseId: number, trackId: number) => {
    const title = trackDraft.trim();
    if (!title) return;
    setBusy(trackId);
    try {
      const res = await fetch(`/api/admin/tracks/${trackId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const data = await res.json().catch(() => ({}) as Record<string, unknown>);
      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "Request failed",
        );
      }
      setReleases((prev) =>
        prev.map((r) =>
          r.id === releaseId
            ? {
                ...r,
                tracks: r.tracks.map((t) =>
                  t.id === trackId ? { ...t, title } : t,
                ),
              }
            : r,
        ),
      );
      setEditingTrackId(null);
      setTrackDraft("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not rename track.";
      alert(`Could not rename track.\n\n${msg}`);
    } finally {
      setBusy(null);
    }
  };

  // Swap two adjacent tracks' track_number values to move a song up or down.
  const reorderTrack = async (
    releaseId: number,
    index: number,
    direction: -1 | 1,
  ) => {
    const release = releases.find((r) => r.id === releaseId);
    if (!release) return;
    const target = index + direction;
    if (target < 0 || target >= release.tracks.length) return;
    const a = release.tracks[index];
    const b = release.tracks[target];
    // Positions are 1-based and derived from array order so they stay contiguous
    // even if the stored track_numbers had gaps.
    const aNum = index + 1;
    const bNum = target + 1;
    setBusy(a.id);
    try {
      const r1 = await fetch(`/api/admin/tracks/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track_number: bNum }),
      });
      if (!r1.ok) throw new Error("Failed to move track");
      const r2 = await fetch(`/api/admin/tracks/${b.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track_number: aNum }),
      });
      if (!r2.ok) throw new Error("Failed to move track");
      setReleases((prev) =>
        prev.map((r) => {
          if (r.id !== releaseId) return r;
          const tracks = [...r.tracks];
          tracks[index] = { ...b, track_number: aNum };
          tracks[target] = { ...a, track_number: bNum };
          return { ...r, tracks };
        }),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not reorder.";
      alert(`Could not reorder track.\n\n${msg}`);
      loadReleases();
    } finally {
      setBusy(null);
    }
  };

  // Cover art upload: request a signed URL, PUT the file to the covers bucket,
  // then persist the returned public URL onto the release.
  const onCoverPicked = async (file: File) => {
    const releaseId = coverTargetRef.current;
    if (releaseId == null) return;
    setUploadingCover(releaseId);
    try {
      const signRes = await fetch("/api/admin/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, type: "cover" }),
      });
      const signData = await signRes.json();
      if (!signRes.ok || !signData?.signedUrl) {
        throw new Error(signData?.error ?? "Could not get upload URL");
      }
      const putRes = await fetch(signData.signedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!putRes.ok) throw new Error("Upload failed");
      await patchRelease(releaseId, { cover_art_url: signData.publicUrl });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Cover upload failed.";
      alert(`Could not upload cover art.\n\n${msg}`);
    } finally {
      setUploadingCover(null);
      coverTargetRef.current = null;
      if (coverInputRef.current) coverInputRef.current.value = "";
    }
  };

  const pickCover = (releaseId: number) => {
    coverTargetRef.current = releaseId;
    coverInputRef.current?.click();
  };

  const deleteRelease = async (r: AdminRelease) => {
    if (
      !confirm(
        `Delete "${r.title}"?\n\nThis permanently removes the release and all ${r.track_count} of its tracks (and any comments). This cannot be undone.`,
      )
    )
      return;
    setBusy(r.id);
    try {
      const res = await fetch(`/api/admin/releases/${r.id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}) as Record<string, unknown>);
      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "Request failed",
        );
      }
      setReleases((prev) => prev.filter((x) => x.id !== r.id));
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Could not delete release.";
      alert(`Could not delete release.\n\n${msg}`);
    } finally {
      setBusy(null);
    }
  };

  const deleteTrack = async (releaseId: number, track: AdminReleaseTrack) => {
    if (
      !confirm(
        `Delete track "${track.title}"?\n\nThis permanently removes the track. This cannot be undone.`,
      )
    )
      return;
    setBusy(track.id);
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
      if (data?.removedRelease) {
        await loadReleases();
      } else {
        setReleases((prev) =>
          prev.map((r) =>
            r.id === releaseId
              ? {
                  ...r,
                  tracks: r.tracks.filter((t) => t.id !== track.id),
                  track_count: Math.max(0, r.track_count - 1),
                }
              : r,
          ),
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not delete track.";
      alert(`Could not delete track.\n\n${msg}`);
    } finally {
      setBusy(null);
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
      <input
        ref={coverInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onCoverPicked(f);
        }}
      />
      <header className="border-b border-white/[0.06] px-6 md:px-10 py-5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/admin/dashboard"
            className="text-sm text-[#888] hover:text-[#c9a96e]"
          >
            ← Dashboard
          </Link>
          <h1 className="text-xl font-bold">Release Manager</h1>
        </div>
        <button
          onClick={loadReleases}
          className="px-4 py-2 rounded-lg bg-[#c9a96e]/15 text-[#c9a96e] text-sm font-medium hover:bg-[#c9a96e]/25"
        >
          Refresh
        </button>
      </header>
      <main className="p-6 md:p-10 max-w-5xl mx-auto">
        <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl overflow-hidden">
          {loading ? (
            <div className="p-10 text-center text-[#888]">Loading releases…</div>
          ) : error ? (
            <div className="p-10 text-center text-red-400">{error}</div>
          ) : releases.length === 0 ? (
            <div className="p-10 text-center text-[#888]">No releases yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[#888] border-b border-white/[0.06]">
                  <th className="px-5 py-3 font-medium">Release</th>
                  <th className="px-5 py-3 font-medium">Artist</th>
                  <th className="px-5 py-3 font-medium">Tracks</th>
                  <th className="px-5 py-3 font-medium">Published</th>
                  <th className="px-5 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {releases.map((r) => (
                  <Fragment key={r.id}>
                    <tr className="border-b border-white/[0.04]">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => pickCover(r.id)}
                            disabled={uploadingCover === r.id}
                            title="Upload new cover art"
                            className="relative w-10 h-10 rounded-lg overflow-hidden bg-white/10 shrink-0"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={r.cover_art_url || "/logo/logo.png"}
                              alt=""
                              className="w-10 h-10 object-cover"
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).style.visibility =
                                  "hidden";
                              }}
                            />
                            <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 hover:opacity-100 text-[10px]">
                              {uploadingCover === r.id ? "…" : "Edit"}
                            </span>
                          </button>
                          {editingId === r.id ? (
                            <div className="flex flex-col gap-1">
                              <input
                                value={draft.title ?? ""}
                                onChange={(e) =>
                                  setDraft((d) => ({ ...d, title: e.target.value }))
                                }
                                placeholder="Title"
                                className="px-2 py-1 rounded bg-black/40 border border-white/10 text-sm"
                              />
                              <input
                                value={draft.slug ?? ""}
                                onChange={(e) =>
                                  setDraft((d) => ({ ...d, slug: e.target.value }))
                                }
                                placeholder="slug"
                                className="px-2 py-1 rounded bg-black/40 border border-white/10 text-xs"
                              />
                              <div className="flex gap-1">
                                <select
                                  value={draft.release_type ?? "single"}
                                  onChange={(e) =>
                                    setDraft((d) => ({
                                      ...d,
                                      release_type: e.target.value,
                                    }))
                                  }
                                  className="px-2 py-1 rounded bg-black/40 border border-white/10 text-xs"
                                >
                                  <option value="single">single</option>
                                  <option value="album">album</option>
                                  <option value="ep">ep</option>
                                </select>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={draft.price ?? ""}
                                  onChange={(e) =>
                                    setDraft((d) => ({
                                      ...d,
                                      price:
                                        e.target.value === ""
                                          ? null
                                          : Number(e.target.value),
                                    }))
                                  }
                                  placeholder="price"
                                  className="w-20 px-2 py-1 rounded bg-black/40 border border-white/10 text-xs"
                                />
                              </div>
                            </div>
                          ) : (
                            <div>
                              <div className="font-medium">{r.title}</div>
                              <div className="text-xs text-[#666] uppercase">
                                {r.release_type}
                                {r.price != null ? ` · $${r.price}` : ""}
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-[#ccc]">
                        {r.artist_name ?? "—"}
                      </td>
                      <td className="px-5 py-3">
                        <button
                          onClick={() =>
                            setExpanded((cur) => (cur === r.id ? null : r.id))
                          }
                          className="px-3 py-1 rounded-lg bg-white/5 border border-white/10 text-xs hover:border-[#c9a96e]/40"
                        >
                          {r.track_count} track{r.track_count === 1 ? "" : "s"}{" "}
                          {expanded === r.id ? "▲" : "▼"}
                        </button>
                      </td>
                      <td className="px-5 py-3">
                        <button
                          onClick={() =>
                            patchRelease(r.id, { is_published: !r.is_published })
                          }
                          disabled={busy === r.id}
                          className={`px-3 py-1 rounded-full text-xs font-semibold ${
                            r.is_published
                              ? "bg-green-500/15 text-green-400"
                              : "bg-white/10 text-[#888]"
                          } disabled:opacity-50`}
                        >
                          {r.is_published ? "Published" : "Draft"}
                        </button>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex gap-2 justify-end">
                          {editingId === r.id ? (
                            <>
                              <button
                                onClick={() => saveEdit(r.id)}
                                disabled={busy === r.id}
                                className="px-3 py-1.5 bg-[#c9a96e]/15 border border-[#c9a96e]/30 rounded-lg text-xs text-[#c9a96e] disabled:opacity-50"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => {
                                  setEditingId(null);
                                  setDraft({});
                                }}
                                className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => startEdit(r)}
                              className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs hover:border-[#c9a96e]/40"
                            >
                              Edit
                            </button>
                          )}
                          <button
                            onClick={() => deleteRelease(r)}
                            disabled={busy === r.id}
                            className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-red-400 hover:border-red-400/40 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expanded === r.id && (
                      <tr className="border-b border-white/[0.04]">
                        <td colSpan={5} className="px-5 pb-4 pt-0">
                          {r.tracks.length === 0 ? (
                            <p className="text-xs text-[#666] px-2 py-3">
                              No tracks on this release.
                            </p>
                          ) : (
                            <ul className="divide-y divide-white/[0.04] rounded-lg border border-white/[0.06] bg-black/20">
                              {r.tracks.map((t, i) => (
                                <li
                                  key={t.id}
                                  className="flex items-center gap-3 px-4 py-2.5"
                                >
                                  <div className="flex flex-col">
                                    <button
                                      onClick={() => reorderTrack(r.id, i, -1)}
                                      disabled={i === 0 || busy === t.id}
                                      className="text-[10px] leading-none text-[#888] hover:text-[#c9a96e] disabled:opacity-30"
                                      title="Move up"
                                    >
                                      ▲
                                    </button>
                                    <button
                                      onClick={() => reorderTrack(r.id, i, 1)}
                                      disabled={
                                        i === r.tracks.length - 1 || busy === t.id
                                      }
                                      className="text-[10px] leading-none text-[#888] hover:text-[#c9a96e] disabled:opacity-30"
                                      title="Move down"
                                    >
                                      ▼
                                    </button>
                                  </div>
                                  <span className="w-6 shrink-0 text-xs text-[#666]">
                                    {i + 1}
                                  </span>
                                  {editingTrackId === t.id ? (
                                    <input
                                      autoFocus
                                      value={trackDraft}
                                      onChange={(e) => setTrackDraft(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter")
                                          saveTrackTitle(r.id, t.id);
                                        if (e.key === "Escape")
                                          setEditingTrackId(null);
                                      }}
                                      className="min-w-0 flex-1 px-2 py-1 rounded bg-black/40 border border-white/10 text-sm"
                                    />
                                  ) : (
                                    <button
                                      onClick={() => {
                                        setEditingTrackId(t.id);
                                        setTrackDraft(t.title);
                                      }}
                                      className="min-w-0 flex-1 truncate text-left hover:text-[#c9a96e]"
                                      title="Click to rename"
                                    >
                                      {t.title}
                                    </button>
                                  )}
                                  {editingTrackId === t.id && (
                                    <button
                                      onClick={() => saveTrackTitle(r.id, t.id)}
                                      disabled={busy === t.id}
                                      className="shrink-0 px-2 py-1 bg-[#c9a96e]/15 border border-[#c9a96e]/30 rounded text-xs text-[#c9a96e]"
                                    >
                                      Save
                                    </button>
                                  )}
                                  <button
                                    onClick={() =>
                                      patchRelease(r.id, {}) ||
                                      fetch(`/api/admin/tracks/${t.id}`, {
                                        method: "PATCH",
                                        headers: {
                                          "Content-Type": "application/json",
                                        },
                                        body: JSON.stringify({
                                          is_published: !t.is_published,
                                        }),
                                      })
                                        .then(async (res) => {
                                          if (!res.ok) {
                                            const d = await res
                                              .json()
                                              .catch(() => ({}));
                                            throw new Error(
                                              d?.error ?? "Request failed",
                                            );
                                          }
                                          setReleases((prev) =>
                                            prev.map((rr) =>
                                              rr.id === r.id
                                                ? {
                                                    ...rr,
                                                    tracks: rr.tracks.map((tt) =>
                                                      tt.id === t.id
                                                        ? {
                                                            ...tt,
                                                            is_published:
                                                              !tt.is_published,
                                                          }
                                                        : tt,
                                                    ),
                                                  }
                                                : rr,
                                            ),
                                          );
                                        })
                                        .catch((err) =>
                                          alert(
                                            `Could not update track.\n\n${err.message}`,
                                          ),
                                        )
                                    }
                                    className={`shrink-0 text-[10px] uppercase px-2 py-1 rounded ${
                                      t.is_published
                                        ? "text-green-400"
                                        : "text-[#888]"
                                    }`}
                                    title="Toggle published"
                                  >
                                    {t.is_published ? "Live" : "Draft"}
                                  </button>
                                  <span className="shrink-0 text-xs text-[#666]">
                                    {fmt(t.duration_seconds)}
                                  </span>
                                  <button
                                    onClick={() => deleteTrack(r.id, t)}
                                    disabled={busy === t.id}
                                    className="shrink-0 px-2.5 py-1 bg-white/5 border border-white/10 rounded-lg text-xs text-red-400 hover:border-red-400/40 disabled:opacity-50"
                                  >
                                    Delete
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}
