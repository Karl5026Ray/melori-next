"use client";

// ---------------------------------------------------------------------------
// In-room live signals over Supabase Realtime (replaces PubNub, 13 Oct 2026).
//
// Two private channels per room, both authorized by RLS on realtime.messages
// (migration 095_room_signals_realtime):
//
//   room:<spaceId>      members broadcast peer signals (reactions, raise-hand)
//                       and track presence ("N here").
//   room-sys:<spaceId>  read-only for members. Only the server (service role)
//                       writes here: "space-ended", "host-changed". A
//                       participant cannot forge these.
//
// Everything here is additive UX. The database stays the source of truth, so a
// failed subscribe or send must never break the room: errors are reported via
// onError / console and swallowed.
// ---------------------------------------------------------------------------

import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export interface PresenceState {
  occupancy: number;
  uuids: string[];
}

// A lightweight signal fanned out to the room. Peer signals (reaction, hand)
// come from participants.
export interface SpaceSignal {
  type: "reaction" | "hand";
  emoji?: string;
  // when present, the reaction animates over this participant's avatar
  target?: string;
  raised?: boolean;
  // sender's user id
  uuid?: string;
  // client timestamp (ms), a de-dupe / ordering hint
  ts?: number;
}

export interface JoinPresenceOptions {
  spaceId: string;
  uuid: string;
  onPresence?: (state: PresenceState) => void;
  onSystemSignal?: (payload: Record<string, unknown>) => void;
  // Signals from OTHER participants (own sends are not echoed back).
  onSignal?: (signal: SpaceSignal) => void;
  onError?: (err: Error) => void;
}

interface ActiveRoom {
  spaceId: string;
  uuid: string;
  room: RealtimeChannel;
  sys: RealtimeChannel;
}

let active: ActiveRoom | null = null;

export const roomTopic = (spaceId: string) => `room:${spaceId}`;
export const roomSystemTopic = (spaceId: string) => `room-sys:${spaceId}`;

function presenceFrom(channel: RealtimeChannel): PresenceState {
  const state = channel.presenceState() as Record<string, unknown[]>;
  const uuids = Object.keys(state);
  return { occupancy: uuids.length, uuids };
}

// Join the room's signal + presence channels. Idempotent per space.
export async function joinPresence(opts: JoinPresenceOptions): Promise<void> {
  if (typeof window === "undefined") return;
  if (active && active.spaceId === opts.spaceId) return;
  if (active) await leavePresence();

  const room = supabase.channel(roomTopic(opts.spaceId), {
    config: {
      private: true,
      broadcast: { self: false },
      presence: { key: opts.uuid },
    },
  });
  const sys = supabase.channel(roomSystemTopic(opts.spaceId), {
    config: { private: true },
  });

  room
    .on("broadcast", { event: "signal" }, ({ payload }) => {
      const signal = payload as SpaceSignal;
      if (!signal) return;
      if (signal.uuid && signal.uuid === opts.uuid) return;
      opts.onSignal?.(signal);
    })
    .on("presence", { event: "sync" }, () => {
      opts.onPresence?.(presenceFrom(room));
    });

  sys
    .on("broadcast", { event: "system" }, ({ payload }) => {
      if (payload && typeof payload === "object") {
        opts.onSystemSignal?.(payload as Record<string, unknown>);
      }
    });

  active = { spaceId: opts.spaceId, uuid: opts.uuid, room, sys };

  const report = (what: string) => (status: string, err?: Error) => {
    if (status === "SUBSCRIBED") {
      if (what === "room") {
        void room.track({ uuid: opts.uuid, at: Date.now() }).catch(() => undefined);
      }
      return;
    }
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      opts.onError?.(err ?? new Error(`room ${what} channel ${status}`));
    }
  };
  room.subscribe(report("room"));
  sys.subscribe(report("system"));
}

// Leave both channels. Untracking first makes "N here" drop immediately.
export async function leavePresence(): Promise<void> {
  if (!active) return;
  const a = active;
  active = null;
  try {
    await a.room.untrack().catch(() => undefined);
    await supabase.removeChannel(a.room);
    await supabase.removeChannel(a.sys);
  } catch (err) {
    console.warn("room signals leave failed", err);
  }
}

// Publish a peer signal (reaction or raise-hand). Best-effort, never throws;
// a no-op when this tab is not in that room's channel.
export async function publishSignal(
  spaceId: string,
  signal: SpaceSignal,
): Promise<void> {
  if (!active || active.spaceId !== spaceId) return;
  try {
    await active.room.send({
      type: "broadcast",
      event: "signal",
      payload: { ...signal, uuid: active.uuid, ts: Date.now() },
    });
  } catch (err) {
    console.warn("room publishSignal failed", err);
  }
}
