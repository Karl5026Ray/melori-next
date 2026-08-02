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

function ChevronIcon({ down }: { down: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-4 w-4 transition-transform ${down ? "rotate-180" : ""}`}
      aria-hidden
    >
      <path d="M6 15l6-6 6 6" />
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

  // The Radio page renders full-size controls for the same shared player, so
  // the floating transport there would just be a duplicate set of buttons.
  // Only the UI is hidden — the audio keeps playing from PlayerProvider.
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
// Mobile (< md): the floating transport pill.
//   - Collapsed = a horizontal pill: white circle handle on the LEFT, cover +
//     track text in the middle, play/pause on the RIGHT (usable while closed).
//   - The white circle is the only gesture surface: a clean tap toggles the
//     pill open/closed, a tap-and-hold (or a grab past the move threshold)
//     engages drag mode with a single haptic pulse and moves it anywhere.
//   - Expanded = the same pill grown into a panel with the full transport:
//     cover art, title/artist, prev / play / next / radio, a seek scrubber,
//     volume, and a close button.
// Every control drives the one shared engine in PlayerProvider — this file
// renders views of that player and never touches an <audio> element itself.
// Hand-rolled with pointer events + translate3d per the design consult — no
// drag library, no animating top/left.
// -------------------------------------------------------------------------
const POS_KEY = "melori:player:pos";
const MARGIN = 8;
// Height of the fixed mobile tab bar (h-14). Reserved below the pill, on top
// of whatever the home-indicator safe-area inset reports, so the pill can
// never park behind the nav.
const TAB_BAR = 56;
// Footprint assumed before the element has been measured (first clamp on
// mount, and any clamp while the ref is detached).
const PILL_W = 240;
const PILL_H = 56;
// Thresholds that disambiguate tap / hold-drag / grab-drag.
const MOVE_THRESHOLD = 10;
const HOLD_MS = 400;

// Fire a short haptic buzz on capable devices. Silent no-op elsewhere; the
// try/catch guards against Permissions-Policy denials that would otherwise
// throw. Mirrors the haptics used on the discover feed and filter taps.
function buzz(ms = 12) {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(ms);
  } catch {
    /* ignore */
  }
}

function getViewport() {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  return {
    w: vv?.width ?? (typeof window !== "undefined" ? window.innerWidth : 0),
    h: vv?.height ?? (typeof window !== "undefined" ? window.innerHeight : 0),
  };
}

interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

// Resolve the iOS safe-area insets in pixels. `env()` is only usable from CSS,
// so we let the engine resolve it as padding on a throwaway probe and read the
// computed values back. The layout sets viewportFit:"cover", which is what
// makes these non-zero on notched devices — without honouring them the pill
// can be dropped under the home indicator or the rounded-corner bezel.
function readInsets(): Insets {
  if (typeof document === "undefined" || !document.body) return NO_INSETS;
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;" +
    "padding-top:env(safe-area-inset-top);padding-right:env(safe-area-inset-right);" +
    "padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);";
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const insets: Insets = {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
  };
  probe.remove();
  return insets;
}

function FloatingPlayer() {
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

  const ref = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<HTMLButtonElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  // Mirror of pos read synchronously inside pointer handlers (state lags a tick).
  const posRef = useRef(pos);
  posRef.current = pos;
  // Safe-area insets, re-read whenever the viewport geometry can change.
  const insetsRef = useRef<Insets>(NO_INSETS);
  // Where the listener parked the pill. `pos` is what's on screen and can
  // differ while the wider expanded panel is open; the dock is what the
  // collapsed pill always returns to, and what gets persisted.
  const dockRef = useRef({ x: 0, y: 0 });

  // Clamp a candidate position so the whole pill stays inside the visual
  // viewport (accurate on mobile Safari, where the URL bar changes innerHeight),
  // clear of the notch/bezel insets and of the fixed mobile tab bar.
  const clampPos = useCallback((x: number, y: number) => {
    const el = ref.current;
    const w = el?.offsetWidth || PILL_W;
    const h = el?.offsetHeight || PILL_H;
    const vp = getViewport();
    const i = insetsRef.current;
    const minX = MARGIN + i.left;
    const minY = MARGIN + i.top;
    const maxX = Math.max(minX, vp.w - w - MARGIN - i.right);
    const maxY = Math.max(minY, vp.h - h - MARGIN - TAB_BAR - i.bottom);
    return {
      x: Math.min(Math.max(minX, x), maxX),
      y: Math.min(Math.max(minY, y), maxY),
    };
  }, []);

  // Project the dock onto the screen for the current state. Expanding must
  // never move the dock itself, otherwise collapsing again would leave the pill
  // wherever the wider panel happened to fit.
  const layout = useCallback(() => {
    const dock = dockRef.current;
    const w = ref.current?.offsetWidth || PILL_W;
    const vp = getViewport();
    // Expanding near the right edge: mirror to the opposite edge instead of
    // letting the wider panel get slammed inward ("popped to the left").
    const x = expanded && dock.x + w + MARGIN > vp.w ? MARGIN : dock.x;
    setPos(clampPos(x, dock.y));
  }, [clampPos, expanded]);

  // Mount: restore the saved position or default to the bottom-right dock.
  useEffect(() => {
    insetsRef.current = readInsets();
    setMounted(true);
    let saved: { x: number; y: number } | null = null;
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)) {
          saved = { x: parsed.x, y: parsed.y };
        }
      }
    } catch {
      /* ignore malformed storage */
    }
    // Clamping a deliberately out-of-range fallback docks the pill bottom-right
    // using its real measured size, with no duplicate inset arithmetic here.
    const start = saved ?? { x: Number.MAX_SAFE_INTEGER, y: Number.MAX_SAFE_INTEGER };
    const docked = clampPos(start.x, start.y);
    dockRef.current = docked;
    setPos(docked);
  }, [clampPos]);

  // Re-clamp when the viewport changes (rotation, URL-bar show/hide). Rotation
  // also swaps which edge carries the notch, so the insets are re-read too.
  useEffect(() => {
    const onResize = () => {
      insetsRef.current = readInsets();
      dockRef.current = clampPos(dockRef.current.x, dockRef.current.y);
      layout();
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, [clampPos, layout]);

  // Re-project after expand/collapse: the footprint changes, so the panel may
  // need mirroring and the collapsed pill must land back on its dock.
  useEffect(() => {
    if (!mounted) return;
    // Wait a frame so ref.current reflects the new (expanded/collapsed) size.
    const id = requestAnimationFrame(layout);
    return () => cancelAnimationFrame(id);
  }, [mounted, layout]);

  // Gesture state for the white circle handle — the ONLY drag surface. Keeping
  // it off the container is what lets every other control (play/pause, seek,
  // volume) stay a plain button: they can't arm a drag, and a drag can never
  // swallow their taps (the #180 "player got stuck" failure mode).
  const gesture = useRef({
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    active: false, // a pointer is down on the handle
    armed: false, // hold timer fired → this gesture is a drag, never a tap
    dragging: false, // actively moving
    moved: false, // travelled past the move threshold
    buzzed: false, // engage haptic already fired for this gesture
    timer: 0 as ReturnType<typeof setTimeout> | 0,
  });

  // Fire the "drag mode engaged" haptic exactly once per gesture, whether drag
  // engaged via the hold timer or by dragging past the move threshold.
  const engageHaptic = () => {
    const g = gesture.current;
    if (g.buzzed) return;
    g.buzzed = true;
    buzz();
  };

  const resetGesture = () => {
    const g = gesture.current;
    clearTimeout(g.timer);
    g.timer = 0;
    g.active = false;
    g.armed = false;
    g.dragging = false;
    g.moved = false;
    g.buzzed = false;
    setDragging(false);
  };

  const onHandlePointerDown = (e: React.PointerEvent) => {
    // Secondary mouse buttons open context menus; they must not grab the pill.
    if (e.button > 0) return;
    const g = gesture.current;
    g.startX = e.clientX;
    g.startY = e.clientY;
    g.originX = posRef.current.x;
    g.originY = posRef.current.y;
    g.active = true;
    g.armed = false;
    g.dragging = false;
    g.moved = false;
    g.buzzed = false;
    clearTimeout(g.timer);
    g.timer = setTimeout(() => {
      // Tap-and-hold: arm drag mode and pulse so the user feels the pill is now
      // grabbable, even before they start moving.
      if (!g.active || g.dragging) return;
      g.armed = true;
      engageHaptic();
      setDragging(true);
    }, HOLD_MS);
  };

  const onHandlePointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g.active) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (Math.hypot(dx, dy) > MOVE_THRESHOLD) g.moved = true;

    if (g.dragging) {
      setPos(clampPos(g.originX + dx, g.originY + dy));
      return;
    }
    // Drag begins on either signal: the hold timer armed us, or the finger
    // travelled past the move threshold (grab-and-drag, from #185). Claim the
    // pointer NOW rather than on pointerdown — capturing every press is what
    // left stale captures that swallowed the next tap in #180.
    if (g.armed || g.moved) {
      clearTimeout(g.timer);
      g.timer = 0;
      g.armed = true;
      g.dragging = true;
      engageHaptic();
      try {
        handleRef.current?.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      setDragging(true);
      setPos(clampPos(g.originX + dx, g.originY + dy));
    }
  };

  const releaseCapture = (pointerId: number) => {
    try {
      handleRef.current?.releasePointerCapture(pointerId);
    } catch {
      /* ignore */
    }
  };

  const onHandlePointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g.active) return;
    releaseCapture(e.pointerId);
    if (g.dragging) {
      // Drop wherever the finger let go — the pill lives anywhere the listener
      // parks it — then persist the clamped result.
      const final = clampPos(posRef.current.x, posRef.current.y);
      dockRef.current = final;
      setPos(final);
      try {
        localStorage.setItem(POS_KEY, JSON.stringify(final));
      } catch {
        /* ignore */
      }
    } else if (!g.armed && !g.moved) {
      // Clean tap: quick press + release, no hold, no movement → toggle open.
      // A hold that armed drag mode (even without moving) is NOT a tap.
      setExpanded((v) => !v);
    }
    resetGesture();
  };

  // pointercancel (OS gesture, scroll takeover) and a force-released capture
  // both abandon the gesture: reset without toggling, so a stale capture can
  // never linger and swallow the next tap (the #180 failure mode).
  const onHandlePointerCancel = (e: React.PointerEvent) => {
    releaseCapture(e.pointerId);
    resetGesture();
  };

  const trackLabel = current ? current.title : "Nothing playing";
  const artistLabel = error ?? current?.artistName ?? "MELORI MUSIC";

  // The white circle: tap toggles open/closed, hold drags. Rendered in both
  // states so the drag surface never disappears once the panel is open.
  const dragHandle = (
    <button
      ref={handleRef}
      type="button"
      data-testid="player-handle"
      aria-label="Player handle"
      aria-expanded={expanded}
      title="Tap to open or close · hold to drag"
      onPointerDown={onHandlePointerDown}
      onPointerMove={onHandlePointerMove}
      onPointerUp={onHandlePointerUp}
      onPointerCancel={onHandlePointerCancel}
      onLostPointerCapture={resetGesture}
      // Keyboard-generated clicks report detail 0; pointer clicks are already
      // handled by the gesture above, so this only serves Enter/Space.
      onClick={(e) => {
        if (e.detail === 0) setExpanded((v) => !v);
      }}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-black shadow-md ring-1 ring-black/10 transition-transform ${
        dragging ? "scale-105 cursor-grabbing" : "cursor-grab"
      }`}
      style={{
        touchAction: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
      }}
    >
      <ChevronIcon down={expanded} />
    </button>
  );

  return (
    <div
      ref={ref}
      role="region"
      aria-label="Music player"
      // z-[80] when expanded keeps controls above the mobile tab bar (z-[70])
      // and its launcher sheet — otherwise the X and transport row sit BEHIND
      // the nav and can't be tapped, which looked like "stuck, can't stop".
      className={`md:hidden fixed left-0 top-0 ${
        expanded ? "z-[80]" : "z-40"
      } select-none`}
      style={{
        transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
        WebkitUserSelect: "none",
        willChange: "transform",
        visibility: mounted ? "visible" : "hidden",
      }}
    >
      {expanded ? (
        <div className="w-[min(20rem,calc(100vw-1.25rem))] rounded-2xl border border-brand-border bg-brand-surface/95 p-3 shadow-2xl backdrop-blur">
          {/* Header: the same white circle handle (drag / close) + close X */}
          <div className="mb-2 flex items-center gap-2">
            {dragHandle}
            <button
              type="button"
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
              <p className="truncate text-xs text-text-secondary">{artistLabel}</p>
            </div>
          </div>

          {/* Transport */}
          <div className="mt-3 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={prev}
              disabled={!current || !hasPrev}
              aria-label="Previous track"
              className="flex h-10 w-10 items-center justify-center rounded-full text-text-secondary transition-colors hover:text-brand-primary disabled:opacity-30"
            >
              <PrevIcon />
            </button>
            <button
              type="button"
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
              onClick={next}
              disabled={!current || !hasNext}
              aria-label="Next track"
              className="flex h-10 w-10 items-center justify-center rounded-full text-text-secondary transition-colors hover:text-brand-primary disabled:opacity-30"
            >
              <NextIcon />
            </button>
            <button
              type="button"
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

          {/* Volume */}
          <div className="mt-2 flex items-center gap-2">
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
              className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-brand-muted"
              style={{ accentColor: "#ff5500" }}
            />
          </div>
        </div>
      ) : (
        // Collapsed pill: white circle handle | cover + track text | play/pause.
        <div className="flex h-14 max-w-[calc(100vw-1.25rem)] items-center gap-2 rounded-full border border-brand-border bg-brand-surface/95 px-1.5 shadow-2xl backdrop-blur">
          {dragHandle}
          <CoverImage
            src={current?.coverUrl}
            alt={trackLabel}
            className="h-9 w-9 shrink-0"
            rounded="rounded-full"
          />
          <div className="min-w-0 max-w-[7.5rem] flex-1">
            <p className="truncate text-xs font-medium leading-tight text-text-primary">
              {trackLabel}
            </p>
            <p className="truncate text-[11px] leading-tight text-text-secondary">
              {artistLabel}
            </p>
          </div>
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
        </div>
      )}
    </div>
  );
}
