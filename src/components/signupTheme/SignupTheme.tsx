"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

// The Melori theme on the join pages (Karl, 2026-09-10): "melorimusic.org",
// looping at 30-40% while people sign up. Mounted by the /platform and
// /register layouts only — the door ("/" signed out) and Create account.
//
// WHY IT WAITS FOR A TAP
// Chrome, Safari and every phone block sound that starts on its own when a
// page opens. So the song starts on the visitor's first touch anywhere on the
// page (tapping the email box counts), and the button top-right says so.
// Nothing is downloaded until then, so a visitor who leaves costs no data.
//
// VOLUME
// 35%. iPhone Safari ignores a page's volume setting on <audio>, so where the
// setting doesn't stick the sound is routed through a Web Audio gain node.
//
// MUTE
// Remembered on this device. Leaving the page (signing up) stops the song.
//
// THE FILE
// images/site/melori-theme.mp3 in Supabase Storage (public bucket, same place
// as the door's header photo), so it can be swapped without a deploy. If it is
// missing, the first tap finds nothing, the button disappears, and the page
// carries on silently.

const THEME_VOLUME = 0.35;
const MUTE_KEY = "melori.signup-theme.muted";
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const THEME_SRC = SUPABASE_URL
  ? `${SUPABASE_URL}/storage/v1/object/public/images/site/melori-theme.mp3`
  : "";

type State = "waiting" | "playing" | "muted" | "unavailable";

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* storage blocked: the choice lasts for this visit only */
  }
}

export default function SignupTheme() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const startedRef = useRef(false);
  const [state, setState] = useState<State>(THEME_SRC ? "waiting" : "unavailable");

  const ensureAudio = useCallback((): HTMLAudioElement | null => {
    if (!THEME_SRC) return null;
    if (audioRef.current) return audioRef.current;
    const el = new Audio();
    el.loop = true;
    el.preload = "auto";
    el.addEventListener("error", () => setState("unavailable"));
    el.volume = THEME_VOLUME;
    // iPhone: volume is read-only on media elements, so it stays at 1. Only
    // then is the sound routed through Web Audio, which needs a CORS request —
    // everywhere else the file loads as a plain request.
    const volumeIgnored = Math.abs(el.volume - THEME_VOLUME) > 0.01;
    if (volumeIgnored) el.crossOrigin = "anonymous";
    el.src = THEME_SRC;
    if (volumeIgnored) {
      try {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctx) {
          const ctx = new Ctx();
          const gain = ctx.createGain();
          gain.gain.value = THEME_VOLUME;
          ctx.createMediaElementSource(el).connect(gain).connect(ctx.destination);
          ctxRef.current = ctx;
        }
      } catch {
        /* fall back to the element's own (full) volume */
      }
    }
    audioRef.current = el;
    return el;
  }, []);

  const play = useCallback(async () => {
    const el = ensureAudio();
    if (!el) return;
    try {
      // play() first, inside the tap itself: iPhone only honours a play that
      // starts in the same moment as the touch.
      const playing = el.play();
      void ctxRef.current?.resume().catch(() => undefined);
      await playing;
      startedRef.current = true;
      setState("playing");
    } catch {
      // Still blocked (no gesture yet) — keep waiting for one.
    }
  }, [ensureAudio]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  // First touch anywhere on the page starts the song, unless muted before.
  useEffect(() => {
    if (!THEME_SRC) return;
    if (readMuted()) {
      setState("muted");
      return;
    }
    const onFirstGesture = (e: Event) => {
      if (startedRef.current || readMuted()) return;
      // The music button handles its own tap; starting here too would race it
      // and could mute the song the instant it began.
      const target = e.target as Element | null;
      if (target?.closest?.('[data-testid="signup-theme-toggle"]')) return;
      void play();
    };
    const events: (keyof DocumentEventMap)[] = ["pointerdown", "keydown", "touchstart"];
    events.forEach((e) => document.addEventListener(e, onFirstGesture, { passive: true }));
    return () => events.forEach((e) => document.removeEventListener(e, onFirstGesture));
  }, [play]);

  // Leaving the join page stops the song and releases the audio.
  useEffect(
    () => () => {
      audioRef.current?.pause();
      audioRef.current = null;
      void ctxRef.current?.close().catch(() => undefined);
      ctxRef.current = null;
    },
    [],
  );

  const toggle = () => {
    if (state === "playing") {
      pause();
      writeMuted(true);
      setState("muted");
    } else {
      writeMuted(false);
      void play();
    }
  };

  if (state === "unavailable") return null;

  const playing = state === "playing";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={playing}
      aria-label={playing ? "Mute the Melori theme" : "Play the Melori theme"}
      data-testid="signup-theme-toggle"
      className="fixed right-4 top-4 z-50 flex items-center gap-2 rounded-full border border-white/15 bg-black/55 px-3 py-2 text-xs font-medium text-white backdrop-blur transition hover:border-[#c9a96e]/60"
      style={{ top: "max(1rem, env(safe-area-inset-top))" }}
    >
      {playing ? (
        <Volume2 className="h-4 w-4 text-[#c9a96e]" aria-hidden="true" />
      ) : (
        <VolumeX className="h-4 w-4" aria-hidden="true" />
      )}
      <span>{playing ? "Mute" : state === "muted" ? "Music off" : "Tap for music"}</span>
    </button>
  );
}
