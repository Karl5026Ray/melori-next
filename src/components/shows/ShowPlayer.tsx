"use client";

// Plays a Melori Radio show for anyone — no account (src/lib/shows.ts).
// Hours play back to back; each hour fetches its own short-lived signed URL
// from /api/shows/[id]/stream when it starts. Nothing autoplays (Karl,
// 20 Oct 2026: "the music scares people when it comes on").
//
// `compact` is the front-door card; the full layout is the show's own page.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Pause, Play, Share2 } from "lucide-react";
import type { PublicShow } from "@/lib/showsShared";
import { formatShowLength } from "@/lib/showsShared";
import { usePlayer } from "@/components/player/PlayerProvider";

function clock(sec: number): string {
  if (!sec || !Number.isFinite(sec)) return "0:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

export default function ShowPlayer({
  show,
  compact = false,
  startPart = 0,
}: {
  show: PublicShow;
  compact?: boolean;
  startPart?: number;
}) {
  const player = usePlayer();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [part, setPart] = useState(Math.min(Math.max(startPart, 0), show.parts.length - 1));
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(0);
  const [copied, setCopied] = useState(false);
  const ticket = useRef(0);
  const href = `/shows/${show.slug}`;

  useEffect(
    () => () => {
      ticket.current += 1;
      audioRef.current?.pause();
    },
    [],
  );

  const start = async (i: number) => {
    const t = ++ticket.current;
    setFailed(false);
    setLoading(true);
    setPart(i);
    setTime(0);
    setLength(show.parts[i]?.durationSeconds ?? 0);
    // One sound at a time: hush the site-wide player (radio, songs) first.
    player.pause();
    try {
      const res = await fetch(`/api/shows/${show.parts[i].id}/stream`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const { url } = (await res.json()) as { url: string };
      if (t !== ticket.current) return;
      const a = audioRef.current ?? new Audio();
      audioRef.current = a;
      a.ontimeupdate = () => setTime(a.currentTime);
      a.onloadedmetadata = () => Number.isFinite(a.duration) && setLength(a.duration);
      a.onplay = () => setPlaying(true);
      a.onpause = () => setPlaying(false);
      a.onended = () => {
        if (i + 1 < show.parts.length) void start(i + 1);
      };
      a.src = url;
      await a.play();
    } catch {
      if (t === ticket.current) setFailed(true);
    } finally {
      if (t === ticket.current) setLoading(false);
    }
  };

  const toggle = () => {
    const a = audioRef.current;
    if (a && a.src && !a.ended) {
      if (a.paused) {
        player.pause();
        void a.play().catch(() => setFailed(true));
      } else a.pause();
      return;
    }
    void start(part);
  };

  const share = async () => {
    const url = `${window.location.origin}${href}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `${show.name} — Melori Radio`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the visitor closed the share sheet */
    }
  };

  const playButton = (
    <button
      type="button"
      onClick={toggle}
      aria-label={`${playing ? "Pause" : "Play"} ${show.name}`}
      className={`flex shrink-0 items-center justify-center rounded-full bg-[#c9a96e] text-[#0a0a0a] shadow-lg transition-transform hover:scale-105 active:scale-95 ${
        compact ? "h-12 w-12" : "h-16 w-16"
      }`}
    >
      {loading ? (
        <Loader2 className="h-6 w-6 animate-spin" />
      ) : playing ? (
        <Pause className="h-6 w-6" />
      ) : (
        <Play className="ml-0.5 h-6 w-6" />
      )}
    </button>
  );

  const progress = length > 0 ? Math.min(1, time / length) : 0;
  const nowLine = playing || time > 0 ? `${show.parts[part]?.title} · ${clock(time)} / ${clock(length)}` : null;

  if (compact) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3" data-testid="door-show">
        <div className="flex items-center gap-3">
          <Link href={href} className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-white/5">
            {show.coverUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={show.coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
            )}
          </Link>
          <div className="min-w-0 flex-1">
            <Link href={href} className="block truncate text-sm font-semibold text-white hover:underline">
              {show.name}
            </Link>
            <span className="block truncate text-xs text-[#999]">
              {nowLine ??
                `with ${show.host}${show.totalSeconds ? ` · ${formatShowLength(show.totalSeconds)}` : ""}`}
              {failed ? " · couldn't play, try again" : ""}
            </span>
          </div>
          {playButton}
        </div>
        {(playing || time > 0) && (
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-[#c9a96e]" style={{ width: `${progress * 100}%` }} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-4">
        {playButton}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-[#bbb]">
            {nowLine ?? `${show.parts.length} ${show.parts.length === 1 ? "part" : "parts"} · ${formatShowLength(show.totalSeconds)}`}
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-[#c9a96e]" style={{ width: `${progress * 100}%` }} />
          </div>
          {failed && <p className="mt-1 text-xs text-red-300">Couldn&apos;t play that. Try again.</p>}
        </div>
        <button
          type="button"
          onClick={share}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/15 px-3 py-2 text-xs font-semibold text-white hover:border-[#c9a96e]/60"
        >
          <Share2 className="h-4 w-4" />
          {copied ? "Link copied" : "Share"}
        </button>
      </div>
      {show.parts.length > 1 && (
        <ol className="mt-5 divide-y divide-white/10 rounded-2xl border border-white/10">
          {show.parts.map((p, i) => {
            const on = i === part && (playing || loading);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => (i === part && audioRef.current?.src ? toggle() : void start(i))}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03]"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center text-[#c9a96e]">
                    {on && playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </span>
                  <span className={`min-w-0 flex-1 truncate text-sm ${on ? "font-semibold text-[#c9a96e]" : "text-white"}`}>
                    {p.title}
                  </span>
                  <span className="text-xs text-[#888]">{clock(p.durationSeconds ?? 0)}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
