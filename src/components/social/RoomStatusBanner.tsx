"use client";

// Shared in-room connection banner for MM Spaces and Cinema. The state
// machine and copy live in src/lib/roomConnectionStatus.ts (pure, tested);
// this file only holds the React glue: a reducer hook with bounded
// auto-retry, and the banner itself.

import { useCallback, useEffect, useReducer, useState } from "react";
import {
  INITIAL_ROOM_CONNECTION,
  retryDelayMs,
  roomConnectionReducer,
  roomStatusCopy,
  roomStatusView,
  shouldAutoRetry,
  type RoomConnectionState,
} from "@/lib/roomConnectionStatus";

// `attempt` is a counter the screen puts in its LiveKit join effect's deps:
// bumping it re-requests a token and reconnects. It bumps on its own after a
// failed connect (2s/4s/8s, MAX_AUTO_RETRIES times), then only on Retry.
export function useRoomConnection() {
  const [state, dispatch] = useReducer(roomConnectionReducer, INITIAL_ROOM_CONNECTION);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    dispatch({ type: "retry" });
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!shouldAutoRetry(state)) return;
    const timer = setTimeout(retry, retryDelayMs(state.failures));
    return () => clearTimeout(timer);
  }, [state, retry]);

  return { state, dispatch, attempt, retry };
}

export function RoomStatusBanner({
  state,
  onRetry,
  onEnableSound,
}: {
  state: RoomConnectionState;
  onRetry: () => void;
  onEnableSound: () => void;
}) {
  const copy = roomStatusCopy(state);
  if (!copy) return null;
  const onAction = copy.action === "enable-sound" ? onEnableSound : onRetry;
  const isAlert = copy.urgency === "alert";
  return (
    <div
      role={isAlert ? "alert" : "status"}
      aria-live={isAlert ? "assertive" : "polite"}
      data-testid="room-status-banner"
      data-status={roomStatusView(state)}
      className="mx-auto py-1 flex max-w-2xl items-center justify-between gap-3 px-4"
    >
      <div className="flex w-full items-center justify-between gap-3 rounded-2xl border border-melori-purple/40 bg-melori-purple/15 px-4 py-2 text-sm text-white">
        <span className="min-w-0">{copy.message}</span>
        {copy.action && (
          <button
            type="button"
            onClick={onAction}
            data-testid={`room-status-${copy.action}`}
            className="shrink-0 rounded-full bg-melori-teal px-3.5 py-1.5 text-xs font-bold text-melori-void active:opacity-80"
          >
            {copy.actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
