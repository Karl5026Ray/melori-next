"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authHeaders } from "@/lib/authClient";
import type { RadioTrack } from "@/lib/data";

/**
 * Melori Radio — Personal Shuffle mixer.
 *
 * Plays the whole published catalog in one continuous shuffled rotation with a
 * crossfade between tracks, so it feels like a DJ set rather than a gapless
 * playlist. Everything is client-side (each listener has their own rotation).
 *
 * Crossfade approach: two <audio> "decks" (A/B). While deck A plays out, deck B
 * preloads the next track; near the end of A we ramp A's volume down and B's up
 * over the crossfade window, then swap roles. We fade element VOLUME rather than
 * routing through the Web Audio API graph on purpose — signed S3 URLs would
 * taint a MediaElementSource unless CORS is perfectly configured, which would
 * silently break a GainNode fade. Volume ramping needs no CORS and is robust.
 *
 * Audio URLs come from the existing signed-URL stream endpoints
 * (/api/tracks/[id]/stream and /api/studio/tracks/[id]/stream), so membership
 * gating and free 30s previews are applied exactly as everywhere else.
 */

// Crossfade windows. Shortened (was 4s / 7s) because the blend lingered too
// long — tracks talked over each other for several seconds. These give a tight,
// clean DJ-style transition without a long overlap.
const CROSSFADE_SEC = 2; // within-set fade
const SET_CROSSFADE_SEC = 3.5; // heavier fade at set boundaries
const SET_SIZE = 4; // tracks per "set" — mix harder after each set
const FADE_TICK_MS = 50;

function streamUrlFor(t: RadioTrack): string {
  return t.sourceType === "studio"
    ? `/api/studio/tracks/${t.id}/stream`
    : `/api/tracks/${t.id}/stream`;
}

// Build the play rotation for a pool. `preserveOrder` (used for saved
// playlists) returns the pool as-is so a curated playlist plays in the order it
// was saved. Otherwise it shuffles: when tracks carry a `score` (the "For You"
// station) it uses a weighted draw so higher-scored tracks tend to land earlier
// and recur more — but it stays probabilistic (a radio, not a ranked list), so
// discovery tracks still surface. Without scores it's a plain Fisher–Yates.
// Either way, a repair pass avoids the same artist back-to-back.
function buildRotation(
  pool: RadioTrack[],
  preserveOrder: boolean,
): RadioTrack[] {
  if (preserveOrder) return [...pool];
  return shuffleNoAdjacentArtist(pool);
}

function shuffleNoAdjacentArtist(pool: RadioTrack[]): RadioTrack[] {
  const hasScores = pool.some((t) => typeof t.score === "number" && t.score > 0);
  let arr: RadioTrack[];
  if (hasScores) {
    // Weighted sampling without replacement via the Efraimidis–Spirakis method:
    // key = random^(1/weight); sort desc by key. Higher weight -> earlier.
    arr = [...pool]
      .map((t) => {
        const w = Math.max(0.01, (t.score ?? 0) + 0.5); // floor so score-0 still plays
        const key = Math.pow(Math.random(), 1 / w);
        return { t, key };
      })
      .sort((a, b) => b.key - a.key)
      .map((x) => x.t);
  } else {
    arr = [...pool];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }
  for (let i = 1; i < arr.length; i++) {
    if (
      arr[i].artistName &&
      arr[i].artistName === arr[i - 1].artistName
    ) {
      // find a later track by a different artist to swap in
      let k = i + 1;
      while (k < arr.length && arr[k].artistName === arr[i - 1].artistName) k++;
      if (k < arr.length) [arr[i], arr[k]] = [arr[k], arr[i]];
    }
  }
  return arr;
}

interface StreamResp {
  url?: string;
  sample?: boolean;
  previewStart?: number | null;
  previewEnd?: number | null;
}

export interface RadioState {
  ready: boolean;
  tuned: boolean; // user has pressed Tune In (playback started at least once)
  isPlaying: boolean;
  isLoading: boolean;
  current: RadioTrack | null;
  next: RadioTrack | null;
  currentTime: number;
  duration: number;
  volume: number;
  isSample: boolean;
  error: string | null;
  queuePosition: number; // 1-based index in the current shuffle
  queueLength: number;
}

export interface RadioMixerOptions {
  // A stable identity for the current pool/station (e.g. "all", "foryou", or
  // "playlist:<id>"). When it changes we rebuild the rotation, stop the decks,
  // and re-tune into the new station — otherwise switching stations left the
  // old rotation (and old audio) running until the stale queue happened to wrap.
  poolKey?: string;
  // When true, play the pool in its given order instead of shuffling. Used for
  // saved playlists so a curated order is respected.
  preserveOrder?: boolean;
}

export function useRadioMixer(
  pool: RadioTrack[],
  options: RadioMixerOptions = {},
) {
  const { poolKey, preserveOrder = false } = options;
  const deckARef = useRef<HTMLAudioElement | null>(null);
  const deckBRef = useRef<HTMLAudioElement | null>(null);
  const activeDeckRef = useRef<"A" | "B">("A");
  const queueRef = useRef<RadioTrack[]>([]);
  const idxRef = useRef(0);
  const fadingRef = useRef(false);
  const fadeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const preloadedNextUrlRef = useRef<string | null>(null);
  const userPausedRef = useRef(false);
  const volumeRef = useRef(1);
  // Sample cap is per-DECK, not global. Preloading the next track onto the idle
  // deck must NOT overwrite the currently-audible deck's cap — doing so made the
  // tick fire advance() against a stale cap, which chained into a runaway
  // advance→reload loop that stalled playback after the first track. Keyed by
  // the deck element itself so each deck carries its own preview window.
  const capByDeckRef = useRef<WeakMap<HTMLAudioElement, number | null>>(
    new WeakMap(),
  );
  // Guards a single in-flight advance so the 200ms tick can't stack multiple
  // overlapping advances (the real cause of the repeated re-fetch loop).
  const advancingRef = useRef(false);
  // Bounds dead-track skipping so an all-unplayable pool can't recurse forever.
  const deadSkipsRef = useRef(0);

  const [state, setState] = useState<RadioState>({
    ready: false,
    tuned: false,
    isPlaying: false,
    isLoading: false,
    current: null,
    next: null,
    currentTime: 0,
    duration: 0,
    volume: 1,
    isSample: false,
    error: null,
    queuePosition: 0,
    queueLength: 0,
  });

  const patch = useCallback((p: Partial<RadioState>) => {
    setState((s) => ({ ...s, ...p }));
  }, []);

  const active = useCallback(
    () => (activeDeckRef.current === "A" ? deckARef.current : deckBRef.current),
    [],
  );
  const idle = useCallback(
    () => (activeDeckRef.current === "A" ? deckBRef.current : deckARef.current),
    [],
  );

  // Build the two decks once.
  useEffect(() => {
    const a = new Audio();
    const b = new Audio();
    a.preload = "auto";
    b.preload = "auto";
    a.volume = 0;
    b.volume = 0;
    deckARef.current = a;
    deckBRef.current = b;
    return () => {
      a.pause();
      b.pause();
      if (fadeTimerRef.current) clearInterval(fadeTimerRef.current);
    };
  }, []);

  // Build (or rebuild) the rotation when the pool arrives OR the station
  // changes. Keyed by `poolKey` (falling back to pool length so a first load
  // still initialises): the FIRST radio bug was that this only ran while the
  // queue was empty, so switching stations/playlists swapped `pool` but never
  // rebuilt the queue, never stopped the decks, and never reset `tuned` — the
  // old station kept playing until the stale queue happened to wrap. Now a new
  // key stops both decks, rebuilds the rotation, and resets `tuned` so the
  // auto-resume effect re-tunes into the new station.
  const builtKeyRef = useRef<string | null>(null);
  // NOTE: the rotation build/rebuild effect lives lower down, after clearFade is
  // declared (it depends on it).

  const fetchStream = useCallback(
    async (t: RadioTrack): Promise<StreamResp | null> => {
      try {
        const res = await fetch(streamUrlFor(t), {
          cache: "no-store",
          headers: await authHeaders(),
        });
        if (!res.ok) return null;
        return (await res.json()) as StreamResp;
      } catch {
        return null;
      }
    },
    [],
  );

  // Load a track onto a deck (does not play). Returns success.
  const loadDeck = useCallback(
    async (deck: HTMLAudioElement, t: RadioTrack): Promise<StreamResp | null> => {
      const s = await fetchStream(t);
      if (!s?.url) return null;
      deck.src = s.url;
      // Seek free-preview start once metadata is ready.
      const start = typeof s.previewStart === "number" ? s.previewStart : 0;
      if (start > 0) {
        const onMeta = () => {
          try {
            deck.currentTime = start;
          } catch {
            /* ignore */
          }
          deck.removeEventListener("loadedmetadata", onMeta);
        };
        deck.addEventListener("loadedmetadata", onMeta);
      }
      return s;
    },
    [fetchStream],
  );

  const clearFade = useCallback(() => {
    if (fadeTimerRef.current) {
      clearInterval(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
    fadingRef.current = false;
  }, []);

  // Advance to the next track with a crossfade. Called near end-of-track or on skip.
  const advance = useCallback(
    async (immediate = false) => {
      if (fadingRef.current && !immediate) return;
      // One advance at a time. Without this, the 200ms tick fired advance()
      // repeatedly while the first was still awaiting loadDeck, hammering the
      // stream endpoint for the same track and never actually progressing.
      if (advancingRef.current) return;
      advancingRef.current = true;
      const q = queueRef.current;
      if (!q.length) {
        advancingRef.current = false;
        return;
      }

      // Reshuffle when we reach the end (fresh "set").
      let nextIdx = idxRef.current + 1;
      if (nextIdx >= q.length) {
        queueRef.current = shuffleNoAdjacentArtist(pool);
        nextIdx = 0;
      }
      const nextTrack = queueRef.current[nextIdx];
      if (!nextTrack) {
        advancingRef.current = false;
        return;
      }

      const cur = active();
      const nxt = idle();
      if (!cur || !nxt) {
        advancingRef.current = false;
        return;
      }

      // Defense in depth: if the idle deck is somehow still playing (e.g. a
      // skip landed mid-crossfade and the previous fade was cleared before it
      // could pause the outgoing deck), silence it before we reuse it as the
      // next deck. Without this, the previous track would keep playing under
      // the newly-loaded one — two songs at once.
      try {
        if (!nxt.paused) nxt.pause();
      } catch {
        /* ignore */
      }
      nxt.volume = 0;

      // Heavier fade at set boundaries.
      const atSetBoundary = nextIdx % SET_SIZE === 0;
      const fadeSec = immediate
        ? 0.4
        : atSetBoundary
          ? SET_CROSSFADE_SEC
          : CROSSFADE_SEC;

      const s = await loadDeck(nxt, nextTrack);
      if (!s?.url) {
        // Skip a dead track: step the index forward and retry, but bound the
        // recursion so a fully-unplayable pool can't spin forever.
        idxRef.current = nextIdx;
        deadSkipsRef.current += 1;
        clearFade();
        if (deadSkipsRef.current > queueRef.current.length) {
          deadSkipsRef.current = 0;
          advancingRef.current = false;
          patch({ error: "No playable tracks right now." });
          return;
        }
        advancingRef.current = false;
        void advance(true);
        return;
      }
      deadSkipsRef.current = 0;
      // Store the NEXT track's cap on the NEXT (idle) deck only — never touch
      // the currently-audible deck's cap while it's still playing out.
      capByDeckRef.current.set(
        nxt,
        typeof s.previewEnd === "number" ? s.previewEnd : null,
      );

      nxt.volume = 0;
      try {
        userPausedRef.current = false;
        await nxt.play();
      } catch {
        /* autoplay may reject until gesture; ignore */
      }

      fadingRef.current = true;
      clearFade();
      const steps = Math.max(1, Math.round((fadeSec * 1000) / FADE_TICK_MS));
      let step = 0;
      const startVol = volumeRef.current;
      fadeTimerRef.current = setInterval(() => {
        step++;
        const f = Math.min(1, step / steps);
        cur.volume = Math.max(0, startVol * (1 - f));
        nxt.volume = Math.min(startVol, startVol * f);
        if (f >= 1) {
          clearFade();
          cur.pause();
          activeDeckRef.current = activeDeckRef.current === "A" ? "B" : "A";
          idxRef.current = nextIdx;
          advancingRef.current = false;
          patch({
            current: queueRef.current[nextIdx] ?? null,
            next:
              queueRef.current[
                nextIdx + 1 >= queueRef.current.length ? 0 : nextIdx + 1
              ] ?? null,
            queuePosition: nextIdx + 1,
            queueLength: queueRef.current.length,
            isSample: Boolean(s.sample),
            currentTime: 0,
          });
        }
      }, FADE_TICK_MS);
    },
    [pool, active, idle, loadDeck, clearFade, patch],
  );

  // Build (or rebuild) the rotation when the pool arrives OR the station
  // changes. Keyed by `poolKey` (falling back to pool length so a first load
  // still initialises): the FIRST radio bug was that this only ran while the
  // queue was empty, so switching stations/playlists swapped `pool` but never
  // rebuilt the queue, never stopped the decks, and never reset `tuned` — the
  // old station kept playing until the stale queue happened to wrap. Now a new
  // key stops both decks, rebuilds the rotation, and resets `tuned` so the
  // auto-resume effect re-tunes into the new station.
  useEffect(() => {
    const key = poolKey ?? `len:${pool.length}`;
    if (!pool.length) {
      // Empty station/playlist: stop any prior audio and clear the queue so the
      // UI shows the empty state instead of the previous station playing on.
      if (builtKeyRef.current !== null) {
        clearFade();
        deckARef.current?.pause();
        deckBRef.current?.pause();
        queueRef.current = [];
        idxRef.current = 0;
        builtKeyRef.current = key;
        patch({
          ready: false,
          tuned: false,
          isPlaying: false,
          current: null,
          next: null,
          queueLength: 0,
          queuePosition: 0,
        });
      }
      return;
    }
    if (builtKeyRef.current === key) return; // same station, nothing to rebuild

    const wasTuned = builtKeyRef.current !== null; // a real station switch
    builtKeyRef.current = key;
    queueRef.current = buildRotation(pool, preserveOrder);
    idxRef.current = 0;

    if (wasTuned) {
      // Station switch mid-listen: stop the old decks and reset `tuned` so the
      // auto-resume effect (in RadioClient) tunes into the new rotation.
      clearFade();
      deckARef.current?.pause();
      deckBRef.current?.pause();
      activeDeckRef.current = "A";
      advancingRef.current = false;
      userPausedRef.current = false;
    }

    patch({
      ready: true,
      // On a station switch, force back to a not-yet-tuned/paused state so the
      // auto-resume effect re-tunes; on first build leave tuned/isPlaying alone.
      ...(wasTuned ? { tuned: false, isPlaying: false } : {}),
      current: queueRef.current[0] ?? null,
      next: queueRef.current[1] ?? null,
      queueLength: queueRef.current.length,
      queuePosition: 1,
    });
  }, [pool, poolKey, preserveOrder, clearFade, patch]);

  // Per-deck time tracking + auto-crossfade trigger + sample cap.
  useEffect(() => {
    const tick = () => {
      const cur = active();
      if (!cur) return;
      // Read the cap belonging to THIS (currently-audible) deck. Using a
      // per-deck value means preloading the next track never corrupts the cap
      // the tick checks against — the old shared ref did, which is what drove
      // the runaway advance loop.
      const cap = capByDeckRef.current.get(cur) ?? null;
      const dur = cap ?? (Number.isFinite(cur.duration) ? cur.duration : 0);
      setState((s) => ({
        ...s,
        currentTime: cur.currentTime,
        duration: dur || s.duration,
      }));
      if (userPausedRef.current || fadingRef.current) return;
      // Free-preview hard cap.
      if (cap != null && cur.currentTime >= cap) {
        void advance();
        return;
      }
      // Start crossfade near the end.
      const total = cap ?? cur.duration;
      if (total && Number.isFinite(total)) {
        const remaining = total - cur.currentTime;
        const boundaryFade =
          (idxRef.current + 1) % SET_SIZE === 0
            ? SET_CROSSFADE_SEC
            : CROSSFADE_SEC;
        if (remaining <= boundaryFade + 0.15) void advance();
      }
    };
    const t = setInterval(tick, 200);
    return () => clearInterval(t);
  }, [active, advance]);

  // Wire ended as a safety net (in case the timeupdate crossfade misses).
  useEffect(() => {
    const a = deckARef.current;
    const b = deckBRef.current;
    if (!a || !b) return;
    const onEnded = () => {
      if (!fadingRef.current && !userPausedRef.current) void advance(true);
    };
    a.addEventListener("ended", onEnded);
    b.addEventListener("ended", onEnded);
    return () => {
      a.removeEventListener("ended", onEnded);
      b.removeEventListener("ended", onEnded);
    };
  }, [advance]);

  // --- Public controls ---

  const tuneIn = useCallback(async () => {
    const q = queueRef.current;
    if (!q.length) return;
    const cur = active();
    if (!cur) return;
    patch({ isLoading: true, error: null });
    const track = q[idxRef.current];
    const s = await loadDeck(cur, track);
    if (!s?.url) {
      patch({ isLoading: false, error: "Could not start the radio." });
      // try skipping to a playable track
      void advance(true);
      return;
    }
    capByDeckRef.current.set(
      cur,
      typeof s.previewEnd === "number" ? s.previewEnd : null,
    );
    cur.volume = volumeRef.current;
    try {
      userPausedRef.current = false;
      await cur.play();
      patch({
        tuned: true,
        isPlaying: true,
        isLoading: false,
        current: track,
        next: q[idxRef.current + 1] ?? q[0] ?? null,
        isSample: Boolean(s.sample),
      });
    } catch {
      patch({ isLoading: false, error: "Tap play to start audio." });
    }
  }, [active, loadDeck, advance, patch]);

  const togglePlay = useCallback(() => {
    const cur = active();
    if (!cur) return;
    if (!state.tuned) {
      void tuneIn();
      return;
    }
    if (cur.paused) {
      userPausedRef.current = false;
      void cur.play().catch(() => undefined);
      patch({ isPlaying: true });
    } else {
      userPausedRef.current = true;
      cur.pause();
      patch({ isPlaying: false });
    }
  }, [active, state.tuned, tuneIn, patch]);

  const skip = useCallback(() => {
    // Hard reset before we advance. The two bugs this fixes:
    //
    //  1) Skip "sticks" — button appears dead. `advance()` is guarded by
    //     `advancingRef`, and if a skip is pressed while an advance is still
    //     in flight (very easy: pressing skip during the auto-crossfade near
    //     end of a track, or double-tapping skip) the guard silently drops
    //     the new advance. We release the guard here so a user-initiated
    //     skip always wins.
    //
    //  2) Two songs at once — pressing skip mid-crossfade cleared the fade
    //     timer but left BOTH decks playing (the timer is what eventually
    //     paused the outgoing deck at line ~346). `advance(true)` would then
    //     load the new track onto the idle deck (killing the incoming half
    //     of the crossfade) and start a fresh short fade, but the previously
    //     ACTIVE deck was never paused and kept playing underneath. Hard-
    //     stopping both decks here guarantees only the new track is audible.
    clearFade();
    advancingRef.current = false;
    const a = deckARef.current;
    const b = deckBRef.current;
    try {
      if (a && !a.paused) a.pause();
    } catch {
      /* ignore */
    }
    try {
      if (b && !b.paused) b.pause();
    } catch {
      /* ignore */
    }
    if (a) a.volume = 0;
    if (b) b.volume = 0;
    void advance(true);
    if (!state.tuned) patch({ tuned: true, isPlaying: true });
  }, [clearFade, advance, state.tuned, patch]);

  const reshuffle = useCallback(() => {
    queueRef.current = buildRotation(pool, preserveOrder);
    idxRef.current = 0;
    clearFade();
    patch({
      current: queueRef.current[0] ?? null,
      next: queueRef.current[1] ?? null,
      queuePosition: 1,
      queueLength: queueRef.current.length,
    });
    // If already tuned, jump straight into the new first track.
    if (state.tuned) {
      const cur = active();
      if (cur) {
        void (async () => {
          const s = await loadDeck(cur, queueRef.current[0]);
          if (s?.url) {
            capByDeckRef.current.set(
              cur,
              typeof s.previewEnd === "number" ? s.previewEnd : null,
            );
            cur.volume = volumeRef.current;
            userPausedRef.current = false;
            await cur.play().catch(() => undefined);
            patch({ isPlaying: true, isSample: Boolean(s.sample) });
          }
        })();
      }
    }
  }, [pool, clearFade, patch, state.tuned, active, loadDeck]);

  const setVolume = useCallback(
    (v: number) => {
      const vol = Math.max(0, Math.min(1, v));
      volumeRef.current = vol;
      // Apply to whichever deck is currently audible (unless mid-fade).
      if (!fadingRef.current) {
        const cur = active();
        if (cur) cur.volume = vol;
      }
      patch({ volume: vol });
    },
    [active, patch],
  );

  // --- Media Session API ---------------------------------------------------
  //
  // Publish the currently-playing track to the OS media session so that:
  //   - Bluetooth car head units (AVRCP), CarPlay, Android Auto, the phone
  //     lock screen, and OS media widgets show the song title / artist /
  //     album / cover art instead of falling back to "Unknown".
  //   - Hardware buttons on the steering wheel and dashboard (play, pause,
  //     next, previous) actually control Melori Radio.
  //
  // Without this, a page-driven <audio> element ships no AVRCP metadata over
  // Bluetooth, which is why the car was displaying "Unknown" for every track
  // even though the site itself renders the metadata correctly.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }
    const ms = navigator.mediaSession;
    const t = state.current;
    if (!t) {
      try {
        ms.metadata = null;
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      ms.metadata = new MediaMetadata({
        title: t.title || "Melori Radio",
        artist: t.artistName || "Melori Radio",
        album: t.album || "Melori Radio",
        artwork: t.coverUrl
          ? [
              // Same URL at multiple advertised sizes — head units pick the
              // one that best fits their display. Real dimensions don't need
              // to match; the sizes hint is just a preference signal.
              { src: t.coverUrl, sizes: "96x96", type: "image/jpeg" },
              { src: t.coverUrl, sizes: "256x256", type: "image/jpeg" },
              { src: t.coverUrl, sizes: "512x512", type: "image/jpeg" },
            ]
          : [],
      });
    } catch {
      /* older browsers may throw on MediaMetadata construction; ignore */
    }
  }, [state.current]);

  // Keep the OS-level playback state in sync so the car dashboard shows the
  // correct play/pause icon and progress bar without waiting for the next
  // audio event.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }
    try {
      navigator.mediaSession.playbackState = state.isPlaying
        ? "playing"
        : state.tuned
          ? "paused"
          : "none";
    } catch {
      /* ignore */
    }
  }, [state.isPlaying, state.tuned]);

  // Position state powers the car's progress bar / elapsed-time display.
  // Throttled by the existing 200ms tick that already updates state.currentTime
  // and state.duration, so we don't need our own timer.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }
    if (typeof navigator.mediaSession.setPositionState !== "function") return;
    const dur = state.duration;
    const pos = state.currentTime;
    if (!Number.isFinite(dur) || dur <= 0) return;
    if (!Number.isFinite(pos) || pos < 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: dur,
        position: Math.min(pos, dur),
        playbackRate: 1,
      });
    } catch {
      /* some browsers reject stale/invalid states — ignore */
    }
  }, [state.currentTime, state.duration]);

  // Wire the hardware/dashboard buttons to Melori Radio's controls.
  // Registered once and re-registered whenever the underlying handlers
  // change identity so we don't hold stale closures.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }
    const ms = navigator.mediaSession;
    const setHandler = (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null,
    ) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* action not supported on this browser — ignore */
      }
    };
    setHandler("play", () => {
      if (!state.isPlaying) togglePlay();
    });
    setHandler("pause", () => {
      if (state.isPlaying) togglePlay();
    });
    setHandler("nexttrack", () => {
      skip();
    });
    // Radio is a shuffle so there's no real "previous." Per user preference:
    // restart the currently-playing track when the car's Prev button is hit.
    setHandler("previoustrack", () => {
      const cur = active();
      if (cur) {
        try {
          cur.currentTime = 0;
        } catch {
          /* ignore */
        }
      }
    });
    // Some head units send stop instead of pause when audio is cut.
    setHandler("stop", () => {
      if (state.isPlaying) togglePlay();
    });
    return () => {
      setHandler("play", null);
      setHandler("pause", null);
      setHandler("nexttrack", null);
      setHandler("previoustrack", null);
      setHandler("stop", null);
    };
  }, [state.isPlaying, togglePlay, skip, active]);

  return {
    state,
    tuneIn,
    togglePlay,
    skip,
    reshuffle,
    setVolume,
  };
}
