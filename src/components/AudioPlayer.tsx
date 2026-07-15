"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import CoverImage from "@/components/CoverImage";
import { usePlayer } from "@/components/player/PlayerProvider";
import { formatTime } from "@/lib/format";

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

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

// Room screens (MM Faces live, MM Spaces rooms, MM Connect) own their audio and
// UI, so the floating music transport is hidden there and background music is
// paused on entry. Route patterns confirmed against src/app/social/*.
function isRoomRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname.startsWith("/social/live")) return true; // MM Faces (Duo/8-person)
  if (pathname.startsWith("/social/connect")) return true; // MM Connect
  // MM Spaces: only an actual room (/social/spaces/<id>), not the list or the
  // create form.
  const m = pathname.match(/^\/social\/spaces\/([^/]+)/);
  return Boolean(m && m[1] !== "create");
}

export default function AudioPlayer() {
  const { pause } = usePlayer();
  const pathname = usePathname();
  const onRadio = pathname?.startsWith("/social/radio");
  const inRoom = isRoomRoute(pathname);

  // Entering a live room pauses background music so it never fights the room's
  // own audio. Leaving does NOT auto-resume — the listener presses play again.
  useEffect(() => {
    if (inRoom) pause();
  }, [inRoom, pause]);

  // Melori Radio runs its own dual-deck player; a second global transport there
  // would be a confusing duplicate set of controls.
  if (onRadio) return null;
  // Hidden on room screens. The <audio> element lives in PlayerProvider (mounted
  // at the layout root), so playback state survives this component rendering null.
  if (inRoom) return null;

  return (
    <>
      <DesktopBar />
      <FloatingPlayer />
    </>
  );
}

// -------------------------------------------------------------------------
// Desktop (md+): the classic full-width bottom transport bar. Unchanged
// behaviour, now scoped to desktop since mobile uses the floating player.
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
    sampleEnded,
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
    <div className="hidden md:block fixed bottom-0 inset-x-0 z-50 overflow-hidden border-t border-brand-border bg-brand-surface/95 backdrop-blur">
      {/* Free-preview upgrade prompt — shown when a 30s sample ends. */}
      {current && sampleEnded && (
        <div className="border-b border-brand-border bg-brand-primary/10 px-3 sm:px-6 py-2">
          <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-text-secondary">
              You&apos;re hearing a 30-second preview. Become a Superfan to play
              full songs.
            </span>
            <Link
              href="/membership"
              className="shrink-0 rounded-full bg-brand-primary px-4 py-1.5 font-semibold text-black transition-opacity hover:opacity-90"
            >
              Upgrade — $2.99/mo
            </Link>
          </div>
        </div>
      )}
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

// -------------------------------------------------------------------------
// Mobile (< md): a draggable floating mini-player.
//   - Collapsed = a ~56px bubble (album art + play/pause).
//   - Tap the bubble to expand to the full transport; tap the close button
//     (or the bubble again) to collapse.
//   - Long-press (~300ms) then drag to move it anywhere; position persists.
// Hand-rolled with pointer events + translate3d per the design consult — no
// drag library, no animating top/left.
// -------------------------------------------------------------------------
const POS_KEY = "melori:player:pos";
const MARGIN = 8;
// Reserve for the fixed mobile tab bar (h-14 = 56px) plus the iOS home
// indicator so the player never parks underneath the nav.
const BOTTOM_RESERVE = 76;
const BUBBLE = 56;
// Movement thresholds that disambiguate tap / long-press-drag / scroll.
const MOVE_THRESHOLD = 10;
const LONG_PRESS_MS = 300;

function getViewport() {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  return {
    w: vv?.width ?? (typeof window !== "undefined" ? window.innerWidth : 0),
    h: vv?.height ?? (typeof window !== "undefined" ? window.innerHeight : 0),
  };
}

function FloatingPlayer() {
  const {
    current,
    isPlaying,
    isLoading,
    currentTime,
    duration,
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
  } = usePlayer();

  const fraction = duration > 0 ? currentTime / duration : 0;

  const ref = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  // Mirror of pos read synchronously inside pointer handlers (state lags a tick).
  const posRef = useRef(pos);
  posRef.current = pos;

  // Clamp a candidate position so the whole player stays inside the visual
  // viewport (accurate on mobile Safari, where the URL bar changes innerHeight).
  const clampPos = useCallback((x: number, y: number) => {
    const el = ref.current;
    const w = el?.offsetWidth ?? BUBBLE;
    const h = el?.offsetHeight ?? BUBBLE;
    const vp = getViewport();
    const maxX = Math.max(MARGIN, vp.w - w - MARGIN);
    const maxY = Math.max(MARGIN, vp.h - h - MARGIN - BOTTOM_RESERVE);
    return {
      x: Math.min(Math.max(MARGIN, x), maxX),
      y: Math.min(Math.max(MARGIN, y), maxY),
    };
  }, []);

  // Mount: restore saved position or default to the bottom-right corner.
  useEffect(() => {
    setMounted(true);
    let saved: { x: number; y: number } | null = null;
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch {
      /* ignore malformed storage */
    }
    const vp = getViewport();
    const fallback = {
      x: vp.w - BUBBLE - MARGIN,
      y: vp.h - BUBBLE - MARGIN - BOTTOM_RESERVE,
    };
    setPos(clampPos((saved ?? fallback).x, (saved ?? fallback).y));
  }, [clampPos]);

  // Re-clamp when the viewport changes (rotation, URL-bar show/hide).
  useEffect(() => {
    const onResize = () => setPos((p) => clampPos(p.x, p.y));
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, [clampPos]);

  // Re-clamp after expand/collapse since the footprint changes.
  useEffect(() => {
    if (mounted) setPos((p) => clampPos(p.x, p.y));
  }, [expanded, mounted, clampPos]);

  const gesture = useRef({
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    armed: false, // long-press timer fired → drag is now allowed
    dragging: false, // actively moving
    scrolling: false, // moved before long-press → user meant to scroll
    timer: 0 as ReturnType<typeof setTimeout> | 0,
  });

  const onPointerDown = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const g = gesture.current;
    g.startX = e.clientX;
    g.startY = e.clientY;
    g.originX = posRef.current.x;
    g.originY = posRef.current.y;
    g.armed = false;
    g.dragging = false;
    g.scrolling = false;
    clearTimeout(g.timer);
    g.timer = setTimeout(() => {
      g.armed = true;
      setDragging(true);
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (g.scrolling) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;

    if (g.dragging) {
      setPos(clampPos(g.originX + dx, g.originY + dy));
      return;
    }
    if (g.armed) {
      // Long-press already fired — the first movement starts the drag.
      g.dragging = true;
      setPos(clampPos(g.originX + dx, g.originY + dy));
      return;
    }
    // Still within the press window: a real move here means the user is
    // scrolling the page, so abandon the gesture and don't hijack the scroll.
    if (Math.hypot(dx, dy) > MOVE_THRESHOLD) {
      g.scrolling = true;
      clearTimeout(g.timer);
      try {
        ref.current?.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  };

  const endGesture = (e: React.PointerEvent) => {
    const g = gesture.current;
    clearTimeout(g.timer);
    try {
      ref.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (g.dragging) {
      // Snap to the nearest horizontal edge so it never blocks centre content.
      const el = ref.current;
      const w = el?.offsetWidth ?? BUBBLE;
      const vp = getViewport();
      const center = posRef.current.x + w / 2;
      const snappedX = center < vp.w / 2 ? MARGIN : vp.w - w - MARGIN;
      const final = clampPos(snappedX, posRef.current.y);
      setPos(final);
      try {
        localStorage.setItem(POS_KEY, JSON.stringify(final));
      } catch {
        /* ignore */
      }
    } else if (!g.scrolling) {
      // Clean tap (quick, or a hold with no movement) → toggle expand.
      setExpanded((v) => !v);
    }
    g.armed = false;
    g.dragging = false;
    g.scrolling = false;
    setDragging(false);
  };

  // Interactive children must not start a drag; swallow the pointerdown so the
  // container gesture never arms on them.
  const stop = (e: React.PointerEvent) => e.stopPropagation();

  const trackLabel = current ? current.title : "Nothing playing";

  return (
    <div
      ref={ref}
      role="region"
      aria-label="Music player"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      className={`md:hidden fixed left-0 top-0 z-40 cursor-grab select-none ${
        dragging ? "cursor-grabbing" : ""
      }`}
      style={{
        transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
        touchAction: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
        willChange: "transform",
        visibility: mounted ? "visible" : "hidden",
      }}
    >
      {expanded ? (
        <div className="w-[min(20rem,calc(100vw-1.25rem))] rounded-2xl border border-brand-border bg-brand-surface/95 p-3 shadow-2xl backdrop-blur">
          {/* Header: grip indicator (drag) + close */}
          <div className="mb-2 flex items-center">
            <span className="mx-auto h-1 w-8 rounded-full bg-brand-muted" aria-hidden />
            <button
              type="button"
              onPointerDown={stop}
              onClick={() => setExpanded(false)}
              aria-label="Collapse player"
              className="ml-auto flex h-8 w-8 items-center justify-center rounded-full text-text-secondary transition-colors hover:text-brand-primary"
            >
              <CloseIcon />
            </button>
          </div>

          {/* Track info */}
          <div className="flex items-center gap-3">
            <CoverImage
              src={current?.coverUrl}
              alt={trackLabel}
              className="h-12 w-12 shrink-0"
              rounded="rounded-lg"
            />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 truncate text-sm font-medium text-text-primary">
                <span className="truncate">{trackLabel}</span>
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
                {error ?? current?.artistName ?? "MELORI MUSIC"}
              </p>
            </div>
          </div>

          {/* Transport */}
          <div className="mt-3 flex items-center justify-center gap-2">
            <button
              type="button"
              onPointerDown={stop}
              onClick={prev}
              disabled={!current || !hasPrev}
              aria-label="Previous track"
              className="flex h-10 w-10 items-center justify-center rounded-full text-text-secondary transition-colors hover:text-brand-primary disabled:opacity-30"
            >
              <PrevIcon />
            </button>
            <button
              type="button"
              onPointerDown={stop}
              onClick={togglePlay}
              disabled={!current}
              aria-label={isPlaying ? "Pause" : "Play"}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-primary text-white transition-colors hover:bg-brand-primary-dark disabled:opacity-40"
            >
              {isLoading ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                <PlayPauseIcon playing={isPlaying} />
              )}
            </button>
            <button
              type="button"
              onPointerDown={stop}
              onClick={next}
              disabled={!current || !hasNext}
              aria-label="Next track"
              className="flex h-10 w-10 items-center justify-center rounded-full text-text-secondary transition-colors hover:text-brand-primary disabled:opacity-30"
            >
              <NextIcon />
            </button>
            <button
              type="button"
              onPointerDown={stop}
              onClick={() => (radioMode ? stopRadio() : startRadio("all"))}
              aria-label={radioMode ? "Turn radio off" : "Turn radio on"}
              aria-pressed={radioMode}
              className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
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
            </button>
          </div>

          {/* Seek */}
          <div className="mt-3 flex items-center gap-2">
            <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-text-secondary">
              {formatTime(currentTime)}
            </span>
            <button
              type="button"
              onPointerDown={stop}
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
            </button>
            <span className="w-9 shrink-0 text-[11px] tabular-nums text-text-secondary">
              {formatTime(duration)}
            </span>
          </div>
        </div>
      ) : (
        // Collapsed bubble: album art with a centred play/pause control. Tapping
        // the art ring expands; the play button toggles playback.
        <div className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border border-brand-border bg-brand-surface shadow-lg">
          <CoverImage
            src={current?.coverUrl}
            alt={trackLabel}
            className="absolute inset-0 h-full w-full"
            rounded="rounded-full"
          />
          <button
            type="button"
            onPointerDown={stop}
            onClick={togglePlay}
            disabled={!current}
            aria-label={isPlaying ? "Pause" : "Play"}
            className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/70 disabled:opacity-50"
          >
            {isLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              <PlayPauseIcon playing={isPlaying} />
            )}
          </button>
        </div>
      )}
    </div>
  );
}
