"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import CoverImage from "@/components/CoverImage";
import { usePlayer } from "@/components/player/PlayerProvider";
import { formatTime } from "@/lib/format";
import { isMediaRoomRoute } from "@/lib/mediaRoomRoute";
import { useTransportVisible } from "@/components/player/useTransportVisible";

function PlayPauseIcon({ playing }: { playing: boolean }) {
  if (playing) {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
        <rect x="6" y="5" width="4" height="14" rx="1" />
        <rect x="14" y="5" width="4" height="14" rx="1" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PrevIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
      <path d="M7 6h2v12H7zM20 6v12l-9-6z" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
      <path d="M15 6h2v12h-2zM4 6v12l9-6z" />
    </svg>
  );
}

function RadioIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M4.5 10.5 16 5" />
      <rect x="3" y="10" width="18" height="10" rx="2" />
      <circle cx="16" cy="15" r="2.5" />
      <path d="M7 15h.01" />
    </svg>
  );
}

function VolumeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
      <path d="M5 9v6h4l5 5V4L9 9H5z" />
    </svg>
  );
}


export default function AudioPlayer() {
  const { pause } = usePlayer();
  const pathname = usePathname();
  // The transport is a main-page control AND a members-only one. Both halves
  // live in useTransportVisible, which MainContent also calls for the bottom
  // clearance, so the bar and the space reserved for it cannot disagree.
  const showTransport = useTransportVisible();
  const inRoom = isMediaRoomRoute(pathname);
  // Mirror is a video feed that plays its own audio on every card, so the
  // background music track would fight the card's soundtrack. Treat Mirror
  // like a room: pause on entry, hide the transport UI.
  const onMirror = pathname === "/social/mirror" ||
    pathname?.startsWith("/social/mirror/");

  // Entering a live room OR Mirror pauses background music so it never fights
  // the room's / feed's own audio. Leaving does NOT auto-resume — the listener
  // presses play again.
  useEffect(() => {
    if (inRoom || onMirror) pause();
  }, [inRoom, onMirror, pause]);

  // Anywhere the transport does not belong renders nothing at all. The <audio>
  // element lives in PlayerProvider (mounted at the layout root), so a track
  // started on the home page keeps playing as the member browses — only the UI
  // is scoped. Pages that need controls (Radio) render their own.
  if (!showTransport) return null;

  // Desktop only, now. The mobile floating pill that used to render beside this
  // was deleted on 2026-09-07 (Karl: "I think I want to remove the floating pill
  // all together... add transport controls right under the spectrum analyzer and
  // song progress bar on mobile"). Phone transport lives in HomeHero, in the
  // card, under the waveform — not floating over the page.
  return <DesktopBar />;
}

// -------------------------------------------------------------------------
// Desktop (md+): the classic full-width bottom transport bar. It is `hidden
// md:block`, so it is the ONLY thing this file renders and it never appears on
// a phone.
//
// Mobile used to get a draggable floating pill here — ~900 lines of edge
// anchoring, pointer-drag, hold-to-grab, safe-area insets and position
// persistence, all so a transport could hover over the page. Karl removed it on
// 2026-09-07: "I think I want to remove the floating pill all together... add
// transport controls right under the spectrum analyzer and song progress bar on
// mobile." Phone transport now lives in src/components/HomeHero.tsx, inside the
// card, under the waveform, where it cannot cover anything.
//
// If a persistent mobile transport is ever wanted again, do NOT resurrect the
// pill from git history: it existed because the controls had nowhere else to
// live, and now they have somewhere.
// -------------------------------------------------------------------------
function DesktopBar() {
  const {
    current,
    isPlaying,
    isLoading,
    currentTime,
    duration,
    volume,
    error,
    isSample,
    hasNext,
    hasPrev,
    radioMode,
    radioLoading,
    startRadio,
    stopRadio,
    togglePlay,
    next,
    prev,
    seek,
    setVolume,
  } = usePlayer();

  const fraction = duration > 0 ? currentTime / duration : 0;

  return (
    <div
      // translate3d + will-change force the desktop bar onto its own compositor
      // layer. Without this promotion, iOS Safari and WKWebView repaint the
      // fixed bar on the same layer as the scrolling <main> and it shears with
      // momentum scroll — the pill appears to grab lines of text before
      // snapping back to its anchor.
      className="hidden md:block fixed bottom-0 inset-x-0 z-50 overflow-hidden border-t border-brand-border bg-brand-surface/95 backdrop-blur"
      style={{ transform: "translate3d(0,0,0)", willChange: "transform" }}
    >
      {/* The free-preview upgrade banner used to live here. It announced a
          30-second preview and a monthly Superfan tier, and it was the most
          exposed purchase call to action in the product — which is why it
          carried data-native-hide for App Review.

          Both the preview and the tier are gone: #352 made every track play in
          full for every member and #357 removed the last of the pricing copy.
          The stream routes now return sample:false unconditionally, so
          `sampleEnded` could never become true and this block was already
          unreachable. Removed rather than left as dead code advertising a
          product that does not exist. */}
      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-2 flex flex-col gap-1.5">
        {/* Top row: track info + controls */}
        <div className="flex items-center gap-3">
          {/* Track info */}
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {current ? (
              <>
                <CoverImage
                  src={current.coverUrl}
                  alt={current.title}
                  className="h-11 w-11 shrink-0"
                  rounded="rounded"
                />
                <div className="min-w-0">
                  <p className="flex items-center gap-2 truncate text-sm font-medium text-text-primary">
                    <span className="truncate">{current.title}</span>
                    {radioMode && (
                      <span className="shrink-0 rounded-full bg-brand-primary/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-primary">
                        Radio
                      </span>
                    )}
                    {isSample && (
                      <span className="shrink-0 rounded-full bg-brand-primary/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-primary">
                        Preview
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-text-secondary">
                    {error ?? current.artistName ?? "MELORI MUSIC"}
                  </p>
                </div>
              </>
            ) : (
              <span className="text-sm text-text-secondary">
                Select a track to start listening
              </span>
            )}
          </div>

          {/* Transport controls */}
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={prev}
              disabled={!current || !hasPrev}
              aria-label="Previous track"
              className="flex h-9 w-9 items-center justify-center rounded-full text-text-secondary transition-colors hover:text-brand-primary disabled:opacity-30"
            >
              <PrevIcon />
            </button>

            <button
              type="button"
              onClick={togglePlay}
              disabled={!current}
              aria-label={isPlaying ? "Pause" : "Play"}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-primary text-white transition-colors hover:bg-brand-primary-dark disabled:opacity-40"
            >
              {isLoading ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                <PlayPauseIcon playing={isPlaying} />
              )}
            </button>

            <button
              type="button"
              onClick={next}
              disabled={!current || !hasNext}
              aria-label="Next track"
              className="flex h-9 w-9 items-center justify-center rounded-full text-text-secondary transition-colors hover:text-brand-primary disabled:opacity-30"
            >
              <NextIcon />
            </button>

            {/* Radio on/off toggle — turns the whole catalog into a non-stop
                shuffle right here in the bar (no separate page). Highlighted
                when active. */}
            <button
              type="button"
              onClick={() => (radioMode ? stopRadio() : startRadio("all"))}
              aria-label={radioMode ? "Turn radio off" : "Turn radio on"}
              aria-pressed={radioMode}
              title={radioMode ? "Radio on — tap to stop" : "Turn on Radio (non-stop shuffle)"}
              className={`flex h-9 items-center gap-1.5 rounded-full px-2.5 transition-colors ${
                radioMode
                  ? "bg-brand-primary/20 text-brand-primary"
                  : "text-text-secondary hover:text-brand-primary"
              }`}
            >
              {radioLoading ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-primary/40 border-t-brand-primary" />
              ) : (
                <RadioIcon />
              )}
              <span className="hidden text-xs font-semibold sm:inline">Radio</span>
            </button>

            {/* Volume — hidden on very small screens */}
            <div className="ml-1 hidden items-center gap-2 sm:flex">
              <span className="text-text-secondary">
                <VolumeIcon />
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                aria-label="Volume"
                className="h-1 w-20 cursor-pointer appearance-none rounded-full bg-brand-muted"
                style={{ accentColor: "#ff5500" }}
              />
            </div>
          </div>
        </div>

        {/* Bottom row: seekable progress bar with times */}
        <div className="flex items-center gap-2">
          <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-text-secondary">
            {formatTime(currentTime)}
          </span>
          <button
            type="button"
            aria-label="Seek"
            disabled={!current || duration <= 0}
            onClick={(e) => {
              if (!current) return;
              const rect = e.currentTarget.getBoundingClientRect();
              seek((e.clientX - rect.left) / rect.width);
            }}
            className="group relative h-3 flex-1 cursor-pointer"
          >
            <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-brand-muted" />
            <span
              className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-brand-primary"
              style={{ width: `${Math.min(100, Math.max(0, fraction * 100))}%` }}
            />
            <span
              className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-primary opacity-0 transition-opacity group-hover:opacity-100"
              style={{ left: `${Math.min(100, Math.max(0, fraction * 100))}%` }}
            />
          </button>
          <span className="w-9 shrink-0 text-[11px] tabular-nums text-text-secondary">
            {formatTime(duration)}
          </span>
        </div>
      </div>
    </div>
  );
}
