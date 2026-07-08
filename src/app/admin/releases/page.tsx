"use client";

import { useState, useEffect, useCallback, Fragment } from "react";
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
      // Drop the track locally. If it was the last one, the API also removed the
      // now-empty release, so reload to reflect that cleanly.
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
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={r.cover_art_url || "/logo/logo.png"}
                            alt=""
                            className="w-10 h-10 rounded-lg object-cover bg-white/10"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.visibility =
                                "hidden";
                            }}
                          />
                          <div>
                            <div className="font-medium">{r.title}</div>
                            <div className="text-xs text-[#666] uppercase">
                              {r.release_type}
                            </div>
                          </div>
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
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-semibold ${
                            r.is_published
                              ? "bg-green-500/15 text-green-400"
                              : "bg-white/10 text-[#888]"
                          }`}
                        >
                          {r.is_published ? "Published" : "Draft"}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex gap-2 justify-end">
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
                              {r.tracks.map((t) => (
                                <li
                                  key={t.id}
                                  className="flex items-center gap-4 px-4 py-2.5"
                                >
                                  <span className="w-6 shrink-0 text-xs text-[#666]">
                                    {t.track_number ?? "—"}
                                  </span>
                                  <span className="min-w-0 flex-1 truncate">
                                    {t.title}
                                  </span>
                                  {!t.is_published && (
                                    <span className="shrink-0 text-[10px] uppercase text-[#888]">
                                      Draft
                                    </span>
                                  )}
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
