"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/authClient";
import { formatPriceCents } from "@/lib/format";
import {
  PRICE_RANGE_MESSAGE,
  centsToDollarsInput,
  dollarsToCentsInput,
} from "@/lib/pricing";
import SplitsEditor from "./SplitsEditor";

// One place for the artist to price their catalog and share it with
// collaborators. Albums come from the studio_albums side-car; singles are the
// tracks that aren't in one.

interface AlbumSummary {
  id: string;
  title: string;
  slug: string;
  priceCents: number;
  trackCount: number;
  publishedCount: number;
}

interface TrackSummary {
  id: string;
  title: string;
  album: string | null;
  status: string;
  price_cents: number | null;
}

export default function PricingPanel() {
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [tracks, setTracks] = useState<TrackSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openSplits, setOpenSplits] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [albumRes, trackRes] = await Promise.all([
        authFetch("/api/studio/albums"),
        authFetch("/api/studio/tracks"),
      ]);
      const albumBody = await albumRes.json().catch(() => ({}));
      const trackBody = await trackRes.json().catch(() => ({}));
      setAlbums((albumBody.albums ?? []) as AlbumSummary[]);
      setTracks((trackBody.tracks ?? []) as TrackSummary[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const priceOf = (key: string, cents: number | null) =>
    drafts[key] ?? centsToDollarsInput(cents ?? 0);

  const saveAlbumPrice = async (album: AlbumSummary) => {
    const cents = dollarsToCentsInput(priceOf(`album:${album.id}`, album.priceCents));
    if (cents === null) {
      setError(PRICE_RANGE_MESSAGE);
      return;
    }
    setError(null);
    setSavingId(`album:${album.id}`);
    try {
      const res = await authFetch("/api/studio/albums", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: album.id, price_cents: cents }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Could not save the album price.");
        return;
      }
      setAlbums((prev) =>
        prev.map((a) => (a.id === album.id ? { ...a, priceCents: cents } : a)),
      );
    } finally {
      setSavingId(null);
    }
  };

  const saveTrackPrice = async (track: TrackSummary) => {
    const cents = dollarsToCentsInput(priceOf(`track:${track.id}`, track.price_cents));
    if (cents === null) {
      setError(PRICE_RANGE_MESSAGE);
      return;
    }
    setError(null);
    setSavingId(`track:${track.id}`);
    try {
      const res = await authFetch(`/api/studio/track/${track.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price_cents: cents }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Could not save the track price.");
        return;
      }
      setTracks((prev) =>
        prev.map((t) => (t.id === track.id ? { ...t, price_cents: cents } : t)),
      );
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return <p className="text-sm text-[#888]">Loading your catalog…</p>;
  }

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h2 className="mb-1 text-lg font-semibold">Pricing &amp; splits</h2>
        <p className="text-sm text-[#888]">
          Set what your music costs and, if you made it with someone, how the
          money is shared. Prices show on every card and page across MELORI, and
          a price of $0.00 makes something a free download.
        </p>
      </div>

      {error && (
        <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-400">{error}</p>
      )}

      <section className="space-y-3">
        <h3 className="text-sm uppercase tracking-widest text-[#888]">Albums</h3>
        {albums.length === 0 ? (
          <p className="text-sm text-[#666]">
            No albums yet — give a few tracks the same album name and it will
            show up here.
          </p>
        ) : (
          albums.map((album) => (
            <div
              key={album.id}
              className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4"
            >
              <div className="flex flex-wrap items-center gap-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{album.title}</p>
                  <p className="text-xs text-[#666]">
                    {album.trackCount} track{album.trackCount === 1 ? "" : "s"} ·{" "}
                    {album.publishedCount} published ·{" "}
                    {formatPriceCents(album.priceCents)}
                  </p>
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#888]">
                    $
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={`Price for ${album.title}`}
                    value={priceOf(`album:${album.id}`, album.priceCents)}
                    onChange={(e) =>
                      setDrafts((d) => ({
                        ...d,
                        [`album:${album.id}`]: e.target.value,
                      }))
                    }
                    className="w-28 rounded-lg border border-white/10 bg-white/5 py-2 pl-7 pr-3 text-sm outline-none focus:border-[#c9a96e]/40"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => saveAlbumPrice(album)}
                  disabled={savingId === `album:${album.id}`}
                  className="rounded-lg bg-[#c9a96e] px-4 py-2 text-sm font-semibold text-black hover:bg-[#f0d99c] disabled:opacity-50"
                >
                  {savingId === `album:${album.id}` ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setOpenSplits((cur) =>
                      cur === `studio_album:${album.id}`
                        ? null
                        : `studio_album:${album.id}`,
                    )
                  }
                  className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm hover:border-[#c9a96e]/40"
                >
                  Splits
                </button>
              </div>
              {openSplits === `studio_album:${album.id}` && (
                <div className="mt-4 border-t border-white/[0.06] pt-4">
                  <SplitsEditor
                    kind="studio_album"
                    itemId={album.id}
                    itemTitle={album.title}
                  />
                </div>
              )}
            </div>
          ))
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm uppercase tracking-widest text-[#888]">Tracks</h3>
        {tracks.length === 0 ? (
          <p className="text-sm text-[#666]">No tracks yet.</p>
        ) : (
          tracks.map((track) => (
            <div
              key={track.id}
              className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4"
            >
              <div className="flex flex-wrap items-center gap-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{track.title}</p>
                  <p className="text-xs text-[#666]">
                    {track.album ? `${track.album} · ` : "Single · "}
                    {track.status} · {formatPriceCents(track.price_cents)}
                  </p>
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#888]">
                    $
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={`Price for ${track.title}`}
                    value={priceOf(`track:${track.id}`, track.price_cents)}
                    onChange={(e) =>
                      setDrafts((d) => ({
                        ...d,
                        [`track:${track.id}`]: e.target.value,
                      }))
                    }
                    className="w-28 rounded-lg border border-white/10 bg-white/5 py-2 pl-7 pr-3 text-sm outline-none focus:border-[#c9a96e]/40"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => saveTrackPrice(track)}
                  disabled={savingId === `track:${track.id}`}
                  className="rounded-lg bg-[#c9a96e] px-4 py-2 text-sm font-semibold text-black hover:bg-[#f0d99c] disabled:opacity-50"
                >
                  {savingId === `track:${track.id}` ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setOpenSplits((cur) =>
                      cur === `studio_track:${track.id}`
                        ? null
                        : `studio_track:${track.id}`,
                    )
                  }
                  className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm hover:border-[#c9a96e]/40"
                >
                  Splits
                </button>
              </div>
              {openSplits === `studio_track:${track.id}` && (
                <div className="mt-4 border-t border-white/[0.06] pt-4">
                  <SplitsEditor
                    kind="studio_track"
                    itemId={track.id}
                    itemTitle={track.title}
                  />
                </div>
              )}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
