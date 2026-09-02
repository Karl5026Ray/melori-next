"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import CoverImage from "@/components/CoverImage";
import { usePlayer } from "@/components/player/PlayerProvider";
import { formatTime } from "@/lib/format";
import { isMediaRoomRoute } from "@/lib/mediaRoomRoute";
import { isTransportRoute } from "@/lib/transportRoute";

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

export default function AudioPlayer() {
  const { pause } = usePlayer();
  const pathname = usePathname();
  // The transport is a main-page control only (see lib/transportRoute.ts).
  // Every other space — music, store, social, studio, checkout, account,
  // photography, admin — renders no playback bar at all.
  const onMainPage = isTransportRoute(pathname);
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

  // Everywhere except the main page renders no transport. The <audio> element
  // lives in PlayerProvider (mounted at the layout root), so a track started
  // on the main page keeps playing as the listener browses — only the UI is
  // route-scoped. Pages that need controls (Radio) render their own.
  if (!onMainPage) return null;

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
    <div
      // translate3d + will-change force the desktop bar onto its own compositor
      // layer. Without this promotion, iOS Safari and WKWebView repaint the
      // fixed bar on the same layer as the scrolling <main> and it shears with
      // momentum scroll — the pill appears to grab lines of text before
      // snapping back to its anchor.
      className="hidden md:block fixed bottom-0 inset-x-0 z-50 overflow-hidden border-t border-brand-border bg-brand-surface/95 backdrop-blur"
      style={{ transform: "translate3d(0,0,0)", willChange: "transform" }}
    >
      {/* Free-preview upgrade prompt — shown when a 30s sample ends.
          data-native-hide: this is the single most exposed purchase call to
          action in the product. It fires the moment a 30-second preview ends,
          which is exactly what an App Review tester does first in a music app,
          and it carries both a plan name and a price ("Become a Superfan",
          "Upgrade — $2.99/mo"). The CSS route selectors in native-app.css hide
          the /membership anchor but not the sentence around it, so the whole
          banner is marked. See docs/ios-app-store-compliance.md. */}
      {current && sampleEnded && (
        <div data-native-hide className="border-b border-brand-border bg-brand-primary/10 px-3 sm:px-6 py-2">
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
//   - Expanded = the same pill grown into a panel with the full transport:
//     cover art, title/artist, prev / play / next / radio, a seek scrubber and
//     volume, under a full-width drag bar.
//   - ONE gesture surface per state, and it behaves identically in both: a
//     clean tap toggles open/closed, a tap-and-hold (or a grab past the move
//     threshold) engages drag mode with a haptic pulse and moves it anywhere.
//     Collapsed that surface is the white circle; expanded it is the ENTIRE
//     top bar, so the target is a full-width bar instead of a 44px circle.
//   - There is deliberately no X button. Tap-to-toggle works in both states,
//     so a separate close control was redundant surface area.
// Every control drives the one shared engine in PlayerProvider — this file
// renders views of that player and never touches an <audio> element itself.
// Hand-rolled with pointer events + translate3d per the design consult — no
// drag library, no animating top/left.
//
// Position model: a drop stores an EDGE ANCHOR (see `Dock` below) — which two
// viewport edges the pill was parked against, and the gap to each — and nothing
// except a drop ever writes it. The anchor is applied as CSS insets (`right` /
// `bottom`, or `left` / `top`), so when the pill's own footprint changes the
// BROWSER holds the anchored edges still, in the same layout pass as the resize.
// That is the whole reason it is done this way: repositioning in JS after a size
// change is always one commit late, which is visible as a jump. Only a live drag
// uses a transform, as a delta on top of the anchored base. Placed is placed.
// -------------------------------------------------------------------------
const POS_KEY = "melori:player:pos";
// Edge margin used ONLY by this mobile floating pill's positioning math below
// (default dock gap, drag clamp bounds, and the expand-panel edge cap). It is
// NOT a decorative CSS margin and it has no effect on <DesktopBar> above — the
// two are visually unrelated despite living in the same file. If you want more
// breathing room around the desktop transport bar, change spacing inside
// DesktopBar directly; do not repurpose this constant, or you will silently
// shift where the mobile pill parks, clamps, and snaps on expand (see PR #290).
const PILL_MARGIN = 8;
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

// ---------------------------------------------------------------------------
// Where the pill is parked, stored as an EDGE ANCHOR rather than an absolute
// top-left point.
//
// An absolute point cannot survive the things that change under it: the pill's
// own footprint changes when it expands or collapses, and the visual viewport
// changes constantly on mobile (Safari's URL bar, the software keyboard,
// rotation). Re-clamping an absolute point against each of those permanently
// rewrote the parked position, so the pill crept away from where the listener
// put it and the expanded panel teleported to the opposite edge.
//
// The anchor records which edges the pill was parked against and how far it sat
// from them (`dx`/`dy` are gaps, not coordinates). Every render re-derives the
// on-screen position from that gap using the CURRENT footprint and viewport, so
// the pill keeps the same visual relationship to its edges: it grows away from
// the edge it is parked against instead of jumping, and a transient viewport
// shrink can no longer destroy the listener's choice — when the viewport comes
// back, so does the pill, to the exact same place.
//
// Nothing but a drop writes an anchor. That is the whole contract: once placed,
// it stays until it is picked up and moved again.
// ---------------------------------------------------------------------------
type EdgeX = "left" | "right";
type EdgeY = "top" | "bottom";

interface Dock {
  ax: EdgeX;
  ay: EdgeY;
  // Gap in px between the anchored viewport edge and the pill's nearest edge.
  dx: number;
  dy: number;
}

// Expanded panel width, as CSS. Used by the panel itself AND by the horizontal
// safety clamp below, which needs to know the widest the element can get in
// order to keep it on screen without measuring anything.
const PANEL_W_CSS = "min(20rem, calc(100vw - 1.25rem))";

// Bottom-right, the first-run home. The gaps are the bare margins; clamping
// adds the notch insets, so there is no duplicate inset arithmetic here.
const DEFAULT_DOCK: Dock = {
  ax: "right",
  ay: "bottom",
  dx: PILL_MARGIN,
  dy: PILL_MARGIN + TAB_BAR,
};

// Persisted shape, versioned so an anchor is never mistaken for the legacy
// `{x, y}` point (which is migrated on first read — see `legacyPointRef`).
interface StoredDock extends Dock {
  v: 2;
}

function isEdgeX(v: unknown): v is EdgeX {
  return v === "left" || v === "right";
}
function isEdgeY(v: unknown): v is EdgeY {
  return v === "top" || v === "bottom";
}

// Parse whatever is in storage into either an anchor or a legacy absolute
// point. Anything unrecognised yields nulls and the caller falls back to
// DEFAULT_DOCK, so corrupt storage can never strand the pill off-screen.
function parseStoredPosition(raw: string | null): {
  dock: Dock | null;
  legacyPoint: { x: number; y: number } | null;
} {
  if (!raw) return { dock: null, legacyPoint: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { dock: null, legacyPoint: null };
  }
  if (!parsed || typeof parsed !== "object") {
    return { dock: null, legacyPoint: null };
  }
  const o = parsed as Record<string, unknown>;
  if (
    isEdgeX(o.ax) &&
    isEdgeY(o.ay) &&
    Number.isFinite(o.dx) &&
    Number.isFinite(o.dy)
  ) {
    return {
      dock: {
        ax: o.ax,
        ay: o.ay,
        dx: Math.max(0, o.dx as number),
        dy: Math.max(0, o.dy as number),
      },
      legacyPoint: null,
    };
  }
  if (Number.isFinite(o.x) && Number.isFinite(o.y)) {
    // Written by the pre-anchor build: an absolute top-left point. It is
    // converted to an anchor once the pill has been measured.
    return {
      dock: null,
      legacyPoint: { x: o.x as number, y: o.y as number },
    };
  }
  return { dock: null, legacyPoint: null };
}

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
  // The live drag surface. Only one is mounted at a time (circle when
  // collapsed, top bar when expanded), so a single ref serves both.
  const handleRef = useRef<HTMLButtonElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  // The anchor currently rendered as CSS insets. Normally identical to the
  // parked anchor below; it only differs while a viewport is too small to honour
  // the parked gaps, and it goes straight back when the space returns.
  const [dock, setDock] = useState<Dock>(DEFAULT_DOCK);
  // Live drag offset from the anchored base, applied as a transform so a drag
  // never triggers layout. Zero whenever a drag isn't in flight.
  const [drag, setDrag] = useState({ dx: 0, dy: 0 });
  // Mirror of `drag`, read synchronously on pointerup (state lags a tick).
  const dragRef = useRef(drag);
  dragRef.current = drag;
  // Safe-area insets, re-read whenever the viewport geometry can change.
  const insetsRef = useRef<Insets>(NO_INSETS);
  // Where the listener parked the pill. This is the intent, the thing that gets
  // persisted, and it is written ONLY by a drop (plus the one-time migration of
  // a legacy stored point). Expanding, collapsing, rotating and Safari's URL bar
  // never touch it.
  const dockRef = useRef<Dock>(DEFAULT_DOCK);
  // A legacy `{x, y}` read out of storage, converted to an anchor on the first
  // frame after mount — the conversion needs the pill's measured footprint.
  const legacyPointRef = useRef<{ x: number; y: number } | null>(null);

  // Clamp a candidate position so the whole pill stays inside the visual
  // viewport (accurate on mobile Safari, where the URL bar changes innerHeight),
  // clear of the notch/bezel insets and of the fixed mobile tab bar.
  const clampPos = useCallback((x: number, y: number, width?: number, height?: number) => {
    const el = ref.current;
    const w = width || el?.offsetWidth || PILL_W;
    const h = height || el?.offsetHeight || PILL_H;
    const vp = getViewport();
    const i = insetsRef.current;
    const minX = PILL_MARGIN + i.left;
    const minY = PILL_MARGIN + i.top;
    const maxX = Math.max(minX, vp.w - w - PILL_MARGIN - i.right);
    const maxY = Math.max(minY, vp.h - h - PILL_MARGIN - TAB_BAR - i.bottom);
    return {
      x: Math.min(Math.max(minX, x), maxX),
      y: Math.min(Math.max(minY, y), maxY),
    };
  }, []);

  // On-screen rect -> anchor. Each axis anchors to whichever edge the pill's
  // centre is nearer, so "parked bottom-right" survives a rotation as
  // "bottom-right" rather than as two stale pixel offsets.
  const dockFromRect = useCallback(
    (x: number, y: number, w: number, h: number): Dock => {
      const vp = getViewport();
      const ax: EdgeX = x + w / 2 <= vp.w / 2 ? "left" : "right";
      const ay: EdgeY = y + h / 2 <= vp.h / 2 ? "top" : "bottom";
      return {
        ax,
        ay,
        dx: ax === "left" ? Math.max(0, x) : Math.max(0, vp.w - (x + w)),
        dy: ay === "top" ? Math.max(0, y) : Math.max(0, vp.h - (y + h)),
      };
    },
    [],
  );

  // Safety net, not a layout pass: MEASURE where the browser actually put the
  // pill and only intervene if part of it is off-screen or behind the tab bar.
  // In the ordinary case — including every expand and collapse — it measures,
  // finds nothing wrong, and writes no state at all, which is what keeps the
  // pill perfectly still. Where it does act (a viewport too small to honour the
  // parked gaps) it adjusts the DISPLAY anchor only; the parked anchor is
  // untouched, so the pill returns to it when the space comes back.
  const clampDisplay = useCallback(() => {
    const el = ref.current;
    if (!el || gesture.current.dragging) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const vp = getViewport();
    const i = insetsRef.current;
    const minX = PILL_MARGIN + i.left;
    const minY = PILL_MARGIN + i.top;
    const maxX = Math.max(minX, vp.w - r.width - PILL_MARGIN - i.right);
    const maxY = Math.max(minY, vp.h - r.height - PILL_MARGIN - TAB_BAR - i.bottom);
    const x = Math.min(Math.max(minX, r.x), maxX);
    const y = Math.min(Math.max(minY, r.y), maxY);
    if (Math.abs(x - r.x) < 0.5 && Math.abs(y - r.y) < 0.5) return;
    const { ax, ay } = dockRef.current;
    setDock({
      ax,
      ay,
      dx: ax === "left" ? x : Math.max(0, vp.w - (x + r.width)),
      dy: ay === "top" ? y : Math.max(0, vp.h - (y + r.height)),
    });
  }, []);

  // Mount: restore the parked anchor and reveal the pill. The element is
  // `visibility: hidden` until this runs, so the default anchor is never seen
  // before the saved one replaces it.
  useEffect(() => {
    insetsRef.current = readInsets();
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(POS_KEY);
    } catch {
      /* storage unavailable — fall back to the default dock */
    }
    const { dock: saved, legacyPoint } = parseStoredPosition(raw);
    if (saved) {
      dockRef.current = saved;
      setDock(saved);
    }
    legacyPointRef.current = legacyPoint;
    setMounted(true);
  }, []);

  // One-time migration of a position saved by the pre-anchor build: an absolute
  // top-left point. Converting it needs the pill's measured size, so it happens
  // on the first frame after mount, and the result is written back to storage in
  // the new shape so this never runs again.
  useEffect(() => {
    if (!mounted) return;
    const legacy = legacyPointRef.current;
    if (!legacy) return;
    const id = requestAnimationFrame(() => {
      legacyPointRef.current = null;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const migrated = dockFromRect(legacy.x, legacy.y, r.width, r.height);
      dockRef.current = migrated;
      setDock(migrated);
      try {
        const stored: StoredDock = { v: 2, ...migrated };
        localStorage.setItem(POS_KEY, JSON.stringify(stored));
      } catch {
        /* ignore */
      }
    });
    return () => cancelAnimationFrame(id);
  }, [mounted, dockFromRect]);

  // Viewport changes (rotation, URL-bar show/hide, software keyboard) are the
  // one place the pill is allowed to move on its own, and only because the space
  // it was parked in may no longer exist. Restore the parked anchor first, then
  // clamp what is actually on screen — so a shrink nudges it into view and the
  // matching grow puts it back exactly where the listener left it. Rotation also
  // swaps which edge carries the notch, so the insets are re-read.
  useEffect(() => {
    if (!mounted) return;
    const onResize = () => {
      insetsRef.current = readInsets();
      setDock(dockRef.current);
      requestAnimationFrame(clampDisplay);
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, [mounted, clampDisplay]);

  // Expanding grows the panel away from its anchored edges, which the CSS
  // handles on its own. This only catches the pathological case where the panel
  // is taller than the room it has, and does nothing otherwise.
  useEffect(() => {
    if (!mounted) return;
    const id = requestAnimationFrame(clampDisplay);
    return () => cancelAnimationFrame(id);
  }, [mounted, expanded, clampDisplay]);

  // Gesture state for the drag surface — the ONLY place a drag can start.
  // Keeping it off the container is what lets every other control (play/pause,
  // seek, volume) stay a plain button: they can't arm a drag, and a drag can
  // never swallow their taps (the #180 "player got stuck" failure mode). The
  // expanded top bar is wide, but it is still a single dedicated surface with
  // no interactive children, so that guarantee is unchanged.
  const gesture = useRef({
    startX: 0,
    startY: 0,
    // The pill's measured rect at the moment the pointer went down. The drag is
    // expressed as an offset from this, so the anchored CSS base is never
    // recomputed mid-gesture.
    originX: 0,
    originY: 0,
    originW: PILL_W,
    originH: PILL_H,
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

  // Pointer delta -> transform offset, clamped so the pill can't be dragged
  // off-screen. Measured against the rect captured on pointerdown, which is
  // exactly what the transform is relative to.
  const dragOffset = (dx: number, dy: number) => {
    const g = gesture.current;
    const target = clampPos(g.originX + dx, g.originY + dy, g.originW, g.originH);
    return { dx: target.x - g.originX, dy: target.y - g.originY };
  };

  const onHandlePointerDown = (e: React.PointerEvent) => {
    // Secondary mouse buttons open context menus; they must not grab the pill.
    if (e.button > 0) return;
    const g = gesture.current;
    g.startX = e.clientX;
    g.startY = e.clientY;
    const r = ref.current?.getBoundingClientRect();
    g.originX = r?.x ?? 0;
    g.originY = r?.y ?? 0;
    g.originW = r?.width || PILL_W;
    g.originH = r?.height || PILL_H;
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
      setDrag(dragOffset(dx, dy));
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
      setDrag(dragOffset(dx, dy));
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
      // parks it. This is the ONLY place an anchor is written: the drop point is
      // clamped on screen, converted to edge gaps, and persisted. Everything
      // afterwards re-derives from it, so the pill stays put until it is picked
      // up again.
      const d = dragRef.current;
      const dropped = dockFromRect(
        g.originX + d.dx,
        g.originY + d.dy,
        g.originW,
        g.originH,
      );
      dockRef.current = dropped;
      // Both writes land in one commit, so the transform is dropped and the new
      // anchored insets take over in the same frame — no flicker back to the
      // old spot on the way to the new one.
      setDock(dropped);
      setDrag({ dx: 0, dy: 0 });
      try {
        const stored: StoredDock = { v: 2, ...dropped };
        localStorage.setItem(POS_KEY, JSON.stringify(stored));
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

  // Everything that makes an element the drag surface. Shared verbatim by the
  // collapsed circle and the expanded top bar so the two states cannot drift:
  // tap toggles open/closed, press-and-hold drags, in both.
  const dragSurfaceProps = {
    ref: handleRef,
    type: "button" as const,
    "data-testid": "player-handle",
    "aria-label": expanded ? "Player handle — tap to close, hold to drag" : "Player handle — tap to open, hold to drag",
    "aria-expanded": expanded,
    title: "Tap to open or close · hold to drag",
    onPointerDown: onHandlePointerDown,
    onPointerMove: onHandlePointerMove,
    onPointerUp: onHandlePointerUp,
    onPointerCancel: onHandlePointerCancel,
    onLostPointerCapture: resetGesture,
    // Keyboard-generated clicks report detail 0; pointer clicks are already
    // handled by the gesture above, so this only serves Enter/Space. With the
    // X button gone this is the sole keyboard route to closing the panel.
    onClick: (e: React.MouseEvent) => {
      if (e.detail === 0) setExpanded((v) => !v);
    },
    style: {
      touchAction: "none" as const,
      WebkitUserSelect: "none" as const,
      WebkitTouchCallout: "none" as const,
    },
  };

  // Collapsed: the white circle on the left of the pill.
  const collapsedHandle = (
    <button
      {...dragSurfaceProps}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-black shadow-md ring-1 ring-black/10 transition-transform ${
        dragging ? "scale-105 cursor-grabbing" : "cursor-grab"
      }`}
    >
      <ChevronIcon down={expanded} />
    </button>
  );

  // Expanded: the WHOLE top bar is the handle. Same gesture contract, ~7x the
  // touch area of the circle it replaces. It has no interactive children, so
  // there are no control taps for the enlarged region to swallow — the real
  // transport controls all live below it.
  const expandedDragBar = (
    <button
      {...dragSurfaceProps}
      className={`relative mb-2 flex h-11 w-full items-center justify-center rounded-xl transition-colors ${
        dragging ? "cursor-grabbing bg-white/10" : "cursor-grab hover:bg-white/5"
      }`}
    >
      {/* Grabber: the visible "you can drag this" affordance. */}
      <span
        aria-hidden
        className={`h-1.5 w-10 rounded-full transition-colors ${
          dragging ? "bg-white" : "bg-white/40"
        }`}
      />
      {/* Chevron parked on the right so tap-to-close stays discoverable. It is
          decoration inside the same button, never a separate hit target. */}
      <span aria-hidden className="absolute right-2 text-text-secondary">
        <ChevronIcon down={expanded} />
      </span>
    </button>
  );

  // Anchored insets. The horizontal gap is additionally capped in CSS while
  // expanded: the panel is the widest this element ever gets, and its width is
  // known to CSS (PANEL_W_CSS), so the browser can keep the far edge on screen
  // by itself — no measure-then-move, therefore no visible correction.
  const inset = `${dock.dx}px`;
  const insetCapped = expanded
    ? `min(${inset}, calc(100vw - ${PANEL_W_CSS} - ${PILL_MARGIN}px))`
    : inset;
  const anchorStyle: React.CSSProperties =
    dock.ax === "left"
      ? { left: insetCapped, right: "auto" }
      : { right: insetCapped, left: "auto" };
  if (dock.ay === "top") {
    anchorStyle.top = `${dock.dy}px`;
    anchorStyle.bottom = "auto";
  } else {
    anchorStyle.bottom = `${dock.dy}px`;
    anchorStyle.top = "auto";
  }

  return (
    <div
      ref={ref}
      role="region"
      aria-label="Music player"
      data-testid="floating-player"
      // z-[80] when expanded keeps controls above the mobile tab bar (z-[70])
      // and its launcher sheet — otherwise the drag bar and transport row sit
      // BEHIND the nav and can't be tapped ("stuck, can't stop").
      className={`md:hidden fixed ${
        expanded ? "z-[80]" : "z-40"
      } select-none`}
      style={{
        // The anchored edges, as CSS. Because the position is expressed as a
        // distance from these edges rather than as a top-left point, the browser
        // keeps them fixed when the panel expands or collapses — the pill grows
        // and shrinks in place instead of being re-placed a frame later.
        ...anchorStyle,
        // translate3d(0,0,0) as the base keeps the pill on its own compositor
        // layer at all times so momentum-scrolling the feed underneath cannot
        // drag the pill's paint with it. Without this the fixed pill would
        // visibly latch onto lines of text for a frame during rubber-band
        // scroll on iOS/WKWebView, then snap back.
        transform: dragging
          ? `translate3d(${drag.dx}px, ${drag.dy}px, 0)`
          : "translate3d(0,0,0)",
        willChange: "transform",
        WebkitUserSelect: "none",
        visibility: mounted ? "visible" : "hidden",
      }}
    >
      {expanded ? (
        <div
          data-testid="player-panel"
          style={{ width: PANEL_W_CSS }}
          className="rounded-2xl border border-brand-border bg-brand-surface/95 p-3 shadow-2xl backdrop-blur"
        >
          {/* Header: the full-width drag bar. Tap anywhere on it to close. */}
          {expandedDragBar}

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
          {collapsedHandle}
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
