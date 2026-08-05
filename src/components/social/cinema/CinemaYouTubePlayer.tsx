"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { CinemaPlayerHandle } from "@/lib/cinemaPlayback";

/**
 * A YouTube IFrame API player wearing the same face as the room's <video>.
 *
 * CinemaScreen's sync loop was written against an HTMLVideoElement. Rather
 * than fork that loop, this component hands back a CinemaPlayerHandle, so the
 * loop keeps issuing the same four instructions -- play, pause, seek, rate --
 * and never learns which player it is driving.
 *
 * What YouTube genuinely cannot match:
 *   - seekTo() lands on the nearest keyframe unless the video is fully
 *     buffered, so a seek is approximate where a file seek is exact.
 *   - setPlaybackRate() only honours its advertised rates, so the 5% nudge
 *     tier is off (see planCorrection's allowRate).
 * Both are handled by the caller; nothing here pretends otherwise.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

// One script tag per document, one promise shared by every player that mounts.
// Rooms remount this component on every source change; loading the API each
// time would leave a pile of duplicate script tags behind.
let apiPromise: Promise<void> | null = null;

/** How long to wait for the API before calling it dead. */
const API_TIMEOUT_MS = 10_000;

/**
 * Rejects rather than hanging.
 *
 * The first ship of this feature was blocked by our own Content-Security-Policy
 * -- script-src did not list youtube.com -- and because a blocked script fires
 * no console error and no onerror in every browser, the room just sat black
 * forever. A timeout and a rejection path mean the next infrastructure problem
 * announces itself instead of looking like a broken video.
 */
function loadYouTubeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      // Let a later mount retry: the failure may have been transient.
      apiPromise = null;
      reject(new Error("YouTube player API did not load"));
    }, API_TIMEOUT_MS);

    // Chain rather than overwrite: another integration may already own this
    // global, and stomping it would silently break them.
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve();
    };

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      apiPromise = null;
      reject(new Error("YouTube player API failed to load"));
    };
    document.head.appendChild(script);
  });

  return apiPromise;
}

// YT.PlayerState, spelled out so we don't have to wait for the API to load
// before we can compare against it.
const UNSTARTED = -1;
const ENDED = 0;
const PLAYING = 1;
const PAUSED = 2;
const BUFFERING = 3;

export interface CinemaYouTubePlayerProps {
  videoId: string;
  /** Fires once the player is live and can accept commands. */
  onReady?: () => void;
  /** Buffering and unstarted both count, so the room can show its spinner. */
  onBufferingChange?: (buffering: boolean) => void;
  /** Duration in seconds, once YouTube knows it. */
  onDuration?: (seconds: number) => void;
  /** The player could not be created or the video refused to play. */
  onError?: (message: string) => void;
}

export const CinemaYouTubePlayer = forwardRef<
  CinemaPlayerHandle,
  CinemaYouTubePlayerProps
>(function CinemaYouTubePlayer(
  { videoId, onReady, onBufferingChange, onDuration, onError },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);

  // Callbacks live in refs so a parent that re-renders with fresh closures
  // doesn't tear down and rebuild the iframe mid-playback.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onBufferingRef = useRef(onBufferingChange);
  onBufferingRef.current = onBufferingChange;
  const onDurationRef = useRef(onDuration);
  onDurationRef.current = onDuration;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let cancelled = false;

    void loadYouTubeApi().then(
      () => {
        if (cancelled || !hostRef.current || !window.YT?.Player) return;

      playerRef.current = new window.YT.Player(hostRef.current, {
        videoId,
        playerVars: {
          // No YouTube chrome. The room already has controls, and a guest who
          // can reach YouTube's own scrub bar can desync the room from inside
          // the iframe where we cannot see it.
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          rel: 0,
          iv_load_policy: 3,
          // Without this, iOS Safari takes the video fullscreen on play and
          // the room disappears behind it.
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (event: any) => {
            // A cross-origin iframe cannot autoplay unless it is granted the
            // permission explicitly. The IFrame API's own allow list has
            // varied across rollouts, so set it ourselves rather than hope.
            try {
              const iframe: HTMLIFrameElement | undefined =
                event.target.getIframe?.();
              iframe?.setAttribute(
                "allow",
                "autoplay; encrypted-media; picture-in-picture",
              );
            } catch {
              // Not fatal: playback still works from a direct tap.
            }
            // Muted start mirrors the <video> path: picture immediately,
            // sound on the first tap.
            event.target.mute();
            const duration = event.target.getDuration?.();
            if (Number.isFinite(duration) && duration > 0) {
              onDurationRef.current?.(duration);
            }
            onReadyRef.current?.();
          },
          onStateChange: (event: any) => {
            const state = event.data as number;
            onBufferingRef.current?.(state === BUFFERING || state === UNSTARTED);
            if (state === PLAYING) {
              const duration = event.target.getDuration?.();
              if (Number.isFinite(duration) && duration > 0) {
                onDurationRef.current?.(duration);
              }
            }
          },
          onError: (event: any) => {
            // 101/150: the uploader disabled embedding. 100: gone or private.
            // 2/5: a bad id or a player fault. All of them leave a black
            // rectangle, so say which one it is.
            const code = event?.data;
            onBufferingRef.current?.(false);
            onErrorRef.current?.(
              code === 101 || code === 150
                ? "This video's owner doesn't allow it to be played on other sites. Try a different video."
                : code === 100
                  ? "That video is private or no longer available."
                  : "YouTube couldn't play this video.",
            );
          },
        },
        });
      },
      () => {
        if (cancelled) return;
        onBufferingRef.current?.(false);
        onErrorRef.current?.(
          "Couldn't load the YouTube player. Check your connection or an ad blocker.",
        );
      },
    );

    return () => {
      cancelled = true;
      try {
        playerRef.current?.destroy?.();
      } catch {
        // The iframe can already be gone during a fast unmount; nothing to do.
      }
      playerRef.current = null;
    };
  }, [videoId]);

  useImperativeHandle(
    ref,
    (): CinemaPlayerHandle => ({
      supportsRateCorrection: false,

      getCurrentTime() {
        const time = playerRef.current?.getCurrentTime?.();
        return Number.isFinite(time) ? (time as number) : 0;
      },

      getDuration() {
        const duration = playerRef.current?.getDuration?.();
        return Number.isFinite(duration) && duration > 0
          ? (duration as number)
          : null;
      },

      isPaused() {
        const state = playerRef.current?.getPlayerState?.();
        if (typeof state !== "number") return true;
        // BUFFERING is not paused. Calling play() on a buffering player would
        // do nothing useful and would make the sync loop churn every second.
        return state === PAUSED || state === ENDED || state === UNSTARTED;
      },

      play() {
        playerRef.current?.playVideo?.();
      },

      pause() {
        playerRef.current?.pauseVideo?.();
      },

      seek(to: number) {
        // allowSeekAhead: seek past the buffer rather than clamping to it.
        playerRef.current?.seekTo?.(Math.max(0, to), true);
      },

      setRate() {
        // Intentionally inert. supportsRateCorrection tells the sync loop not
        // to ask, and honouring a 1.05 request with YouTube's nearest legal
        // rate (1.25) would overshoot far worse than the drift it corrects.
      },

      setMuted(muted: boolean) {
        if (muted) playerRef.current?.mute?.();
        else playerRef.current?.unMute?.();
      },
    }),
    [],
  );

  return (
    <div className="absolute inset-0">
      {/* YT.Player replaces this node with its iframe. */}
      <div ref={hostRef} className="h-full w-full" />
      {/*
        Click shield. A YouTube iframe treats a tap as play/pause, which would
        desync one viewer from the room silently. The room's own controls sit
        above this, so the host loses nothing.
      */}
      <div className="absolute inset-0" aria-hidden="true" />
    </div>
  );
});
