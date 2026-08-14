"use client";

import { useEffect, useState, useCallback } from "react";

// The four notification categories a signed-in member can toggle. Phone/video
// calls are wired in advance of the 1:1 call feature landing — the flag is
// consulted, the sound is defined, and `playNotificationSound("phoneCall")`
// just works once callers exist.
export type NotificationSound =
  | "message"
  | "phoneCall"
  | "videoCall"
  | "onlineNow";

export interface NotificationPreferences {
  message: boolean;
  phoneCall: boolean;
  videoCall: boolean;
  onlineNow: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  message: true,
  phoneCall: true,
  videoCall: true,
  onlineNow: true,
};

export const NOTIFICATION_LABELS: Record<NotificationSound, string> = {
  message: "Messages",
  phoneCall: "Phone calls",
  videoCall: "Video calls",
  onlineNow: "Online now",
};

const STORAGE_KEY = "melori:notif-prefs";

export function readNotificationPreferences(): NotificationPreferences {
  if (typeof window === "undefined") return DEFAULT_NOTIFICATION_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_NOTIFICATION_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<NotificationPreferences>;
    return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...parsed };
  } catch {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }
}

function writeNotificationPreferences(prefs: NotificationPreferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    // Broadcast to hooks in other tabs / other mount points in this tab so
    // toggling in one place updates everywhere immediately.
    window.dispatchEvent(new CustomEvent(PREFS_EVENT));
  } catch {
    /* storage disabled / quota — silently ignored */
  }
}

const PREFS_EVENT = "melori:notif-prefs-changed";

// React hook: current preferences + a setter. Any mount point can render a
// toggle strip; every consumer stays in sync via the CustomEvent above.
export function useNotificationPreferences(): [
  NotificationPreferences,
  (next: NotificationPreferences) => void,
] {
  const [prefs, setPrefs] = useState<NotificationPreferences>(
    DEFAULT_NOTIFICATION_PREFERENCES,
  );

  useEffect(() => {
    setPrefs(readNotificationPreferences());
    const sync = () => setPrefs(readNotificationPreferences());
    window.addEventListener(PREFS_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(PREFS_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const update = useCallback((next: NotificationPreferences) => {
    setPrefs(next);
    writeNotificationPreferences(next);
  }, []);

  return [prefs, update];
}

// -----------------------------------------------------------------------------
// Synthesized tones — no audio-file dependencies, so nothing to bundle, host,
// or license. Web Audio requires a user gesture before it can play; the first
// notification after page load may be silent until any click/tap happens on
// the page. Once primed, subsequent plays work throughout the session.
// -----------------------------------------------------------------------------

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    return ctx;
  } catch {
    return null;
  }
}

// One tone with a linear attack + release envelope. Envelope kills the click
// you'd otherwise hear when a raw oscillator starts and stops.
function tone(
  ac: AudioContext,
  freq: number,
  atOffset: number,
  duration: number,
  peak = 0.15,
): void {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  osc.connect(gain).connect(ac.destination);
  const start = ac.currentTime + atOffset;
  const end = start + duration;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peak, start + 0.01);
  gain.gain.linearRampToValueAtTime(0, end);
  osc.start(start);
  osc.stop(end + 0.02);
}

export function playNotificationSound(
  sound: NotificationSound,
  overridePrefs?: NotificationPreferences,
): void {
  const prefs = overridePrefs ?? readNotificationPreferences();
  if (!prefs[sound]) return;
  const ac = getContext();
  if (!ac) return;
  if (ac.state === "suspended") void ac.resume();

  switch (sound) {
    case "message":
      // Two-tone ding — high → low, like a soft Messenger chime.
      tone(ac, 880, 0, 0.12);
      tone(ac, 660, 0.12, 0.14);
      return;
    case "phoneCall":
      // Repeating A4 tone (~classic ring cadence). Kept short — the caller UI
      // will drive repetition when the feature ships; this is a single burst.
      tone(ac, 440, 0, 0.5, 0.2);
      return;
    case "videoCall":
      // Two-note chord: A4 + E5, slightly softer per-note so the sum sits
      // level with the phone tone.
      tone(ac, 440, 0, 0.5, 0.14);
      tone(ac, 659, 0, 0.5, 0.1);
      return;
    case "onlineNow":
      // Soft single C6 chime — a friend just came online, not an alert.
      tone(ac, 1046, 0, 0.15, 0.08);
      return;
  }
}
