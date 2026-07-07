"use client";

import { useState, useEffect, useCallback } from "react";

interface PublicSuperfan {
  rank: number;
  display_name: string;
  avatar_url: string | null;
  plays: number;
  favorite_track: string | null;
}

interface PublicSuperfansResponse {
  superfans: PublicSuperfan[];
  total_listeners: number;
}

// Public-facing dropdown that reveals the top 5 listeners for an artist.
// Fetches lazily on first open so pages that render this button don't pay
// the API cost unless a visitor actually engages.
export default function SuperfanButton({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<PublicSuperfansResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (data || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/artists/${slug}/superfans`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as PublicSuperfansResponse;
      setData(json);
    } catch (err) {
      setError("Couldn't load superfans");
      // Reset so a retry on next open re-fetches
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [slug, data, loading]);

  const handleClick = () => {
    const willOpen = !open;
    setOpen(willOpen);
    if (willOpen) void load();
  };

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={handleClick}
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-full border border-[#c9a96e]/40 bg-[#c9a96e]/10 px-4 py-2 text-sm font-medium text-[#c9a96e] transition hover:bg-[#c9a96e]/20"
      >
        <span aria-hidden>⭐</span>
        <span>Superfans</span>
        {data && data.total_listeners > 0 && (
          <span className="ml-1 rounded-full bg-[#c9a96e]/20 px-2 py-0.5 text-xs">
            {data.total_listeners}
          </span>
        )}
        <span
          aria-hidden
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>

      {open && (
        <div className="mt-3 max-w-md rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
          {loading && (
            <p className="text-sm text-text-secondary">Loading top fans…</p>
          )}
          {error && !loading && (
            <p className="text-sm text-red-400">{error}</p>
          )}
          {!loading && !error && data && data.superfans.length === 0 && (
            <p className="text-sm text-text-secondary">
              No superfans yet — be the first.
            </p>
          )}
          {!loading && !error && data && data.superfans.length > 0 && (
            <ol className="space-y-3">
              {data.superfans.map((fan) => (
                <li
                  key={fan.rank}
                  className="flex items-center gap-3 text-sm"
                >
                  <span className="w-5 text-center font-semibold text-[#c9a96e]">
                    {fan.rank}
                  </span>
                  {fan.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={fan.avatar_url}
                      alt=""
                      className="h-8 w-8 rounded-full object-cover"
                    />
                  ) : (
                    <span
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-[#c9a96e]/20 text-xs font-semibold text-[#c9a96e]"
                      aria-hidden
                    >
                      {fan.display_name.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{fan.display_name}</p>
                    {fan.favorite_track && (
                      <p className="truncate text-xs text-text-secondary">
                        fav: {fan.favorite_track}
                      </p>
                    )}
                  </div>
                  <span className="whitespace-nowrap text-xs text-text-secondary">
                    {fan.plays} {fan.plays === 1 ? "play" : "plays"}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
