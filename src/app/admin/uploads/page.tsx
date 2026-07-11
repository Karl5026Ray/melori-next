"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import CoverImage from "@/components/CoverImage";

// Admin management surface for the public uploads collection (studio_tracks).
// Artists' uploads auto-publish into this collection alphabetically; here the
// site owner can delete anything that shouldn't be posted, unpublish/republish,
// and nudge ordering via sort_order. This is the cross-artist counterpart to
// the owner-scoped /studio tools.

type StudioTrack = {
  id: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  status: string | null;
  cover_url: string | null;
  duration: number | null;
  sort_order: number | null;
  created_at: string;
};

export default function AdminUploadsPage() {
  const router = useRouter();
  const [tracks, setTracks] = useState<StudioTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/studio-tracks");
      if (res.status === 401) {
        router.push("/admin");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to load uploads");
      setTracks(data.tracks ?? []);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load uploads");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleStatus = async (t: StudioTrack) => {
    const next = t.status === "published" ? "draft" : "published";
    setBusy(t.id);
    try {
      const res = await fetch(`/api/admin/studio-tracks/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Update failed");
      setTracks((prev) =>
        prev.map((x) => (x.id === t.id ? { ...x, status: next } : x)),
      );
    } catch (err: any) {
      alert(err?.message ?? "Update failed");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (t: StudioTrack) => {
    if (
      !confirm(
        `Delete "${t.title ?? "this upload"}" by ${
          t.artist ?? "unknown"
        }? This removes it from the collection and deletes its audio, preview, and cover. This cannot be undone.`,
      )
    )
      return;
    setBusy(t.id);
    try {
      const res = await fetch(`/api/admin/studio-tracks/${t.id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Delete failed");
      setTracks((prev) => prev.filter((x) => x.id !== t.id));
    } catch (err: any) {
      alert(err?.message ?? "Delete failed");
    } finally {
      setBusy(null);
    }
  };

  const saveOrder = async (t: StudioTrack, value: string) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    setBusy(t.id);
    try {
      const res = await fetch(`/api/admin/studio-tracks/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sort_order: Math.trunc(n) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Update failed");
      setTracks((prev) =>
        prev.map((x) =>
          x.id === t.id ? { ...x, sort_order: Math.trunc(n) } : x,
        ),
      );
    } catch (err: any) {
      alert(err?.message ?? "Update failed");
    } finally {
      setBusy(null);
    }
  };

  const filtered = tracks.filter((t) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      (t.title ?? "").toLowerCase().includes(q) ||
      (t.artist ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center justify-between gap-4 mb-2 flex-wrap">
          <div>
            <Link
              href="/admin/dashboard"
              className="text-xs text-[#c9a96e] hover:underline"
            >
              ← Back to Dashboard
            </Link>
            <h1 className="text-2xl font-bold mt-2">Uploads Collection</h1>
          </div>
          <button
            onClick={load}
            className="px-3 py-1.5 rounded-lg bg-[#c9a96e]/15 text-[#c9a96e] text-xs font-medium hover:bg-[#c9a96e]/25"
          >
            Refresh
          </button>
        </div>
        <p className="text-[#888] text-sm mb-6 max-w-2xl">
          Artist uploads publish here automatically and appear on the public
          music page in alphabetical order. Delete anything that shouldn&apos;t
          be posted, unpublish to hide it without deleting, or set a sort number
          to organize.
        </p>

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title or artist…"
          className="w-full sm:w-80 bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-sm mb-4"
        />

        {error && (
          <p className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400 mb-4">
            {error}
          </p>
        )}

        {loading ? (
          <p className="text-[#888] text-sm">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-[#888] text-sm">No uploads found.</p>
        ) : (
          <div className="space-y-3">
            {filtered.map((t) => (
              <div
                key={t.id}
                className="flex items-start gap-4 p-4 bg-white/[0.02] border border-white/10 rounded-xl"
              >
                <div className="w-16 h-16 shrink-0 overflow-hidden rounded-lg border border-white/10">
                  <CoverImage
                    src={t.cover_url}
                    alt={t.title ?? "Upload"}
                    name={t.title ?? "Upload"}
                    rounded="rounded-lg"
                    className="w-full h-full"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-semibold truncate">
                      {t.title ?? "Untitled"}
                    </h4>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full uppercase ${
                        t.status === "published"
                          ? "bg-emerald-500/15 text-emerald-300"
                          : "bg-white/5 text-[#888]"
                      }`}
                    >
                      {t.status ?? "draft"}
                    </span>
                    {t.genre && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-[#ccc]">
                        {t.genre}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#888] mt-1">
                    by {t.artist ?? "unknown"}
                    {t.album ? ` · ${t.album}` : ""} ·{" "}
                    {new Date(t.created_at).toLocaleDateString()}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <label className="text-xs text-[#666]">Sort</label>
                    <input
                      type="number"
                      defaultValue={t.sort_order ?? 0}
                      onBlur={(e) => {
                        if (Number(e.target.value) !== (t.sort_order ?? 0)) {
                          saveOrder(t, e.target.value);
                        }
                      }}
                      disabled={busy === t.id}
                      className="w-20 bg-black/60 border border-white/10 rounded px-2 py-1 text-xs"
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <button
                    onClick={() => toggleStatus(t)}
                    disabled={busy === t.id}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 ${
                      t.status === "published"
                        ? "bg-white/5 text-[#ccc] hover:bg-white/10"
                        : "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                    }`}
                  >
                    {t.status === "published" ? "Unpublish" : "Publish"}
                  </button>
                  <button
                    onClick={() => remove(t)}
                    disabled={busy === t.id}
                    className="px-3 py-1.5 rounded-lg bg-red-500/15 text-red-300 text-xs font-medium hover:bg-red-500/25 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
