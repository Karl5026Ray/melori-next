"use client";

// "Listen now" — the strip at the top of the door (/platform).
//
// Karl, 16 Nov 2026: a stranger should hear the music before being asked for
// an email. Each tap plays a ~30-second preview from /api/tracks/[id]/preview
// (an allowlist; see src/lib/doorPreviews.ts). Nothing autoplays — Karl,
// 20 Oct 2026: "the music scares people when it comes on." Sound only starts
// when the visitor taps play.
//
// When a preview ends, the strip says what an account gets them: the whole
// song. That line is the point of the strip.

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import type { DoorPreview } from "@/app/api/door-previews/route";

const PREVIEW_CAP_SECONDS = 30;

export default function DoorListenStrip({ onWantsFullSong }: { onWantsFullSong?: () => void }) {
  const [previews, setPreviews] = useState<DoorPreview[]>([]);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [finishedTitle, setFinishedTitle] = useState<string | null>(null);
  const [failed, setFailed] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Each tap gets a number. A slow response for an older tap, or one that
  // lands after the strip is gone, must not start audio.
  const requestRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    fetch("/api/door-previews")
      .then((r) => (r.ok ? r.json() : { previews: [] }))
      .then((j: { previews?: DoorPreview[] }) => {
        if (!cancelled) setPreviews(j.previews ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      mountedRef.current = false;
      requestRef.current += 1;
      audioRef.current?.pause();
    };
  }, []);

  if (previews.length === 0) return null;

  const stop = () => {
    requestRef.current += 1;
    audioRef.current?.pause();
    setPlayingId(null);
  };

  const play = async (p: DoorPreview) => {
    if (playingId === p.id) {
      stop();
      return;
    }
    stop();
    const ticket = ++requestRef.current;
    const stale = () => !mountedRef.current || ticket !== requestRef.current;
    setFailed(null);
    setFinishedTitle(null);
    setLoadingId(p.id);
    try {
      const res = await fetch(`/api/tracks/${p.id}/preview`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const { url } = (await res.json()) as { url: string };
      if (stale()) return;
      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;
      audio.src = url;
      audio.ontimeupdate = () => {
        if (audio.currentTime >= PREVIEW_CAP_SECONDS) audio.pause();
      };
      audio.onpause = () => {
        setPlayingId((cur) => (cur === p.id ? null : cur));
        if (audio.ended || audio.currentTime >= PREVIEW_CAP_SECONDS - 0.5) {
          setFinishedTitle(p.title);
        }
      };
      await audio.play();
      if (stale()) {
        audio.pause();
        return;
      }
      setPlayingId(p.id);
    } catch {
      if (!stale()) setFailed(p.id);
    } finally {
      if (!stale()) setLoadingId(null);
    }
  };

  return (
    <section aria-labelledby="door-listen" className="mb-8" data-testid="door-listen">
      <h2
        id="door-listen"
        className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-melori-teal"
      >
        Listen now &middot; no account needed
      </h2>
      <ul className="mt-4 space-y-2">
        {previews.map((p) => {
          const isPlaying = playingId === p.id;
          const isLoading = loadingId === p.id;
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => play(p)}
                aria-label={`${isPlaying ? "Pause" : "Play a 30-second preview of"} ${p.title} by ${p.artist}`}
                className={`flex w-full items-center gap-3 rounded-2xl border p-2.5 text-left transition ${
                  isPlaying
                    ? "border-melori-teal/60 bg-white/[0.06]"
                    : "border-white/10 bg-white/[0.03] hover:border-melori-teal/40"
                }`}
              >
                <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-white/5">
                  {p.cover && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.cover} alt="" className="h-full w-full object-cover" loading="lazy" />
                  )}
                  <span className="absolute inset-0 grid place-items-center bg-black/40">
                    {isPlaying ? (
                      <Pause className="h-5 w-5 text-white" aria-hidden />
                    ) : (
                      <Play className={`h-5 w-5 text-white ${isLoading ? "animate-pulse" : ""}`} aria-hidden />
                    )}
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-white">{p.title}</span>
                  <span className="block truncate text-xs text-[#999]">
                    {p.artist}
                    {failed === p.id ? " · couldn't play, try again" : ""}
                  </span>
                </span>
                <span className="shrink-0 pr-1 text-[10px] uppercase tracking-wide text-[#777]">
                  0:30
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {finishedTitle ? (
        <p className="mt-3 text-center text-sm text-[#ddd]" data-testid="door-listen-upsell">
          Liked &ldquo;{finishedTitle}&rdquo;?{" "}
          <button
            type="button"
            onClick={onWantsFullSong}
            className="font-semibold text-[#c9a96e] hover:underline"
          >
            Make a free account for the whole song.
          </button>
        </p>
      ) : (
        <p className="mt-3 text-center text-xs text-[#777]">
          30-second previews. Every full song is free once you sign up.
        </p>
      )}
    </section>
  );
}
