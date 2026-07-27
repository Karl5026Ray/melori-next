"use client";

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { authHeaders } from "@/lib/authClient";

// A PlayerTrack refers to either a row in the legacy `tracks` table (integer
// PK) or a row in `studio_tracks` (UUID PK). We keep `id` typed as the union
// so callers don't have to coerce, and use `sourceType` to route to the
// correct signed-URL endpoint. Legacy is the default because the majority of
// existing callers still use the old table.
export type TrackSource = "legacy" | "studio";

export interface PlayerTrack {
  id: number | string;
  title: string;
  artistName: string | null;
  coverUrl: string | null;
  // Optional — defaults to "legacy" so pre-existing callers keep working.
  sourceType?: TrackSource;
  // Optional extras carried by radio pool rows (RadioTrack). Declaring them
  // here lets a RadioTrack be queued directly and lets the OS media session
  // publish an album name.
  album?: string | null;
  score?: number;
}

// Stable string key used for internal equality checks (e.g. "is this track
// currently loaded?"). Distinguishing by source type prevents a collision
// where a legacy tracks.id=5 would appear equal to a studio_tracks.id whose
// string happens to be "5".
function trackKey(t: { id: number | string; sourceType?: TrackSource }): string {
  return `${t.sourceType ?? "legacy"}:${t.id}`;
}

// Resolve the correct signed-URL endpoint for a track based on its source.
function streamUrlFor(t: PlayerTrack): string {
  return t.sourceType === "studio"
    ? `/api/studio/tracks/${t.id}/stream`
    : `/api/tracks/${t.id}/stream`;
}

// Build a radio rotation. `preserveOrder` (saved playlists) returns the list
// untouched. Otherwise: when tracks carry a `score` (the "For You" station) we
// draw without replacement using Efraimidis–Spirakis weighting so higher-scored
// tracks tend to land earlier, but it stays probabilistic so discovery tracks
// still surface. A repair pass then avoids the same artist back-to-back.
function buildRotation(
  pool: PlayerTrack[],
  preserveOrder: boolean,
): PlayerTrack[] {
  if (preserveOrder) return [...pool];
  const hasScores = pool.some((t) => typeof t.score === "number" && t.score > 0);
  let arr: PlayerTrack[];
  if (hasScores) {
    arr = [...pool]
      .map((t) => {
        const w = Math.max(0.01, (t.score ?? 0) + 0.5); // floor so score-0 still plays
        return { t, key: Math.pow(Math.random(), 1 / w) };
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
    if (arr[i].artistName && arr[i].artistName === arr[i - 1].artistName) {
      let k = i + 1;
      while (k < arr.length && arr[k].artistName === arr[i - 1].artistName) k++;
      if (k < arr.length) [arr[i], arr[k]] = [arr[k], arr[i]];
    }
  }
  return arr;
}

interface PlayerContextValue {
  current: PlayerTrack | null;
  queue: PlayerTrack[];
  index: number;
  isPlaying: boolean;
  isLoading: boolean;
  currentTime: number; // seconds
  duration: number; // seconds
  volume: number; // 0..1
  // Muted mirrors the <audio> element's own `muted` flag. Used by the homepage
  // hero, which starts playback MUTED (the only way browsers allow autoplay)
  // and unmutes on the visitor's first interaction.
  muted: boolean;
  error: string | null;
  hasNext: boolean;
  hasPrev: boolean;
  // True while the current track is a free 30s preview (not full access).
  isSample: boolean;
  // True once a free preview has hit its 30s cap and playback was stopped.
  sampleEnded: boolean;
  // Radio mode: the shared player is fed the whole shuffled catalog and
  // auto-reshuffles forever, so "Radio" is just a toggle on the one bar the
  // user already sees — no separate page or second audio engine.
  radioMode: boolean;
  radioLoading: boolean;
  // Identity of the station currently on air ("all", "foryou",
  // "playlist:<id>"). Lets the Radio page tell "this station is already
  // playing" from "the user switched stations", so opening /social/radio while
  // the homepage station plays never restarts or double-starts audio.
  radioStationKey: string | null;
  startRadio: (
    mode?: "all" | "foryou",
    options?: { muted?: boolean },
  ) => void;
  // Put an explicit track list on air (the Radio page's stations and saved
  // playlists). `preserveOrder` keeps a curated playlist in its saved order.
  playRadio: (
    tracks: PlayerTrack[],
    options?: { key?: string; preserveOrder?: boolean; keepMuted?: boolean },
  ) => void;
  reshuffleRadio: () => void;
  stopRadio: () => void;
  playQueue: (tracks: PlayerTrack[], startIndex: number) => void;
  togglePlay: () => void;
  // Start real, audible playback of `current` — unlocks, guarantees the element
  // is on the track's signed URL (never the silent unlock clip), unmutes and
  // plays. Never pauses, so it is safe to call from a bare first-interaction
  // handler without testing `isPlaying`.
  playAudible: () => void;
  // Halt playback without toggling — used when entering a live room so
  // background music never fights the room's own audio.
  pause: () => void;
  next: () => void;
  prev: () => void;
  seek: (fraction: number) => void;
  setVolume: (v: number) => void;
  setMuted: (m: boolean) => void;
  // Prime the shared <audio> element for programmatic playback within a real
  // user gesture (iOS autoplay-policy unlock). Safe to call repeatedly — only
  // the first call per session does any work.
  unlockPlayback: () => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

const LAST_TRACK_KEY = "melori:lastTrack";
const VOLUME_KEY = "melori:volume";

// A 1-sample, digitally-silent WAV used to "unlock" the shared <audio> element
// inside a real user gesture. iOS Safari (and, increasingly, Chrome) only grant
// an element permission for later PROGRAMMATIC playback once play() has been
// invoked on it from within a user gesture. Our real load path awaits a signed
// URL before play(), which loses the transient activation — so the first gesture
// primes the element with this clip synchronously, blessing it for the session.
//
// The clip MUST be handed to the element as a `blob:` URL, not a `data:` URI.
// Our enforced CSP (next.config.js) is `media-src 'self' blob: https:` — it has
// no `data:` source, so a data: URI is refused before the element ever loads it.
// Blink reports that refusal as `MEDIA_ELEMENT_ERROR: Media load rejected by URL
// safety check` with code 4 (MEDIA_ERR_SRC_NOT_SUPPORTED), which read like a
// broken audio file and made every track look like a format failure. `blob:` is
// already allow-listed, so the unlock works without weakening the policy.
let _silentClipUrl: string | null = null;
function getSilentClipUrl(): string {
  if (_silentClipUrl) return _silentClipUrl;
  // Minimal PCM WAV: mono, 8kHz, 8-bit, one silent sample (0x80 = midpoint).
  const bytes = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x25, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    0x66, 0x6d, 0x74, 0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
    0x40, 0x1f, 0x00, 0x00, 0x40, 0x1f, 0x00, 0x00, 0x01, 0x00, 0x08, 0x00,
    0x64, 0x61, 0x74, 0x61, 0x01, 0x00, 0x00, 0x00, 0x80,
  ]);
  _silentClipUrl = URL.createObjectURL(
    new Blob([bytes], { type: "audio/wav" }),
  );
  return _silentClipUrl;
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within a PlayerProvider");
  return ctx;
}

export default function PlayerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Tracks which track's signed URL is currently loaded into the <audio>.
  // Key of the track whose signed URL is loaded into the <audio>. Uses the
  // composite trackKey() so legacy and studio ids never collide.
  const loadedIdRef = useRef<string | null>(null);
  // Holds the latest auto-advance behavior for the (once-bound) "ended" event.
  const advanceRef = useRef<() => void>(() => {});
  // True while playback is halted by an explicit user pause. Guards against a
  // late "ended" event (e.g. pausing right at the tail) silently auto-advancing.
  const userPausedRef = useRef(false);
  // Free-preview window (absolute seconds in the track timeline) for the loaded
  // track, or null for full access. `sampleLimitRef` is the cap (previewEnd);
  // `sampleStartRef` is where the audible window begins (previewStart).
  const sampleLimitRef = useRef<number | null>(null);
  const sampleStartRef = useRef<number>(0);
  // A one-shot seek target applied once the new src reports its metadata.
  const pendingSeekRef = useRef<number | null>(null);
  // Consecutive unplayable tracks skipped on the radio. Bounded by the queue
  // length so an entirely dead pool surfaces an error instead of spinning.
  const deadSkipsRef = useRef(0);
  const queueLengthRef = useRef(0);
  // True once the element has been unlocked by a user-gesture play() (see
  // getSilentClipUrl). Guards the one-time silent prime.
  const unlockedRef = useRef(false);
  // The exact `audio.src` of the real track currently loaded, or null when the
  // element holds anything else (nothing yet, or the silent unlock clip).
  //
  // Every state-driving listener below gates on this. A boolean "we are priming
  // right now" flag can't do the job: the unlock clip's failure rejects the
  // play() promise AND fires `error`, in an order the spec doesn't pin down, so
  // whichever handler cleared the flag first let the other one through — which
  // is how a silent 45-byte clip was able to publish "This track's audio format
  // isn't supported" over a perfectly good track. Comparing against the src we
  // actually assigned is order-independent: an event either belongs to the real
  // track or it is ignored, so nothing but real audio can ever move the UI.
  const realSrcRef = useRef<string | null>(null);
  // True once the <audio> element's event listeners have been wired.
  const wiredRef = useRef(false);

  const [current, setCurrent] = useState<PlayerTrack | null>(null);
  const [queue, setQueue] = useState<PlayerTrack[]>([]);
  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [muted, setMutedState] = useState(false);
  // Mirror `muted` into a ref so loadAndPlay can apply it synchronously before
  // calling audio.play() (state updates lag a render behind).
  const mutedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [isSample, setIsSample] = useState(false);
  const [sampleEnded, setSampleEnded] = useState(false);
  const [radioMode, setRadioMode] = useState(false);
  const [radioLoading, setRadioLoading] = useState(false);
  const [radioStationKey, setRadioStationKey] = useState<string | null>(null);
  // Mirror radioMode into a ref so the (stable) auto-advance handler can read
  // the latest value without being torn down/rebound on every toggle.
  const radioModeRef = useRef(false);
  useEffect(() => {
    radioModeRef.current = radioMode;
  }, [radioMode]);
  // Whether the station on air plays in its saved order (playlists) or shuffles.
  const preserveOrderRef = useRef(false);
  useEffect(() => {
    queueLengthRef.current = queue.length;
  }, [queue]);

  // --- single shared <audio> element + event wiring ---
  // Lazily create the element and wire its listeners ON FIRST ACCESS rather than
  // in a mount effect. React runs effects child-before-parent, so a child that
  // autoplays on mount (the homepage hero) would previously call into the player
  // BEFORE this provider's own mount effect had created the element — leaving
  // `audioRef.current` null and silently dropping playback. Creating on demand
  // makes ordering irrelevant: whoever needs the element first creates it.
  const getAudio = useCallback((): HTMLAudioElement | null => {
    if (typeof window === "undefined") return null;
    if (!audioRef.current) audioRef.current = new Audio();
    const audio = audioRef.current;
    if (wiredRef.current) return audio;
    wiredRef.current = true;

    // Put the element in the document. A detached `new Audio()` plays fine, but
    // it is invisible to `document.querySelector("audio")`, which made it
    // impossible to tell "the UI is faking progress" apart from "real audio is
    // playing but muted" while debugging playback on the live site.
    audio.setAttribute("data-melori-player", "");
    audio.style.display = "none";
    document.body?.appendChild(audio);

    // An event only counts when the element is holding the real track's src —
    // see realSrcRef. Anything else (the silent unlock clip, or a load we have
    // already replaced) must not touch progress, isPlaying, or error state.
    const isRealTrack = () =>
      realSrcRef.current !== null && audio.src === realSrcRef.current;

    const onTime = () => {
      if (!isRealTrack()) return;
      // Hard-cap free previews at the window end: a free listener must not be
      // able to hear past previewEnd even though the audio element holds the
      // full file. Server-side gating serves a dedicated clip when one exists.
      const limit = sampleLimitRef.current;
      if (limit != null && audio.currentTime >= limit) {
        // Clear the cap first so a late tick can't re-enter while we swap src.
        sampleLimitRef.current = null;
        audio.pause();
        audio.currentTime = limit;
        setCurrentTime(limit);
        if (radioModeRef.current) {
          // On the radio a preview ending must not end the station — roll on to
          // the next track. Gating is unchanged: the listener still hears only
          // the preview window of every track.
          advanceRef.current();
        } else {
          userPausedRef.current = true;
          setSampleEnded(true);
        }
        return;
      }
      setCurrentTime(audio.currentTime);
      if (audio.duration && Number.isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    };
    const onMeta = () => {
      if (!isRealTrack()) return;
      if (audio.duration && Number.isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
      // Apply a pending window seek (previewStart) now that the new src is ready.
      if (pendingSeekRef.current != null) {
        const target = pendingSeekRef.current;
        pendingSeekRef.current = null;
        if (Number.isFinite(target) && target > 0) {
          try {
            audio.currentTime = target;
            setCurrentTime(target);
          } catch {
            /* seek not yet permitted; ignore */
          }
        }
      }
    };
    const onPlay = () => {
      if (!isRealTrack()) return;
      setIsPlaying(true);
    };
    const onPause = () => {
      if (!isRealTrack()) return;
      setIsPlaying(false);
    };
    const onEnded = () => {
      if (!isRealTrack()) return;
      advanceRef.current();
    };
    const onError = () => {
      if (!isRealTrack()) return;
      const mediaError = audio.error;
      const code = mediaError?.code;
      // MEDIA_ERR_ABORTED (1) fires whenever we swap `audio.src` to load the
      // next track — that's normal churn, not a playback failure, so ignore it.
      // Surfacing it was showing a spurious "Unable to play this track" while
      // the new track loaded and its progress bar moved.
      if (code === 1 /* MEDIA_ERR_ABORTED */) return;

      let message = "Unable to play this track.";
      if (code === 2 /* MEDIA_ERR_NETWORK */) {
        message = "Network error — check your connection and try again.";
      } else if (code === 3 /* MEDIA_ERR_DECODE */) {
        message = "This track couldn't be decoded.";
      } else if (code === 4 /* MEDIA_ERR_SRC_NOT_SUPPORTED */) {
        message = "This track's audio format isn't supported.";
      }
      // Log the src we ASSIGNED, not `currentSrc`. A load rejected before it
      // starts (CSP, bad scheme) leaves `currentSrc` holding the previous
      // track's URL, so the old log blamed whichever URL happened to be stale
      // and sent us hunting for a nonexistent URL allow-list.
      console.error(
        `[player] audio error code=${code ?? "?"} src=${realSrcRef.current ?? "(none)"}: ${
          mediaError?.message ?? "unknown"
        }`,
      );
      setError(message);
      setIsPlaying(false);
      setIsLoading(false);
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    return audio;
  }, []);

  // Eagerly create the element on mount too, so a restored track and the volume
  // sync effects have something to talk to even before any user interaction.
  useEffect(() => {
    getAudio();
  }, [getAudio]);

  // Prime the element for programmatic playback from inside a real user gesture.
  // The first gesture of the session plays a 1-sample silent clip, which grants
  // the element session-long permission so our await-then-play load path works
  // on iOS. No-op once unlocked, and never interrupts a track that's already
  // playing.
  const unlockPlayback = useCallback(() => {
    if (unlockedRef.current) return;
    const audio = getAudio();
    if (!audio) return;
    unlockedRef.current = true;
    // Something real is already playing → the element is already blessed.
    if (loadedIdRef.current && !audio.paused) return;
    // The element ALREADY holds the real track (the homepage hero's muted
    // autoplay loaded it, then the browser refused to start it). Unlock by
    // playing that, never by swapping in the clip: overwriting a good signed
    // URL makes the unlock destructive, and every caller then has to remember
    // to put the track back. The hero's callers only did so conditionally, so
    // the 0.000125s clip could be left as the source with nothing to reload it.
    if (realSrcRef.current && audio.src === realSrcRef.current) {
      void audio.play().catch(() => undefined);
      return;
    }
    const restoreMuted = () => {
      audio.muted = mutedRef.current;
    };
    try {
      // Bless UNMUTED playback (the clip is digital silence, so nothing audible)
      // — a muted unlock only permits muted programmatic playback on iOS.
      audio.muted = false;
      audio.src = getSilentClipUrl();
      // The real src is gone; force the next play path to (re)load its track,
      // and stop counting element events until that track is actually loaded.
      loadedIdRef.current = null;
      realSrcRef.current = null;
      const p = audio.play();
      if (p && typeof p.then === "function")
        p.then(restoreMuted).catch(restoreMuted);
      else restoreMuted();
    } catch {
      restoreMuted();
    }
  }, [getAudio]);

  // --- restore last track + volume from localStorage (paused; no autoplay) ---
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const rawVol = window.localStorage.getItem(VOLUME_KEY);
      if (rawVol != null) {
        const v = Number(rawVol);
        if (Number.isFinite(v)) setVolumeState(Math.max(0, Math.min(1, v)));
      }
      const raw = window.localStorage.getItem(LAST_TRACK_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as {
          current?: PlayerTrack;
          queue?: PlayerTrack[];
          index?: number;
        };
        if (saved?.current) {
          setCurrent(saved.current);
          setQueue(
            saved.queue && saved.queue.length ? saved.queue : [saved.current],
          );
          setIndex(saved.index ?? 0);
          // Intentionally NOT loading/playing — restored paused.
        }
      }
    } catch {
      /* ignore malformed storage */
    }
  }, []);

  // --- keep <audio> muted flag in sync ---
  // Mirrors state → element only. It must NOT write `mutedRef`: every writer
  // (setMuted, startRadio's autoplay branch) already sets ref + element + state
  // synchronously, whereas this effect first runs a beat LATE with the initial
  // `muted === false`. React runs child effects before the parent's, so the
  // homepage hero has already asked for muted autoplay by then — writing the ref
  // here would reset it to false and make loadAndPlay start the track UNMUTED,
  // which browsers refuse without a gesture.
  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = mutedRef.current;
  }, [muted]);

  // --- keep <audio> volume in sync + persist ---
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(VOLUME_KEY, String(volume));
      } catch {
        /* ignore */
      }
    }
  }, [volume]);

  // --- persist last track / queue / index ---
  useEffect(() => {
    if (typeof window === "undefined" || !current) return;
    try {
      // A radio rotation is the whole catalog; persisting it on every track
      // change would bloat (and can blow) the localStorage quota. Remember only
      // what's on air — radio is re-tuned from the pool on the next visit.
      const payload = radioMode
        ? { current, queue: [current], index: 0 }
        : { current, queue, index };
      window.localStorage.setItem(LAST_TRACK_KEY, JSON.stringify(payload));
    } catch {
      /* ignore */
    }
  }, [current, queue, index, radioMode]);

  const setMuted = useCallback((m: boolean) => {
    mutedRef.current = m;
    if (audioRef.current) audioRef.current.muted = m;
    setMutedState(m);
  }, []);

  const loadAndPlay = useCallback(
    async (track: PlayerTrack, shouldPlay: boolean) => {
      const audio = getAudio();
      if (!audio) return;
      setError(null);
      setIsLoading(true);
      setSampleEnded(false);
      try {
        const res = await fetch(streamUrlFor(track), {
          cache: "no-store",
          headers: await authHeaders(),
        });
        if (!res.ok) throw new Error("stream request failed");
        const data: {
          url?: string;
          sample?: boolean;
          sampleSeconds?: number | null;
          previewStart?: number | null;
          previewEnd?: number | null;
        } = await res.json();
        if (!data.url) throw new Error("no stream url");

        // A windowed sample carries an explicit [previewStart, previewEnd]. The
        // cap is previewEnd (absolute seconds); we seek to previewStart on load.
        const start =
          typeof data.previewStart === "number" ? data.previewStart : 0;
        const end =
          typeof data.previewEnd === "number"
            ? data.previewEnd
            : typeof data.sampleSeconds === "number"
              ? start + data.sampleSeconds
              : null;

        sampleStartRef.current = start;
        sampleLimitRef.current = end;
        pendingSeekRef.current = start > 0 ? start : null;
        setIsSample(Boolean(data.sample));

        audio.src = data.url;
        // Read the src back rather than storing `data.url`: the setter resolves
        // and normalizes the value, and the listeners compare against the
        // getter, so the two must come from the same place to ever match.
        realSrcRef.current = audio.src;
        audio.volume = volume;
        audio.muted = mutedRef.current;
        loadedIdRef.current = trackKey(track);
        if (shouldPlay) {
          userPausedRef.current = false;
          await audio.play();
        }
        deadSkipsRef.current = 0;
      } catch (err) {
        // A blocked autoplay (NotAllowedError) is a browser policy decision, not
        // a broken track — the URL loaded fine and playback works once the user
        // interacts. Don't scare listeners with an error in that case.
        const name = (err as { name?: string } | null)?.name;
        if (name === "NotAllowedError" || name === "AbortError") {
          setIsPlaying(false);
        } else if (radioModeRef.current) {
          // The radio must not die on one bad track — roll past it, unless the
          // whole rotation turns out to be unplayable.
          loadedIdRef.current = null;
          deadSkipsRef.current += 1;
          if (deadSkipsRef.current > queueLengthRef.current) {
            deadSkipsRef.current = 0;
            setError("No playable tracks right now.");
            setIsPlaying(false);
          } else {
            advanceRef.current();
          }
        } else {
          console.error("[player] loadAndPlay failed:", err);
          setError("Unable to play this track.");
          setIsPlaying(false);
          loadedIdRef.current = null;
          realSrcRef.current = null;
        }
      } finally {
        setIsLoading(false);
      }
    },
    [volume],
  );

  const activateIndex = useCallback(
    (q: PlayerTrack[], i: number, shouldPlay: boolean) => {
      const track = q[i];
      if (!track) return;
      setQueue(q);
      setIndex(i);
      setCurrent(track);
      setCurrentTime(0);
      setDuration(0);
      loadedIdRef.current = null;
      // Stop crediting the outgoing track's events to the incoming one, so the
      // progress bar cannot keep creeping while the new signed URL is in flight.
      realSrcRef.current = null;
      if (shouldPlay) void loadAndPlay(track, true);
    },
    [loadAndPlay],
  );

  // Asking for playback means asking to HEAR it. The homepage hero starts the
  // shared element muted (the only autoplay browsers allow) and that flag
  // outlives the hero — a visitor who left the homepage without interacting
  // would then hit Play on /music and watch the timer run in total silence.
  // Every deliberate "start playing" path clears it.
  const startAudible = useCallback(() => {
    if (mutedRef.current) setMuted(false);
  }, [setMuted]);

  // True when the element is not currently holding the real track's signed URL —
  // it has nothing loaded yet, or it still holds the silent unlock clip. Checking
  // the element's own `src` (not just `loadedIdRef`) is what makes an orphaned
  // clip self-healing: bookkeeping can say "track loaded" while the source is
  // actually the clip, and only the element knows the truth.
  const needsRealSrc = useCallback(
    (audio: HTMLAudioElement, track: PlayerTrack) =>
      loadedIdRef.current !== trackKey(track) ||
      realSrcRef.current === null ||
      audio.src !== realSrcRef.current,
    [],
  );

  const togglePlay = useCallback(() => {
    unlockPlayback();
    const audio = getAudio();
    if (!audio || !current) return;
    // Restored or not-yet-loaded track: fetch a fresh signed URL, then play.
    if (needsRealSrc(audio, current)) {
      startAudible();
      void loadAndPlay(current, true);
      return;
    }
    if (audio.paused) {
      startAudible();
      userPausedRef.current = false;
      void audio.play().catch(() => undefined);
    } else {
      userPausedRef.current = true;
      audio.pause();
    }
  }, [
    current,
    loadAndPlay,
    getAudio,
    unlockPlayback,
    startAudible,
    needsRealSrc,
  ]);

  // "The visitor just asked to HEAR this" — unlock inside the gesture, guarantee
  // the element is on the real track's signed URL, unmute, and play. Unlike
  // togglePlay it can never pause, so a caller that fires on a bare interaction
  // (the hero's first-tap / Tap-for-sound handlers) needs no `isPlaying` test.
  // Those tests were the bug: they gated recovery of the real src on a value read
  // from a stale render closure, so a tap could unlock and then decide not to
  // reload — stranding the silent clip as the source with `ended: true`.
  const playAudible = useCallback(() => {
    const audio = getAudio();
    if (!audio || !current) return;
    // Unmute BEFORE unlocking: iOS grants permission matching the element's
    // muted state at unlock time, so unlocking while muted only buys the right
    // to keep playing silently.
    startAudible();
    unlockPlayback();
    if (needsRealSrc(audio, current)) {
      void loadAndPlay(current, true);
      return;
    }
    userPausedRef.current = false;
    void audio.play().catch(() => undefined);
  }, [
    current,
    getAudio,
    unlockPlayback,
    startAudible,
    loadAndPlay,
    needsRealSrc,
  ]);

  const playQueue = useCallback(
    (tracks: PlayerTrack[], startIndex: number) => {
      const target = tracks[startIndex];
      if (!target) return;
      // This is a direct user gesture — unlock the element so the async
      // fetch-then-play path below is permitted on iOS.
      unlockPlayback();
      startAudible();
      // A deliberate track/queue selection exits radio mode so we don't
      // reshuffle away from what the user just chose.
      setRadioMode(false);
      radioModeRef.current = false;
      setRadioStationKey(null);
      // Clicking the already-active track toggles play/pause. Compare via
      // trackKey so legacy id=5 and studio id="5" never masquerade as each
      // other on mixed lists.
      const targetKey = trackKey(target);
      if (
        current &&
        trackKey(current) === targetKey &&
        loadedIdRef.current === targetKey
      ) {
        setQueue(tracks);
        setIndex(startIndex);
        togglePlay();
        return;
      }
      activateIndex(tracks, startIndex, true);
    },
    [current, activateIndex, togglePlay, unlockPlayback, startAudible],
  );

  // --- Radio mode -----------------------------------------------------------
  // Radio is not a separate engine: it is this player fed a rotation that
  // reshuffles forever. The homepage hero, the bottom/floating bar and the
  // /social/radio page are three views of this one station.

  const playRadio = useCallback(
    (
      tracks: PlayerTrack[],
      options: {
        key?: string;
        preserveOrder?: boolean;
        keepMuted?: boolean;
      } = {},
    ) => {
      if (!tracks.length) return;
      const { key = null, preserveOrder = false, keepMuted = false } = options;
      // Only the homepage's muted autoplay wants to stay silent; every other
      // caller is a user gesture asking to hear something.
      if (!keepMuted) startAudible();
      preserveOrderRef.current = preserveOrder;
      setRadioMode(true);
      radioModeRef.current = true;
      setRadioStationKey(key);
      activateIndex(buildRotation(tracks, preserveOrder), 0, true);
    },
    [activateIndex, startAudible],
  );

  const startRadio = useCallback(
    async (
      mode: "all" | "foryou" = "all",
      options: { muted?: boolean } = {},
    ) => {
      if (options.muted) {
        // Homepage autoplay — NOT a user gesture, so deliberately do not spend
        // the one-shot unlock here: play() would be rejected while unlockedRef
        // flipped to true, leaving the element permanently "unlocked" but still
        // blocked. The hero's first-interaction handler does the real unlock.
        // Force muted BEFORE the async load so audio.play() is autoplay-eligible
        // when it finally runs, and go through getAudio() because this runs from
        // the hero's mount effect, i.e. before the provider's own mount effect.
        mutedRef.current = true;
        const audio = getAudio();
        if (audio) audio.muted = true;
        setMutedState(true);
      } else {
        // Turning on radio is a user gesture; bless the element before the async
        // pool fetch so the first shuffled track can actually play on iOS.
        unlockPlayback();
      }
      setRadioLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/radio/pool?mode=${mode}`, {
          cache: "no-store",
          headers: await authHeaders(),
        });
        if (!res.ok) throw new Error("pool request failed");
        const data: { tracks?: PlayerTrack[] } = await res.json();
        const pool = (data.tracks ?? []).map<PlayerTrack>((t) => ({
          ...t,
          sourceType: t.sourceType ?? "legacy",
        }));
        if (!pool.length) {
          setError("No tracks available for radio right now.");
          return;
        }
        playRadio(pool, { key: mode, keepMuted: options.muted });
      } catch {
        setError("Couldn't start radio.");
      } finally {
        setRadioLoading(false);
      }
    },
    [playRadio, getAudio, unlockPlayback],
  );

  const reshuffleRadio = useCallback(() => {
    // Always a user gesture (the Radio page's shuffle control).
    unlockPlayback();
    if (!queue.length) return;
    activateIndex(buildRotation(queue, preserveOrderRef.current), 0, true);
  }, [queue, activateIndex, unlockPlayback]);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (audio && !audio.paused) {
      userPausedRef.current = true;
      audio.pause();
    }
  }, []);

  const stopRadio = useCallback(() => {
    setRadioMode(false);
    radioModeRef.current = false;
    setRadioStationKey(null);
    const audio = audioRef.current;
    if (audio) {
      userPausedRef.current = true;
      audio.pause();
    }
  }, []);

  const next = useCallback(() => {
    unlockPlayback();
    if (index + 1 < queue.length) activateIndex(queue, index + 1, true);
    else if (radioModeRef.current && queue.length)
      activateIndex(buildRotation(queue, preserveOrderRef.current), 0, true);
  }, [index, queue, activateIndex, unlockPlayback]);

  const seek = useCallback((fraction: number) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(1, fraction)) * audio.duration;
  }, []);

  const prev = useCallback(() => {
    unlockPlayback();
    // Restart current if more than 3s in or already at the first track.
    const audio = audioRef.current;
    if (index <= 0 || (audio && audio.currentTime > 3)) {
      seek(0);
      return;
    }
    activateIndex(queue, index - 1, true);
  }, [index, queue, activateIndex, seek, unlockPlayback]);

  const setVolume = useCallback((v: number) => {
    setVolumeState(Math.max(0, Math.min(1, v)));
  }, []);

  // Keep the "ended" auto-advance handler pointing at the latest queue/index.
  useEffect(() => {
    advanceRef.current = () => {
      // A user-initiated pause must never be overridden by auto-advance.
      if (userPausedRef.current) return;
      if (index + 1 < queue.length) {
        activateIndex(queue, index + 1, true);
      } else if (radioModeRef.current && queue.length) {
        // Radio mode never ends: rebuild the rotation and keep going.
        activateIndex(buildRotation(queue, preserveOrderRef.current), 0, true);
      } else {
        // Last track finished: stop cleanly but keep it shown, paused at its
        // end. Do NOT reset progress or clear `current` (no placeholder wipe).
        setIsPlaying(false);
      }
    };
  }, [index, queue, activateIndex]);

  // --- OS media session -----------------------------------------------------
  // Publishes the playing track to the OS so Bluetooth head units (AVRCP),
  // CarPlay, Android Auto and lock screens show real title/artist/artwork and
  // their hardware buttons drive this player instead of showing "Unknown".
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }
    const ms = navigator.mediaSession;
    if (!current) {
      try {
        ms.metadata = null;
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      ms.metadata = new MediaMetadata({
        title: current.title || "MELORI MUSIC",
        artist: current.artistName || "MELORI MUSIC",
        album: current.album || "MELORI MUSIC",
        artwork: current.coverUrl
          ? [
              // Same URL at several advertised sizes — head units pick what
              // fits. The sizes hint is a preference signal, not a promise.
              { src: current.coverUrl, sizes: "96x96", type: "image/jpeg" },
              { src: current.coverUrl, sizes: "256x256", type: "image/jpeg" },
              { src: current.coverUrl, sizes: "512x512", type: "image/jpeg" },
            ]
          : [],
      });
    } catch {
      /* older browsers may throw constructing MediaMetadata; ignore */
    }
  }, [current]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }
    try {
      navigator.mediaSession.playbackState = isPlaying
        ? "playing"
        : current
          ? "paused"
          : "none";
    } catch {
      /* ignore */
    }
  }, [isPlaying, current]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }
    if (typeof navigator.mediaSession.setPositionState !== "function") return;
    if (!Number.isFinite(duration) || duration <= 0) return;
    if (!Number.isFinite(currentTime) || currentTime < 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        position: Math.min(currentTime, duration),
        playbackRate: 1,
      });
    } catch {
      /* some browsers reject stale states — ignore */
    }
  }, [currentTime, duration]);

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
        /* action unsupported on this browser — ignore */
      }
    };
    setHandler("play", () => {
      if (!isPlaying) togglePlay();
    });
    setHandler("pause", () => {
      if (isPlaying) togglePlay();
    });
    setHandler("nexttrack", () => next());
    setHandler("previoustrack", () => prev());
    // Some head units send stop instead of pause when audio is cut.
    setHandler("stop", () => {
      if (isPlaying) pause();
    });
    return () => {
      setHandler("play", null);
      setHandler("pause", null);
      setHandler("nexttrack", null);
      setHandler("previoustrack", null);
      setHandler("stop", null);
    };
  }, [isPlaying, togglePlay, next, prev, pause]);

  return (
    <PlayerContext.Provider
      value={{
        current,
        queue,
        index,
        isPlaying,
        isLoading,
        currentTime,
        duration,
        volume,
        muted,
        error,
        isSample,
        sampleEnded,
        radioMode,
        radioLoading,
        radioStationKey,
        startRadio,
        playRadio,
        reshuffleRadio,
        stopRadio,
        hasNext: index + 1 < queue.length,
        hasPrev: queue.length > 1 && index > 0,
        playQueue,
        togglePlay,
        playAudible,
        pause,
        next,
        prev,
        seek,
        setVolume,
        setMuted,
        unlockPlayback,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
}
