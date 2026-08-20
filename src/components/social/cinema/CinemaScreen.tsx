"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Loader2,
  Clapperboard,
  Maximize2,
  Minimize2,
  ArrowUp,
  ArrowDown,
  ListVideo,
  Trash2,
  X,
} from "lucide-react";
import { useCinemaPlayback } from "./useCinemaPlayback";
import { CinemaSourcePicker } from "./CinemaSourcePicker";
import { CinemaYouTubePlayer } from "./CinemaYouTubePlayer";
import {
  type CinemaPlayerHandle,
  type CinemaSourceDraft,
  MAX_CINEMA_PLAYLIST_ITEMS,
  activeCinemaPlaylistItem,
  effectiveCinemaPlaylist,
  formatTimecode,
  parseYouTubeId,
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
  overlay,
  viewportBound = false,
}: {
  spaceId: string;
  isHost: boolean;
  overlay?: ReactNode;
  /**
   * Cinema rooms own a fixed viewport. In that presentation the media frame
   * grows into the available canvas instead of forcing a document-height
   * aspect ratio below the room controls.
   */
  viewportBound?: boolean;
}) {
  const {
    state,
    loading,
    error,
    clockOffsetMs,
    push,
    playlistCommand,
    reportLocalPosition,
  } =
    useCinemaPlayback(spaceId, isHost);

  const videoRef = useRef<HTMLVideoElement>(null);
  const youTubeRef = useRef<CinemaPlayerHandle | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [localPosition, setLocalPosition] = useState(0);
  const [muted, setMuted] = useState(true);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  // Consecutive drift ticks where the room is playing but we are not. YouTube
  // reports no error when it refuses to autoplay, so the only way to notice is
  // that our instruction keeps not taking.
  const refusedTicksRef = useRef(0);
  const endedItemRef = useRef<string | null>(null);

  const sourceUrl = state?.source_url ?? null;
  const playlist = effectiveCinemaPlaylist(state);
  const activePlaylistItem = activeCinemaPlaylistItem(state);
  const remainingPlaylistSlots = Math.max(
    0,
    MAX_CINEMA_PLAYLIST_ITEMS - playlist.length,
  );
  const isPlaying = state?.is_playing ?? false;
  const duration = state?.duration_seconds ? Number(state.duration_seconds) : null;

  // Trust the stored type, but only after the URL actually resolves to a video
  // id. A row mislabelled 'youtube' would otherwise mount a player with nothing
  // to play; falling back to <video> at least surfaces a real error.
  const youTubeId =
    state?.source_type === "youtube" && sourceUrl ? parseYouTubeId(sourceUrl) : null;
  const isYouTube = Boolean(youTubeId);

  /**
   * One player, two implementations.
   *
   * Everything below -- drift correction, host controls, the mute button --
   * goes through this. It is the only place in the room that knows a YouTube
   * iframe is not an HTMLVideoElement.
   */
  // A new source deserves a clean slate; the last video's failure is not this
  // video's problem.
  useEffect(() => {
    setPlayerError(null);
    endedItemRef.current = null;
  }, [sourceUrl]);

  const getPlayer = useCallback((): CinemaPlayerHandle | null => {
    if (isYouTube) return youTubeRef.current;
    const el = videoRef.current;
    if (!el) return null;
    return {
      supportsRateCorrection: true,
      getCurrentTime: () => el.currentTime,
      getDuration: () =>
        Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null,
      isPaused: () => el.paused,
      play: () => {
        void el.play().catch(() => setNeedsGesture(true));
      },
      pause: () => el.pause(),
      seek: (to: number) => {
        el.currentTime = to;
      },
      setRate: (rate: number) => {
        el.playbackRate = rate;
      },
      setMuted: (next: boolean) => {
        el.muted = next;
      },
    };
  }, [isYouTube]);

  // --- Guest drift correction ----------------------------------------------
  //
  // Runs on a timer rather than on `timeupdate`: timeupdate fires at the
  // browser's discretion (and stops entirely while paused or stalled), which
  // is exactly when a stuck guest most needs to be pulled back into line.
  useEffect(() => {
    if (isHost || !state || !sourceUrl) return;

    const id = setInterval(() => {
      const player = getPlayer();
      if (!player) return;

      // Match play/pause intent first. A guest whose video is paused while the
      // room plays would otherwise fall further behind every second, and each
      // pass would compute a bigger drift and hard-seek again.
      if (state.is_playing && player.isPaused()) {
        player.play();
        refusedTicksRef.current += 1;
        // Three seconds of asking and still paused: the browser is blocking
        // autoplay. Ask for the tap instead of leaving a frozen screen.
        if (refusedTicksRef.current >= 3) setNeedsGesture(true);
        // No point correcting drift against a player that is not moving.
        return;
      }

      refusedTicksRef.current = 0;

      if (!state.is_playing && !player.isPaused()) {
        player.pause();
      }

      const target = targetPosition(state, clockOffsetMs);
      const plan = planCorrection(player.getCurrentTime(), target, {
        allowRate: player.supportsRateCorrection,
      });

      if (plan.kind === "seek") {
        player.seek(plan.to);
        player.setRate(1);
      } else if (plan.kind === "rate") {
        player.setRate(plan.rate);
      } else {
        // Always restore normal speed once caught up, or a guest that once ran
        // 5% fast keeps running fast forever and oscillates around the target.
        player.setRate(1);
      }
    }, 1000);

    return () => clearInterval(id);
  }, [isHost, state, sourceUrl, clockOffsetMs, getPlayer]);

  // --- Host: land on the right frame when the source or intent changes ------
  useEffect(() => {
    if (!isHost || !state || !sourceUrl) return;
    const player = getPlayer();
    if (!player) return;
    if (state.is_playing && player.isPaused()) {
      player.play();
    } else if (!state.is_playing && !player.isPaused()) {
      player.pause();
    }
  }, [isHost, state, sourceUrl, getPlayer]);

  // --- Position readout -----------------------------------------------------
  const handleTimeUpdate = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    setLocalPosition(el.currentTime);
    reportLocalPosition(el.currentTime);
  }, [reportLocalPosition]);

  // The IFrame API has no timeupdate event, so the YouTube path polls for the
  // same readout. 500ms keeps the timecode honest without burning a frame
  // budget; the host heartbeat reads the value this writes.
  useEffect(() => {
    if (!isYouTube || !sourceUrl) return;
    const id = setInterval(() => {
      const player = youTubeRef.current;
      if (!player) return;
      const seconds = player.getCurrentTime();
      setLocalPosition(seconds);
      reportLocalPosition(seconds);
    }, 500);
    return () => clearInterval(id);
  }, [isYouTube, sourceUrl, reportLocalPosition]);

  // --- Host controls --------------------------------------------------------
  const hostTogglePlay = useCallback(() => {
    const player = getPlayer();
    if (!player) return;
    const next = !isPlaying;

    // Drive our own player synchronously, still inside the click.
    //
    // This used to only push and let the state effect start playback once the
    // row came back. That works for <video>, but a cross-origin YouTube iframe
    // will not start from a callback that runs after an await -- the user
    // activation is gone by then, playVideo() is dropped on the floor, and the
    // room sits at 0:00 with the button showing "Pause". (The tell was that
    // scrubbing fixed it: hostSeek always ran inside the gesture.)
    if (next) player.play();
    else player.pause();

    // Send our exact current position alongside the intent. Sending only
    // is_playing would make guests resume from the last heartbeat, up to ten
    // seconds stale.
    void push({ is_playing: next, position_seconds: player.getCurrentTime() });
  }, [isPlaying, push, getPlayer]);

  const hostSeek = useCallback(
    (to: number) => {
      const player = getPlayer();
      if (!player) return;
      const clamped = Math.max(0, duration ? Math.min(to, duration) : to);
      player.seek(clamped);
      void push({ position_seconds: clamped });
    },
    [duration, push, getPlayer],
  );

  const hostAddSource = useCallback(
    async (item: CinemaSourceDraft) => {
      await playlistCommand({ action: "append", item });
    },
    [playlistCommand],
  );

  const hostAdvance = useCallback(() => {
    if (!isHost || !activePlaylistItem) return;
    if (endedItemRef.current === activePlaylistItem.id) return;
    endedItemRef.current = activePlaylistItem.id;
    void playlistCommand({
      action: "advance",
      ended_item_id: activePlaylistItem.id,
    });
  }, [isHost, activePlaylistItem, playlistCommand]);

  const handleLoadedMetadata = useCallback(() => {
    const el = videoRef.current;
    if (!el || !isHost) return;
    if (Number.isFinite(el.duration) && el.duration > 0) {
      // Only the host reports duration — it's a property of the file, so one
      // writer is enough and guests writing it would fight over rounding.
      void push({ duration_seconds: el.duration });
    }
  }, [isHost, push]);

  const handleYouTubeDuration = useCallback(
    (seconds: number) => {
      if (!isHost) return;
      // Only write once. YouTube reports duration on ready and again on every
      // transition into PLAYING, and re-pushing an unchanged number on each
      // resume would be a wasted round trip per play.
      if (duration && Math.abs(duration - seconds) < 1) return;
      void push({ duration_seconds: seconds });
    },
    [isHost, duration, push],
  );

  // Autoplay is blocked until the viewer interacts. Starting muted gets us
  // picture immediately; this button trades that for sound on one tap.
  const acceptGesture = useCallback(() => {
    const player = getPlayer();
    if (!player) return;
    player.setMuted(false);
    setMuted(false);
    setNeedsGesture(false);
    refusedTicksRef.current = 0;
    player.play();
  }, [getPlayer]);

  // Requested on the frame rather than the <video> so the synced-to-host badge
  // and buffering chip stay visible in fullscreen. iOS Safari doesn't implement
  // the element API, so fall back to the video's own presentation mode.
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

  // Track from the document so the icon stays correct when the viewer leaves
  // via Escape or a system gesture rather than our button.
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
      <div
        className={
          viewportBound
            ? "flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-cinema-gold/50 bg-cinema-void"
            : "mb-2 overflow-hidden rounded-2xl border border-cinema-gold/50 bg-cinema-void md:mb-4"
        }
        data-testid="cinema-screen"
      >
        {/* Idle marquee. The mockup treats the dark screen as the brand moment,
            so the wordmark carries it and the helper copy sits underneath. */}
        <div
          className={
            viewportBound
              ? "relative flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center"
              : "relative flex aspect-[4/3] w-full flex-col items-center justify-center px-6 text-center sm:aspect-[16/10] md:aspect-video"
          }
          data-testid="cinema-media-area"
        >
          <span className="text-xl font-light uppercase tracking-[0.34em] text-cinema-gold">
            Cinema
          </span>
          <p className="mt-3 max-w-sm text-xs text-white/40">
            {isHost
              ? "Pick a source below and everyone in the room watches it together, in sync."
              : "The host hasn't started the screening yet. Sit tight."}
          </p>
          <Clapperboard
            className="absolute bottom-3 right-3 h-4 w-4 text-white/20"
            aria-hidden
          />
          {overlay}
        </div>
        {isHost && (
          <CinemaSourcePicker
            onPick={hostAddSource}
            remainingSlots={remainingPlaylistSlots}
          />
        )}
      </div>
    );
  }

  return (
    <div
      className={
        viewportBound
          ? "flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-cinema-gold/50 bg-black"
          : "mb-2 overflow-hidden rounded-2xl border border-cinema-gold/50 bg-black md:mb-4"
      }
      data-testid="cinema-screen"
    >
      <div
        ref={frameRef}
        className={
          viewportBound
            ? "relative min-h-0 flex-1 bg-black"
            : "relative aspect-[4/3] w-full bg-black sm:aspect-[16/10] md:aspect-video"
        }
        data-testid="cinema-media-area"
      >
        {youTubeId && (
          <CinemaYouTubePlayer
            // Remount on a new video rather than reusing the player: a stale
            // iframe that has already buffered the previous video keeps
            // reporting its old duration for a beat after loadVideoById.
            key={youTubeId}
            ref={youTubeRef}
            videoId={youTubeId}
            onBufferingChange={setBuffering}
            onDuration={handleYouTubeDuration}
            onError={setPlayerError}
            onReady={() => {
              if (isPlaying) youTubeRef.current?.play();
            }}
            onEnded={hostAdvance}
          />
        )}

        {sourceUrl && !isYouTube && (
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
            onCanPlay={() => {
              setBuffering(false);
              if (isPlaying) {
                void videoRef.current?.play().catch(() => setNeedsGesture(true));
              }
            }}
            onEnded={hostAdvance}
          />
        )}

        {playerError && (
          <div className="absolute inset-0 z-20 grid place-items-center bg-black/85 p-6 text-center">
            <p className="max-w-sm text-sm text-white/80">{playerError}</p>
          </div>
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

        {/* Fullscreen is viewer-local: it writes no shared state, so guests
            get it too without touching the host's timeline. The live seats moved
            out of this frame into their own band below it, so this control now
            owns the screen's bottom-right corner outright — no shared gutter, no
            ambiguous hit target against a seat tile. */}
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          className="absolute bottom-3 right-3 z-20 rounded-md p-1.5 text-white/45 transition hover:bg-black/50 hover:text-white"
          data-testid="cinema-fullscreen-control"
        >
          {isFullscreen ? (
            <Minimize2 className="h-4 w-4" aria-hidden />
          ) : (
            <Maximize2 className="h-4 w-4" aria-hidden />
          )}
        </button>
        {overlay}
      </div>

      {/* Progress. Read-only for guests; the host's is clickable. */}
      <div
        className={`h-1 shrink-0 w-full bg-white/10 ${isHost ? "cursor-pointer" : ""}`}
        onClick={(e) => {
          if (!isHost || !duration) return;
          const rect = e.currentTarget.getBoundingClientRect();
          hostSeek(((e.clientX - rect.left) / rect.width) * duration);
        }}
      >
        <div className="h-full bg-cinema-gold transition-[width]" style={{ width: `${progress}%` }} />
      </div>

      <div className="flex shrink-0 items-center gap-2.5 bg-cinema-surface px-3 py-1 sm:gap-3 sm:py-1.5 md:py-2.5">
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
          // nowrap: wrapping this onto a second line silently stole ~15px of
          // height from the shared screen on a phone.
          <span className="whitespace-nowrap text-[11px] text-white/40">
            Host controls playback
          </span>
        )}

        <button
          type="button"
          onClick={() => setPlaylistOpen(true)}
          aria-label={`Open playlist, ${playlist.length} of ${MAX_CINEMA_PLAYLIST_ITEMS} items`}
          className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] tabular-nums text-white/50 transition hover:bg-white/5 hover:text-cinema-gold"
        >
          <ListVideo className="h-4 w-4" aria-hidden />
          {playlist.length}/{MAX_CINEMA_PLAYLIST_ITEMS}
        </button>

        <span className="ml-auto font-mono text-[11px] tabular-nums text-white/50">
          {formatTimecode(displayPosition)}
          {duration ? ` / ${formatTimecode(duration)}` : ""}
        </span>

        <button
          type="button"
          onClick={() => {
            const player = getPlayer();
            if (!player) return;
            const next = !muted;
            player.setMuted(next);
            setMuted(next);
          }}
          aria-label={muted ? "Unmute" : "Mute"}
          className="text-white/50 transition hover:text-cinema-gold"
        >
          {muted ? <VolumeX className="h-4 w-4" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}
        </button>
      </div>

      {playlistOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-end bg-black/70 p-3 backdrop-blur-sm md:items-center md:justify-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cinema-playlist-title"
          onClick={() => setPlaylistOpen(false)}
        >
          <section
            className="flex max-h-[72dvh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-cinema-border bg-cinema-surface shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex shrink-0 items-center gap-2 border-b border-cinema-border px-3 py-2.5">
              <ListVideo className="h-4 w-4 text-cinema-gold" aria-hidden />
              <h2 id="cinema-playlist-title" className="text-sm font-semibold text-white/90">
                Playlist
              </h2>
              <span className="text-[11px] tabular-nums text-white/40">
                {playlist.length}/{MAX_CINEMA_PLAYLIST_ITEMS}
              </span>
              <button
                type="button"
                onClick={() => setPlaylistOpen(false)}
                aria-label="Close playlist"
                className="ml-auto rounded-md p-2 text-white/50 transition hover:bg-white/5 hover:text-white"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </header>

            <div className="min-h-0 overflow-y-auto overscroll-contain p-2">
              <ol className="space-y-1">
                {playlist.map((item, index) => {
                  const active = item.id === activePlaylistItem?.id;
                  const label =
                    item.title ||
                    (item.source_type === "youtube"
                      ? "YouTube video"
                      : (() => {
                          try {
                            return decodeURIComponent(
                              new URL(item.source_url).pathname
                                .split("/")
                                .filter(Boolean)
                                .pop() || "Video",
                            );
                          } catch {
                            return "Video";
                          }
                        })());
                  return (
                    <li
                      key={item.id}
                      className={`flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 ${
                        active
                          ? "border-cinema-gold/45 bg-cinema-gold/10"
                          : "border-transparent bg-black/20"
                      }`}
                    >
                      <span
                        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${
                          active ? "bg-cinema-gold text-black" : "bg-white/10 text-white/50"
                        }`}
                      >
                        {index + 1}
                      </span>
                      <button
                        type="button"
                        disabled={!isHost || active}
                        onClick={() =>
                          void playlistCommand({ action: "select", item_id: item.id })
                        }
                        className="min-w-0 flex-1 text-left disabled:cursor-default"
                        aria-label={active ? `${label}, now playing` : `Play ${label} now`}
                      >
                        <span className="block truncate text-xs font-medium text-white/80">
                          {label}
                        </span>
                        <span className="block text-[10px] uppercase tracking-wider text-white/35">
                          {active
                            ? "Now playing"
                            : item.source_type === "youtube"
                              ? "YouTube"
                              : "Video"}
                        </span>
                      </button>
                      {isHost && (
                        <div className="flex shrink-0 items-center">
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() =>
                              void playlistCommand({
                                action: "move",
                                item_id: item.id,
                                to_index: index - 1,
                              })
                            }
                            aria-label={`Move ${label} up`}
                            className="rounded p-1.5 text-white/35 transition hover:bg-white/5 hover:text-cinema-gold disabled:opacity-20"
                          >
                            <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                          </button>
                          <button
                            type="button"
                            disabled={index === playlist.length - 1}
                            onClick={() =>
                              void playlistCommand({
                                action: "move",
                                item_id: item.id,
                                to_index: index + 1,
                              })
                            }
                            aria-label={`Move ${label} down`}
                            className="rounded p-1.5 text-white/35 transition hover:bg-white/5 hover:text-cinema-gold disabled:opacity-20"
                          >
                            <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void playlistCommand({ action: "remove", item_id: item.id })
                            }
                            aria-label={`Remove ${label}`}
                            className="rounded p-1.5 text-white/35 transition hover:bg-red-500/10 hover:text-red-300"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>

              {isHost && (
                <details className="mt-2 border-t border-cinema-border pt-2">
                  <summary className="cursor-pointer list-none px-1 py-2 text-xs font-semibold text-white/50 transition hover:text-cinema-gold">
                    {remainingPlaylistSlots > 0
                      ? `Add videos (${remainingPlaylistSlots} open)`
                      : "Playlist full"}
                  </summary>
                  <div className="pb-1">
                    <CinemaSourcePicker
                      onPick={hostAddSource}
                      compact
                      remainingSlots={remainingPlaylistSlots}
                    />
                  </div>
                </details>
              )}
            </div>
          </section>
        </div>
      )}

      {error && (
        <p className="bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>
      )}
    </div>
  );
}
