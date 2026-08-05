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

function loadYouTubeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<void>((resolve) => {
    // Chain rather than overwrite: another integration may already own this
    // global, and stomping it would silently break them.
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
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
}

export const CinemaYouTubePlayer = forwardRef<
  CinemaPlayerHandle,
  CinemaYouTubePlayerProps
>(function CinemaYouTubePlayer(
  { videoId, onReady, onBufferingChange, onDuration },
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

  useEffect(() => {
    let cancelled = false;

    void loadYouTubeApi().then(() => {
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
          onError: () => {
            // Age-restricted, private, or embedding-disabled. Stop the spinner
            // so the room isn't left pretending it is still loading.
            onBufferingRef.current?.(false);
          },
        },
      });
    });

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
