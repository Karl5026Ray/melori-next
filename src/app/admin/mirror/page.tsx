"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { authFetch } from "@/lib/authClient";
import { ArrowLeft, Film, RefreshCw, Trash2, Youtube } from "lucide-react";

type Author = {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  verified: boolean | null;
  role: string | null;
};

type MirrorPost = {
  id: string;
  user_id: string;
  title: string | null;
  description: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
  media_type: string | null;
  source: string | null;
  youtube_id: string | null;
  likes_count: number | null;
  comments_count: number | null;
  created_at: string | null;
  expires_at: string | null;
  user: Author | Author[] | null;
};

type SourceFilter = "all" | "upload" | "youtube";
type ScopeFilter = "live" | "all";

function authorOf(p: MirrorPost): Author | null {
  if (!p.user) return null;
  return Array.isArray(p.user) ? (p.user[0] ?? null) : p.user;
}

// "in 3h 40m" / "expired" — how long a post has left in the 24h rotation.
function expiryLabel(iso: string | null): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return "—";
  if (ms <= 0) return "expired";
  const mins = Math.floor(ms / 60000);
  const hrs = Math.floor(mins / 60);
  return hrs > 0 ? `in ${hrs}h ${mins % 60}m` : `in ${mins}m`;
}

export default function AdminMirrorPage() {
  const [posts, setPosts] = useState<MirrorPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [source, setSource] = useState<SourceFilter>("all");
  const [scope, setScope] = useState<ScopeFilter>("live");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(
        `/api/admin/mirror?source=${source}&scope=${scope}`,
        { cache: "no-store" },
      );
      if (res.status === 401 || res.status === 403) {
        setError("Not signed in as admin. Please log in at /admin.");
        setPosts([]);
        return;
      }
      if (!res.ok) {
        setError("Failed to load Mirror posts.");
        return;
      }
      const data = await res.json();
      setPosts(data.items ?? []);
    } catch {
      setError("Failed to load Mirror posts.");
    } finally {
      setLoading(false);
    }
  }, [source, scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = useCallback(async (p: MirrorPost) => {
    const label = p.title || p.id.slice(0, 8);
    if (
      !window.confirm(
        `Delete "${label}" from the Mirror?\n\nThe post is archived for audit and removed from the feed. Uploaded media is deleted from storage. This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusyId(p.id);
    setNotice(null);
    setError(null);
    try {
      const res = await authFetch(`/api/admin/mirror/${p.id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Failed to delete the post.");
        return;
      }
      setPosts((prev) => prev.filter((x) => x.id !== p.id));
      setNotice(
        data.storageErrors
          ? `"${label}" removed, but storage cleanup reported: ${data.storageErrors.join(", ")}`
          : `"${label}" has been removed from the Mirror.`,
      );
    } catch {
      setError("Failed to delete the post.");
    } finally {
      setBusyId(null);
    }
  }, []);

  return (
    <div className="min-h-screen bg-melori-bg text-melori-text p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <Link
            href="/admin/dashboard"
            className="inline-flex items-center gap-1 text-sm text-melori-muted hover:text-melori-text"
          >
            <ArrowLeft className="w-4 h-4" /> Back to dashboard
          </Link>
        </div>

        <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
              <Film className="w-6 h-6 text-melori-primary" /> Mirror posts
            </h1>
            <p className="text-melori-muted text-sm mt-1">
              Everything currently in the For You feed — member uploads and
              artist-submitted YouTube links. Posts rotate out on their own after
              24 hours; delete here to take one down immediately.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as SourceFilter)}
              className="bg-melori-card border border-melori-border rounded-lg px-3 py-2 text-sm"
            >
              <option value="all">All sources</option>
              <option value="upload">Uploads</option>
              <option value="youtube">YouTube</option>
            </select>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as ScopeFilter)}
              className="bg-melori-card border border-melori-border rounded-lg px-3 py-2 text-sm"
            >
              <option value="live">Live now</option>
              <option value="all">Include expired</option>
            </select>
            <button
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-1 bg-melori-card border border-melori-border rounded-lg px-3 py-2 text-sm hover:bg-melori-border/40 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}
        {notice && (
          <div className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            {notice}
          </div>
        )}

        {loading && <p className="text-melori-muted">Loading…</p>}
        {!loading && posts.length === 0 && !error && (
          <p className="text-melori-muted">No Mirror posts match this filter.</p>
        )}

        <div className="space-y-3">
          {posts.map((p) => {
            const author = authorOf(p);
            const isYouTube = p.source === "youtube";
            return (
              <div
                key={p.id}
                className="flex gap-4 rounded-xl border border-melori-border bg-melori-card p-3"
              >
                <div className="h-20 w-14 shrink-0 overflow-hidden rounded-lg bg-black">
                  {p.thumbnail_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.thumbnail_url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                        isYouTube
                          ? "bg-red-500/20 text-red-300"
                          : "bg-melori-border/40 text-melori-muted"
                      }`}
                    >
                      {isYouTube && <Youtube className="h-3 w-3" />}
                      {isYouTube ? "YouTube" : (p.media_type ?? "upload")}
                    </span>
                    <span className="text-xs text-melori-muted">
                      rotates out {expiryLabel(p.expires_at)}
                    </span>
                    <span className="text-xs text-melori-muted">
                      ♥ {p.likes_count ?? 0} · 💬 {p.comments_count ?? 0}
                    </span>
                  </div>
                  <p className="truncate font-semibold">{p.title || "Untitled"}</p>
                  <p className="truncate text-sm text-melori-muted">
                    {author?.display_name || author?.username || p.user_id}
                    {author?.role ? ` · ${author.role}` : ""}
                  </p>
                  {p.video_url && (
                    <a
                      href={p.video_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-melori-primary hover:underline"
                    >
                      Open source
                    </a>
                  )}
                </div>

                <button
                  onClick={() => void remove(p)}
                  disabled={busyId === p.id}
                  className="inline-flex h-9 shrink-0 items-center gap-1 self-center rounded-lg bg-red-600/80 px-3 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  {busyId === p.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
