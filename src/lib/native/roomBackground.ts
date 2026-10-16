// Keep live-room audio alive when the Android app is backgrounded or locked.
//
// WHY THIS EXISTS
// ---------------
// The Android app is a Capacitor WebView around melorimusic.org. When the user
// locks the screen or switches apps mid-room, Android freezes the cached
// process and the WebView's LiveKit/WebRTC audio stops (and from Android 11 a
// backgrounded app's mic delivers silence). The cure is a foreground service:
// an ongoing "Melori — in a live room" notification that tells Android the
// user is actively listening (type mediaPlayback) or talking (microphone).
//
// The service is a small local Capacitor plugin, "MeloriRoomAudio"
// (mobile/native/android/, installed by mobile/scripts/configure-android.sh).
// Because the app loads this site remotely, the page reaches it the same way
// it reaches @capacitor/browser: the native bridge injects the plugin headers
// and registerPlugin() from @capacitor/core proxies calls to Java.
//
// RULES (each one is a crash or a policy failure if broken)
//  - No-op everywhere except the Android app. iOS uses UIBackgroundModes=audio
//    (configure-ios.sh) and needs nothing from the page; the web needs nothing.
//  - No-op on Android app builds that predate the plugin: the site ships ahead
//    of the store build, so availability is checked, never assumed.
//  - Never throw. Rooms must work exactly as before when this fails.
//  - Start only while the page is visible: Android 12+ refuses to start a
//    foreground service from the background, and 14+ refuses a microphone one.
//    A start or a microphone upgrade wanted while hidden waits for visibility.
//  - Permissions (POST_NOTIFICATIONS on 13+, BLUETOOTH_CONNECT on 12+) are
//    requested when the user first joins a room, not at app launch.

import { useEffect, useRef } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";

export const ROOM_AUDIO_PLUGIN = "MeloriRoomAudio";

export type RoomAudioMode = "microphone" | "playback";

export interface RoomAudioStartResult {
  running: boolean;
  mode: RoomAudioMode | "none";
  reason?: string;
}

export interface RoomAudioNativePlugin {
  requestRoomPermissions(): Promise<unknown>;
  start(options: {
    mode: RoomAudioMode;
    title?: string;
    body?: string;
    leaveAction?: boolean;
  }): Promise<RoomAudioStartResult>;
  stop(): Promise<unknown>;
  addListener(
    eventName: "leaveRequested",
    listener: () => void,
  ): Promise<{ remove: () => Promise<void> | void }>;
}

export interface RoomBackgroundEnv {
  /** The native plugin, or null when this is not the Android app (or it lacks the plugin). */
  getPlugin(): RoomAudioNativePlugin | null;
  /** True while the page is on screen. */
  isVisible(): boolean;
  /** Subscribe to "page became visible"; returns an unsubscribe. */
  onVisible(listener: () => void): () => void;
}

export interface RoomBackgroundState {
  /** In a live room (joined, not ended/removed). */
  active: boolean;
  /** Publishing a microphone (on stage and unmuted). */
  publishing: boolean;
  /** Show a "Leave room" button on the notification. */
  leaveAction?: boolean;
}

export const ROOM_NOTIFICATION_TITLE = "Melori — in a live room";
export const ROOM_NOTIFICATION_BODY = "Tap to return to the room.";

let cachedPlugin: RoomAudioNativePlugin | null = null;

function defaultGetPlugin(): RoomAudioNativePlugin | null {
  try {
    if (typeof window === "undefined") return null;
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return null;
    if (!Capacitor.isPluginAvailable(ROOM_AUDIO_PLUGIN)) return null;
    if (!cachedPlugin) cachedPlugin = registerPlugin<RoomAudioNativePlugin>(ROOM_AUDIO_PLUGIN);
    return cachedPlugin;
  } catch {
    return null;
  }
}

export const defaultRoomBackgroundEnv: RoomBackgroundEnv = {
  getPlugin: defaultGetPlugin,
  isVisible: () => {
    try {
      return typeof document === "undefined" || document.visibilityState !== "hidden";
    } catch {
      return true;
    }
  },
  onVisible: (listener) => {
    if (typeof document === "undefined") return () => undefined;
    const handler = () => {
      if (document.visibilityState === "visible") listener();
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  },
};

export interface RoomBackgroundController {
  /** Declare the desired state; resolves once it has been reconciled. Never rejects. */
  update(state: RoomBackgroundState): Promise<void>;
  /** What the notification's "Leave room" button should do. */
  setLeaveHandler(handler: (() => void) | null): void;
  /** Introspection for tests and debugging. */
  snapshot(): { running: boolean; mode: RoomAudioMode | null; leaveAction: boolean };
}

export function createRoomBackgroundController(env: RoomBackgroundEnv): RoomBackgroundController {
  let desired: Required<RoomBackgroundState> = { active: false, publishing: false, leaveAction: false };
  let running = false;
  let appliedMode: RoomAudioMode | null = null;
  let appliedLeaveAction = false;
  let permissionsRequested = false;
  let leaveHandler: (() => void) | null = null;
  let leaveSubscription: { remove: () => Promise<void> | void } | null = null;
  let unsubscribeVisible: (() => void) | null = null;
  let chain: Promise<void> = Promise.resolve();

  const getPlugin = (): RoomAudioNativePlugin | null => {
    try {
      return env.getPlugin();
    } catch {
      return null;
    }
  };
  const visible = (): boolean => {
    try {
      return env.isVisible();
    } catch {
      return true;
    }
  };

  const watchVisibility = () => {
    if (unsubscribeVisible) return;
    try {
      unsubscribeVisible = env.onVisible(() => {
        void schedule();
      });
    } catch {
      unsubscribeVisible = null;
    }
  };
  const unwatchVisibility = () => {
    try {
      unsubscribeVisible?.();
    } catch {
      /* ignore */
    }
    unsubscribeVisible = null;
  };

  const removeLeaveListener = async () => {
    const sub = leaveSubscription;
    leaveSubscription = null;
    try {
      await sub?.remove();
    } catch {
      /* ignore */
    }
  };

  const ensureLeaveListener = async (plugin: RoomAudioNativePlugin) => {
    if (leaveSubscription) return;
    try {
      leaveSubscription = await plugin.addListener("leaveRequested", () => {
        try {
          leaveHandler?.();
        } catch {
          /* a broken leave handler must not take the bridge down */
        }
      });
    } catch {
      leaveSubscription = null;
    }
  };

  const reconcile = async (): Promise<void> => {
    const plugin = getPlugin();
    if (!plugin) return;

    if (!desired.active) {
      unwatchVisibility();
      await removeLeaveListener();
      if (running) {
        running = false;
        appliedMode = null;
        appliedLeaveAction = false;
        try {
          await plugin.stop();
        } catch {
          /* ignore */
        }
      }
      return;
    }

    // Retry deferred starts/upgrades when the user comes back to the room.
    watchVisibility();
    const isVisible = visible();

    if (!running) {
      if (!isVisible) return;
      if (!permissionsRequested) {
        permissionsRequested = true;
        try {
          await plugin.requestRoomPermissions();
        } catch {
          /* denied or unavailable: the service still runs without them */
        }
        // The user may have left while the permission dialog was up.
        if (!desired.active) return reconcile();
      }
      const mode: RoomAudioMode = desired.publishing ? "microphone" : "playback";
      const leaveAction = desired.leaveAction;
      try {
        const result = await plugin.start({
          mode,
          title: ROOM_NOTIFICATION_TITLE,
          body: ROOM_NOTIFICATION_BODY,
          leaveAction,
        });
        running = !!result?.running;
        appliedMode = running && result.mode !== "none" ? result.mode : null;
        appliedLeaveAction = leaveAction;
      } catch {
        running = false;
        appliedMode = null;
      }
      if (running) await ensureLeaveListener(plugin);
      return;
    }

    const leaveAction = desired.leaveAction;
    let mode: RoomAudioMode = desired.publishing ? "microphone" : "playback";
    // Claiming the microphone type from the background is refused on 14+.
    // Dropping to playback is always allowed, so only upgrades wait.
    if (mode === "microphone" && appliedMode !== "microphone" && !isVisible) {
      mode = appliedMode ?? "playback";
    }
    if (appliedMode === mode && appliedLeaveAction === leaveAction) return;
    try {
      const result = await plugin.start({
        mode,
        title: ROOM_NOTIFICATION_TITLE,
        body: ROOM_NOTIFICATION_BODY,
        leaveAction,
      });
      if (result?.running && result.mode !== "none") {
        appliedMode = result.mode;
        appliedLeaveAction = leaveAction;
      }
    } catch {
      /* keep the current type */
    }
  };

  const schedule = (): Promise<void> => {
    chain = chain.then(reconcile).catch(() => undefined);
    return chain;
  };

  return {
    update(state) {
      try {
        const active = !!state.active;
        desired = {
          active,
          publishing: active && !!state.publishing,
          leaveAction: active && !!state.leaveAction,
        };
        return schedule();
      } catch {
        return Promise.resolve();
      }
    },
    setLeaveHandler(handler) {
      leaveHandler = handler;
    },
    snapshot() {
      return { running, mode: appliedMode, leaveAction: appliedLeaveAction };
    },
  };
}

/** App-wide controller: only one live room is ever on screen. */
export const roomBackground = createRoomBackgroundController(defaultRoomBackgroundEnv);

/**
 * Keep this room's audio alive while the Android app is backgrounded.
 *
 *   useRoomBackgroundMode({ active: joined && !ended, publishing: onStage && !muted, onLeave });
 *
 * `onLeave` runs when the user taps "Leave room" on the notification; omit it
 * and the notification has no Leave button (tapping it still returns to the
 * room). A no-op on the web and on iOS.
 */
export function useRoomBackgroundMode({
  active,
  publishing,
  onLeave,
}: Omit<RoomBackgroundState, "leaveAction"> & { onLeave?: () => void }): void {
  const onLeaveRef = useRef(onLeave);
  useEffect(() => {
    onLeaveRef.current = onLeave;
  }, [onLeave]);

  const leaveAction = typeof onLeave === "function";
  useEffect(() => {
    void roomBackground.update({ active, publishing, leaveAction });
  }, [active, publishing, leaveAction]);

  useEffect(() => {
    roomBackground.setLeaveHandler(() => onLeaveRef.current?.());
    const onPageHide = () => {
      void roomBackground.update({ active: false, publishing: false });
    };
    if (typeof window !== "undefined") window.addEventListener("pagehide", onPageHide);
    return () => {
      if (typeof window !== "undefined") window.removeEventListener("pagehide", onPageHide);
      roomBackground.setLeaveHandler(null);
      void roomBackground.update({ active: false, publishing: false });
    };
  }, []);
}
