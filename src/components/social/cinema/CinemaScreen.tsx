"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Link2,
  Loader2,
  Clapperboard,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { useCinemaPlayback } from "./useCinemaPlayback";
import {
  classifySource,
  formatTimecode,
  planCorrection,
  targetPosition,
} from "@/lib/cinemaPlayback";

/**
 * The shared screen at the top of a Cinema room.
 *
 * The host drives; guests follow. A guest's own player controls are
 * deliberately absent — not hidden, absent — because a shared screen where
 * anyone can scrub is not a shared screen. Guests get volume and fullscreen,
 * which are genuinely personal, and nothing that moves the room.
 */
export function CinemaScreen({
  spaceId,
  isHost,
}: {
  spaceId: string;
  isHost: boolean;
}) {
  const { state, loading, error, clockOffsetMs, push, reportLocalPosition } =
    useCinemaPlayback(spaceId, isHost);

  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [localPosition, setLocalPosition] = useState(0);
  const [muted, setMuted] = useState(true);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);

  const sourceUrl = state?.source_url ?? null;
  const isPlaying = state?.is_playing ?? false;
  const duration = state?.duration_seconds ? Number(state.duration_seconds) : null;

  // --- Guest drift correction ----------------------------------------------
  //
  // Runs on a timer rather than on `timeupdate`: timeupdate fires at the
  // browser's discretion (and stops entirely while paused or stalled), which
  // is exactly when a stuck guest most needs to be pulled back into line.
  useEffect(() => {
    if (isHost || !state || !sourceUrl) return;
    const video = videoRef.current;
    if (!video) return;

    const id = setInterval(() => {
      const el = videoRef.current;
      if (!el) return;

      // Match play/pause intent first. A guest whose video is paused while the
      // room plays would otherwise fall further behind every second, and each
      // pass would compute a bigger drift and hard-seek again.
      if (state.is_playing && el.paused) {
        void el.play().catch(() => setNeedsGesture(true));
      } else if (!state.is_playing && !el.paused) {
        el.pause();
      }

      const target = targetPosition(state, clockOffsetMs);
      const plan = planCorrection(el.currentTime, target);

      if (plan.kind === "seek") {
        el.currentTime = plan.to;
        el.playbackRate = 1;
      } else if (plan.kind === "rate") {
        el.playbackRate = plan.rate;
      } else {
        // Always restore normal speed once caught up, or a guest that once ran
        // 5% fast keeps running fast forever and oscillates around the target.
        if (el.playbackRate !== 1) el.playbackRate = 1;
      }
    }, 1000);

    return () => clearInterval(id);
  }, [isHost, state, sourceUrl, clockOffsetMs]);

  // --- Host: land on the right frame when the source or intent changes ------
  useEffect(() => {
    if (!isHost || !state || !sourceUrl) return;
    const video = videoRef.current;
    if (!video) return;
    if (state.is_playing && video.paused) {
      void video.play().catch(() => setNeedsGesture(true));
    } else if (!state.is_playing && !video.paused) {
      video.pause();
    }
  }, [isHost, state, sourceUrl]);

  // --- Position readout -----------------------------------------------------
  const handleTimeUpdate = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    setLocalPosition(el.currentTime);
    reportLocalPosition(el.currentTime);
  }, [reportLocalPosition]);

  // --- Host controls --------------------------------------------------------
  const hostTogglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    // Send our exact current position alongside the intent. Sending only
    // is_playing would make guests resume from the last heartbeat, up to ten
    // seconds stale.
    void push({ is_playing: !isPlaying, position_seconds: el.currentTime });
  }, [isPlaying, push]);

  const hostSeek = useCallback(
    (to: number) => {
      const el = videoRef.current;
      if (!el) return;
      const clamped = Math.max(0, duration ? Math.min(to, duration) : to);
      el.currentTime = clamped;
      void push({ position_seconds: clamped });
    },
    [duration, push],
  );

  const hostSetSource = useCallback(() => {
    const verdict = classifySource(urlDraft);
    if (!verdict.ok) {
      setUrlError(verdict.reason);
      return;
    }
    setUrlError(null);
    setUrlDraft("");
    // Reset position and pause on a new source. Carrying the old position over
    // would drop the room 40 minutes into a video that just started.
    void push({
      source_url: verdict.url,
      position_seconds: 0,
      duration_seconds: null,
      is_playing: false,
    });
  }, [urlDraft, push]);

  const handleLoadedMetadata = useCallback(() => {
    const el = videoRef.current;
    if (!el || !isHost) return;
    if (Number.isFinite(el.duration) && el.duration > 0) {
      // Only the host reports duration — it's a property of the file, so one
      // writer is enough and guests writing it would fight over rounding.
      void push({ duration_seconds: el.duration });
    }
  }, [isHost, push]);

  // Autoplay is blocked until the viewer interacts. Starting muted gets us
  // picture immediately; this button trades that for sound on one tap.
  const acceptGesture = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = false;
    setMuted(false);
    setNeedsGesture(false);
    void el.play().catch(() => setNeedsGesture(true));
  }, []);

  // Fullscreen. Requested on the frame (not the <video>) so the synced-to-host
  // badge and buffering chip stay visible. iOS Safari doesn't implement the
  // element API, so fall back to the video's own webkit presentation mode.
  const toggleFullscreen = useCallback(() => {
    const frame = frameRef.current;
    if (!frame) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
      return;
    }
    if (frame.requestFullscreen) {
      void frame.requestFullscreen().catch(() => {});
      return;
    }
    const video = videoRef.current as
      | (HTMLVideoElement & { webkitEnterFullscreen?: () => void })
      | null;
    video?.webkitEnterFullscreen?.();
  }, []);

  // Track fullscreen from the document so the icon stays correct when the user
  // leaves via Escape or the system gesture rather than our button.
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const displayPosition = state && !isHost ? targetPosition(state, clockOffsetMs) : localPosition;
  const progress = duration && duration > 0 ? Math.min(100, (displayPosition / duration) * 100) : 0;

  // --- Empty state ----------------------------------------------------------
  if (!loading && !sourceUrl) {
    return (
      <div className="mb-6 overflow-hidden rounded-2xl border border-cinema-gold/50 bg-cinema-void">
        {/* Idle marquee. The mockup treats the dark screen as the brand moment,
            so the wordmark carries it and the helper copy sits underneath. */}
        <div className="relative flex aspect-video w-full flex-col items-center justify-center px-6 text-center">
          <span className="text-xl font-light uppercase tracking-[0.34em] text-cinema-gold">
            Cinema
          </span>
          <p className="mt-3 max-w-sm text-xs text-white/40">
            {isHost
              ? "Paste a direct video link and everyone in the room watches it together, in sync."
              : "The host hasn't started the screening yet. Sit tight."}
          </p>
          <Clapperboard
            className="absolute bottom-3 right-3 h-4 w-4 text-white/20"
            aria-hidden
          />
        </div>
        {isHost && (
          <div className="border-t border-cinema-border p-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Link2
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30"
                  aria-hidden
                />
                <input
                  value={urlDraft}
                  onChange={(e) => setUrlDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && hostSetSource()}
                  placeholder="https://… .mp4"
                  aria-label="Video link"
                  className="w-full rounded-lg border border-cinema-border bg-black/40 py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-white/25 focus:border-cinema-gold/50 focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={hostSetSource}
                className="shrink-0 rounded-lg bg-cinema-gold px-4 text-sm font-semibold text-black transition hover:brightness-110"
              >
                Load
              </button>
            </div>
            {urlError && <p className="mt-2 text-xs text-red-400">{urlError}</p>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mb-6 overflow-hidden rounded-2xl border border-cinema-gold/50 bg-black">
      <div ref={frameRef} className="relative aspect-video w-full bg-black">
        {sourceUrl && (
          <video
            ref={videoRef}
            src={sourceUrl}
            muted={muted}
            playsInline
            // No `controls`: the timeline belongs to the host. Guests scrubbing
            // their own copy is the opposite of a watch party.
            className="h-full w-full object-contain"
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onWaiting={() => setBuffering(true)}
            onPlaying={() => setBuffering(false)}
            onCanPlay={() => setBuffering(false)}
          />
        )}

        {loading && (
          <div className="absolute inset-0 grid place-items-center bg-black/60">
            <Loader2 className="h-6 w-6 animate-spin text-cinema-gold" aria-hidden />
          </div>
        )}

        {buffering && !loading && (
          <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-[10px] text-white/70 backdrop-blur">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            Buffering
          </div>
        )}

        {needsGesture && (
          <button
            type="button"
            onClick={acceptGesture}
            className="absolute inset-0 grid place-items-center bg-black/70 backdrop-blur-sm"
          >
            <span className="flex items-center gap-2 rounded-full bg-cinema-gold px-5 py-3 text-sm font-semibold text-black">
              <Play className="h-4 w-4 fill-current" aria-hidden />
              Tap to join the screening
            </span>
          </button>
        )}

        {!isHost && (
          <span className="absolute left-3 top-3 rounded-full bg-black/70 px-2.5 py-1 text-[10px] font-medium uppercase tracking-widest text-cinema-gold backdrop-blur">
            Synced to host
          </span>
        )}

        {/* Fullscreen is viewer-local: it changes nothing about playback state,
            so guests get it too without touching the host's timeline. */}
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          className="absolute bottom-3 right-3 rounded-md p-1.5 text-white/45 transition hover:bg-black/50 hover:text-white"
        >
          {isFullscreen ? (
            <Minimize2 className="h-4 w-4" aria-hidden />
          ) : (
            <Maximize2 className="h-4 w-4" aria-hidden />
          )}
        </button>
      </div>

      {/* Progress. Read-only for guests; the host's is clickable. */}
      <div
        className={`h-1 w-full bg-white/10 ${isHost ? "cursor-pointer" : ""}`}
        onClick={(e) => {
          if (!isHost || !duration) return;
          const rect = e.currentTarget.getBoundingClientRect();
          hostSeek(((e.clientX - rect.left) / rect.width) * duration);
        }}
      >
        <div className="h-full bg-cinema-gold transition-[width]" style={{ width: `${progress}%` }} />
      </div>

      <div className="flex items-center gap-3 bg-cinema-surface px-3 py-2.5">
        {isHost ? (
          <>
            <button
              type="button"
              onClick={hostTogglePlay}
              aria-label={isPlaying ? "Pause for everyone" : "Play for everyone"}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-cinema-gold text-black transition hover:brightness-110"
            >
              {isPlaying ? (
                <Pause className="h-4 w-4 fill-current" aria-hidden />
              ) : (
                <Play className="h-4 w-4 fill-current" aria-hidden />
              )}
            </button>
            <button
              type="button"
              onClick={() => hostSeek(localPosition - 10)}
              aria-label="Back 10 seconds"
              className="text-white/50 transition hover:text-cinema-gold"
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => hostSeek(localPosition + 10)}
              aria-label="Forward 10 seconds"
              className="text-white/50 transition hover:text-cinema-gold"
            >
              <RotateCw className="h-4 w-4" aria-hidden />
            </button>
          </>
        ) : (
          <span className="text-[11px] text-white/40">The host controls playback</span>
        )}

        <span className="ml-auto font-mono text-[11px] tabular-nums text-white/50">
          {formatTimecode(displayPosition)}
          {duration ? ` / ${formatTimecode(duration)}` : ""}
        </span>

        <button
          type="button"
          onClick={() => {
            const el = videoRef.current;
            if (!el) return;
            el.muted = !el.muted;
            setMuted(el.muted);
          }}
          aria-label={muted ? "Unmute" : "Mute"}
          className="text-white/50 transition hover:text-cinema-gold"
        >
          {muted ? <VolumeX className="h-4 w-4" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}
        </button>
      </div>

      {isHost && (
        <div className="border-t border-cinema-border bg-cinema-surface px-3 pb-3">
          <div className="flex gap-2">
            <input
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && hostSetSource()}
              placeholder="Change what's playing…"
              aria-label="Change video link"
              className="flex-1 rounded-lg border border-cinema-border bg-black/40 px-3 py-2 text-xs text-white placeholder:text-white/25 focus:border-cinema-gold/50 focus:outline-none"
            />
            <button
              type="button"
              onClick={hostSetSource}
              className="shrink-0 rounded-lg border border-cinema-gold/40 px-3 text-xs font-semibold text-cinema-gold transition hover:bg-cinema-gold/10"
            >
              Swap
            </button>
          </div>
          {urlError && <p className="mt-2 text-xs text-red-400">{urlError}</p>}
        </div>
      )}

      {error && (
        <p className="bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>
      )}
    </div>
  );
}
