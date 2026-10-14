// In-room connection status for MM Spaces and Cinema (and the token/connect
// failure surface in Faces). Pure and dependency-free so scripts/*.test.ts can
// run it under plain `tsx`; the React hook + banner live in
// src/components/social/RoomStatusBanner.tsx.
//
// Why this exists: when the LiveKit token request or room.connect() failed,
// the error only reached console.warn. The user looked joined but heard
// nothing. A final Disconnected (reconnect gave up) left "Reconnecting to
// audio…" on screen forever, a kick looked like a generic error, and Spaces
// never noticed the browser blocking audio playback. Every one of those now
// maps to a visible state with one plain action.

import { classifyDisconnectReason, ROOM_ENDED_MESSAGE } from "@/lib/roomDisconnect";

export type RoomConnectionKind =
  | "ok"
  | "connecting" // a retry is in flight; no banner (avoids flicker)
  | "reconnecting" // LiveKit is self-healing a blip
  | "connect-failed" // token request or connect() failed
  | "lost" // final Disconnected: LiveKit gave up reconnecting
  | "removed" // kicked / banned
  | "ended"; // the room itself is gone

export interface RoomConnectionState {
  kind: RoomConnectionKind;
  // Consecutive failed connect attempts since the last successful connect.
  failures: number;
  // The browser is holding remote audio back until a user gesture. Tracked
  // apart from `kind` because LiveKit reports it DURING connect, before the
  // join promise resolves; folding it into `kind` let "connected" erase it.
  audioBlocked: boolean;
}

export const INITIAL_ROOM_CONNECTION: RoomConnectionState = {
  kind: "ok",
  failures: 0,
  audioBlocked: false,
};

// What the banner shows: connection problems outrank blocked audio.
export type RoomStatusView = RoomConnectionKind | "audio-blocked";
export function roomStatusView(state: RoomConnectionState): RoomStatusView {
  if (state.kind === "ok" && state.audioBlocked) return "audio-blocked";
  return state.kind;
}

// After the first failure we try again on our own this many times (with
// backoff), then wait for the user to tap Retry.
export const MAX_AUTO_RETRIES = 3;

export type JoinFailureKind = "mic-denied" | "removed" | "ended" | "network";

// The token route answers 403 {banned:true} for a room ban and 409 when the
// room is no longer live; fetchToken copies `status`/`banned` onto the Error.
export function classifyJoinFailure(err: unknown): JoinFailureKind {
  const e = (err ?? {}) as { message?: unknown; status?: unknown; banned?: unknown };
  const message = typeof e.message === "string" ? e.message : "";
  if (/NotAllowedError|Permission|permission denied/i.test(message)) return "mic-denied";
  if (e.banned === true || /removed from this room/i.test(message)) return "removed";
  if (e.status === 409 || /not active/i.test(message)) return "ended";
  return "network";
}

export type RoomConnectionEvent =
  | { type: "connected" }
  | { type: "reconnecting" }
  | { type: "reconnected" }
  | { type: "join-failed"; error: unknown }
  | { type: "disconnected"; reason?: string | number | null }
  | { type: "removed" }
  | { type: "audio-playback"; canPlay: boolean }
  | { type: "retry" };

const TERMINAL: ReadonlySet<RoomConnectionKind> = new Set(["removed", "ended"]);

export function roomConnectionReducer(
  state: RoomConnectionState,
  event: RoomConnectionEvent,
): RoomConnectionState {
  // Nothing un-removes you or un-ends a room from the client side.
  if (TERMINAL.has(state.kind)) return state;
  switch (event.type) {
    case "connected":
      return { ...state, kind: "ok", failures: 0 };
    case "reconnecting":
      return { ...state, kind: "reconnecting" };
    case "reconnected":
      return { ...state, kind: "ok" };
    case "removed":
      return { ...state, kind: "removed" };
    case "disconnected": {
      const c = classifyDisconnectReason(event.reason);
      if (c === "room-ended") return { ...state, kind: "ended" };
      if (c === "removed") return { ...state, kind: "removed" };
      return { ...state, kind: "lost" };
    }
    case "join-failed": {
      const f = classifyJoinFailure(event.error);
      // A blocked microphone still leaves the listener connected; the screens
      // show their own mic notice for it.
      if (f === "mic-denied") return state;
      if (f === "removed") return { ...state, kind: "removed" };
      if (f === "ended") return { ...state, kind: "ended" };
      return { ...state, kind: "connect-failed", failures: state.failures + 1 };
    }
    case "audio-playback":
      if (state.audioBlocked === !event.canPlay) return state;
      return { ...state, audioBlocked: !event.canPlay };
    case "retry":
      return { ...state, kind: "connecting" };
    default:
      return state;
  }
}

export function shouldAutoRetry(state: RoomConnectionState): boolean {
  return state.kind === "connect-failed" && state.failures <= MAX_AUTO_RETRIES;
}

// 2s, 4s, 8s.
export function retryDelayMs(failures: number): number {
  return Math.min(2000 * 2 ** Math.max(0, failures - 1), 8000);
}

export type RoomStatusAction = "retry" | "rejoin" | "enable-sound";

export interface RoomStatusCopy {
  message: string;
  action?: RoomStatusAction;
  actionLabel?: string;
  // "alert" for things the user must act on; "status" for passive progress.
  urgency: "alert" | "status";
}

export function roomStatusCopy(state: RoomConnectionState): RoomStatusCopy | null {
  switch (roomStatusView(state)) {
    case "reconnecting":
      return { message: "Reconnecting to audio…", urgency: "status" };
    case "connect-failed":
      return {
        message: "Couldn't connect to audio.",
        action: "retry",
        actionLabel: "Retry",
        urgency: "alert",
      };
    case "lost":
      return { message: "Connection lost.", action: "rejoin", actionLabel: "Rejoin", urgency: "alert" };
    case "removed":
      return { message: "You were removed from this room.", urgency: "alert" };
    case "ended":
      return { message: ROOM_ENDED_MESSAGE, urgency: "status" };
    case "audio-blocked":
      return {
        message: "Sound is paused.",
        action: "enable-sound",
        actionLabel: "Tap to enable sound",
        urgency: "alert",
      };
    default:
      return null;
  }
}

// DisconnectReason -> what the user reads. Convenience for tests and callers
// that only have a reason in hand.
export function disconnectMessage(reason: string | number | null | undefined): string {
  const next = roomConnectionReducer(INITIAL_ROOM_CONNECTION, { type: "disconnected", reason });
  return roomStatusCopy(next)?.message ?? "";
}
