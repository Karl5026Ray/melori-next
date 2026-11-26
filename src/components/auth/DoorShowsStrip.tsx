"use client";

// "Listen now" on the door (/platform) — Melori Radio shows, free.
//
// Karl, 26 Nov 2026: "Remove the individual songs from there and add the
// shows." The door used to offer 30-second song previews (DoorListenStrip).
// Now a stranger can play a whole hour-long show with no account — the show
// is the advertising, and every song in it is one free account away. Nothing
// autoplays; each show links to its own page (/shows/<slug>) to share.

import { useEffect, useState } from "react";
import Link from "next/link";
import ShowPlayer from "@/components/shows/ShowPlayer";
import type { PublicShow } from "@/lib/showsShared";

export default function DoorShowsStrip({ onWantsFullSong }: { onWantsFullSong?: () => void }) {
  const [shows, setShows] = useState<PublicShow[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/shows")
      .then((r) => (r.ok ? r.json() : { shows: [] }))
      .then((j: { shows?: PublicShow[] }) => {
        if (!cancelled) setShows(j.shows ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // The door must never break over this strip: no shows, no strip.
  if (shows.length === 0) return null;

  return (
    <section aria-labelledby="door-listen" className="mb-8" data-testid="door-listen">
      <h2
        id="door-listen"
        className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-melori-teal"
      >
        Melori Radio &middot; free, no account needed
      </h2>
      <div className="mt-4 space-y-2">
        {shows.slice(0, 3).map((s) => (
          <ShowPlayer key={s.slug} show={s} compact />
        ))}
      </div>
      <p className="mt-3 text-center text-sm text-[#ddd]" data-testid="door-listen-upsell">
        Hear something you like?{" "}
        <button
          type="button"
          onClick={onWantsFullSong}
          className="font-semibold text-[#c9a96e] hover:underline"
        >
          Every song is free with an account.
        </button>{" "}
        {shows.length > 3 && (
          <Link href="/shows" className="text-[#999] hover:underline">
            All shows
          </Link>
        )}
      </p>
    </section>
  );
}
