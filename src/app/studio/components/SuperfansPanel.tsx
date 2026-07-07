"use client";

import { useState, useEffect } from "react";
import { authFetch } from "@/lib/authClient";

interface Superfan {
  rank: number;
  listener_id: string;
  display_name: string;
  avatar_url: string | null;
  plays: number;
  last_listen: string;
  favorite_track: string | null;
  favorite_album: string | null;
}

interface StudioSuperfansResponse {
  superfans: Superfan[];
  total_listeners: number;
}

// Richer, artist-private view of the top 5 (or 25) superfans. Shows favorite
// album and most recent listen date in addition to the public fields.
export default function SuperfansPanel() {
  const [data, setData] = useState<StudioSuperfansResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState<5 | 25>(5);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    authFetch(`/api/artist/superfans?limit=${limit}`)
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setData(json as StudioSuperfansResponse);
      })
      .catch(() => {
        if (!cancelled) setData({ superfans: [], total_listeners: 0 });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [limit]);

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return "";
    }
  };

  if (loading) {
    return (
      <div className="text-center py-20">
        <div className="w-10 h-10 border-3 border-[#c9a96e]/20 border-t-[#c9a96e] rounded-full animate-spin mx-auto mb-4" />
        <p className="text-[#888]">Loading superfans…</p>
      </div>
    );
  }

  const superfans = data?.superfans ?? [];
  const total = data?.total_listeners ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Your superfans</h2>
          <p className="text-[#888] text-sm mt-1">
            The listeners who play your music the most.{" "}
            {total > 0 && (
              <>
                {total} unique {total === 1 ? "listener" : "listeners"} tracked.
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {([5, 25] as const).map((n) => (
            <button
              key={n}
              onClick={() => setLimit(n)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                limit === n
                  ? "bg-[#c9a96e] text-black"
                  : "bg-white/[0.04] text-[#888] hover:text-white"
              }`}
            >
              Top {n}
            </button>
          ))}
        </div>
      </div>

      {superfans.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-10 text-center">
          <p className="text-lg font-semibold">No superfans yet</p>
          <p className="mt-2 text-sm text-[#888]">
            Once fans start streaming your published tracks, the top listeners
            will show up here.
          </p>
        </div>
      ) : (
        <ol className="space-y-3">
          {superfans.map((fan) => (
            <li
              key={fan.listener_id}
              className="flex flex-wrap items-center gap-4 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 sm:flex-nowrap"
            >
              <span className="w-8 text-center text-2xl font-bold text-[#c9a96e]">
                {fan.rank}
              </span>
              {fan.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={fan.avatar_url}
                  alt=""
                  className="h-12 w-12 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#c9a96e]/20 text-sm font-semibold text-[#c9a96e]"
                  aria-hidden
                >
                  {fan.display_name.charAt(0).toUpperCase()}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{fan.display_name}</p>
                {fan.favorite_track && (
                  <p className="truncate text-sm text-[#888]">
                    Fav: {fan.favorite_track}
                    {fan.favorite_album ? ` · ${fan.favorite_album}` : ""}
                  </p>
                )}
                <p className="text-xs text-[#666] mt-0.5">
                  Last listened {formatDate(fan.last_listen)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-[#c9a96e]">
                  {fan.plays}
                </p>
                <p className="text-xs text-[#888]">
                  {fan.plays === 1 ? "play" : "plays"}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
