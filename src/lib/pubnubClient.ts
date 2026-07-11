"use client";

// ---------------------------------------------------------------------------
// PubNub client wrapper for MELORI Spaces presence signaling.
//
// Design notes (mirrors agoraClient.ts conventions)
// -------------------------------------------------
// - One module-level PubNub instance per active space page, so rejoins under
//   React StrictMode / Fast Refresh don't leak subscriptions.
// - PubNub is browser-capable but we still lazy-import so any server component
//   transitively importing this file doesn't pull it into the RSC bundle.
// - The access token is minted server-side by POST
//   /api/social/spaces/[spaceId]/pubnub-auth (Superfan-gated, same as Agora).
// - Presence is the whole point: subscribing with `withPresence: true` makes
//   PubNub count this user in the channel's occupancy. When the user closes
//   the tab, PubNub emits a `leave` (explicit) or `timeout` (crash) presence
//   event server-side, which drives the room-vanish webhook.
// - We DO NOT try to end the room from the client. The server webhook is the
//   single authority on "occupancy hit zero → end room". The client just
//   participates in presence and relays a best-effort unsubscribe on leave.
// ---------------------------------------------------------------------------

import { authFetch } from "@/lib/authClient";

type AnyPubNub = any;

export interface PresenceState {
  occupancy: number;
  uuids: string[];
}

// A lightweight peer-to-peer signal fanned out over the space channel. Unlike
// `__system` messages (which the SERVER publishes, e.g. "space-ended"), these
// are published by participants for instant in-room UX: raise-hand and
// reactions. They carry `__signal: true` so the listener can route them
// separately from server system messages.
export interface SpaceSignal {
  type: "reaction" | "hand";
  // reaction payload
  emoji?: string;
  // when present, the reaction is aimed at a specific participant (their user
  // id) and should animate over that person's avatar instead of center-screen
  target?: string;
  // raise-hand payload
  raised?: boolean;
  // who sent it (PubNub publisher uuid is also on the envelope, but we echo it
  // in the body so consumers don't depend on transport specifics)
  uuid?: string;
  // client timestamp (ms) — used as a de-dupe / ordering hint
  ts?: number;
}

export interface JoinPresenceOptions {
  spaceId: string;
  uuid: string;
  onPresence?: (state: PresenceState) => void;
  onSystemSignal?: (payload: Record<string, unknown>) => void;
  // Fired for peer signals (reactions, raise-hand) published by OTHER
  // participants. We suppress echoes of the local user's own signals.
  onSignal?: (signal: SpaceSignal) => void;
  onError?: (err: Error) => void;
}

interface ActivePresence {
  pubnub: AnyPubNub;
  channel: string;
  spaceId: string;
  uuid: string;
  listener: any;
  renewTimer: ReturnType<typeof setTimeout> | null;
}

let active: ActivePresence | null = null;

function channelFor(spaceId: string): string {
  return `space-${spaceId}`;
}

async function fetchToken(spaceId: string): Promise<{
  token: string;
  subscribeKey: string;
  ttlMinutes: number;
}> {
  const res = await authFetch(`/api/social/spaces/${spaceId}/pubnub-auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `pubnub-auth ${res.status}`);
  }
  const data = await res.json();
  if (!data?.token) throw new Error("pubnub-auth: empty token");
  if (!data?.subscribeKey) throw new Error("pubnub-auth: missing subscribeKey");
  return {
    token: data.token,
    subscribeKey: data.subscribeKey,
    ttlMinutes: data.ttlMinutes ?? 60,
  };
}

// Join the space's presence channel. Idempotent per space.
export async function joinPresence(opts: JoinPresenceOptions): Promise<void> {
  if (typeof window === "undefined") return;

  if (active && active.spaceId === opts.spaceId) return; // already present
  if (active) await leavePresence();

  const { token, subscribeKey, ttlMinutes } = await fetchToken(opts.spaceId);

  const PubNub = (await import("pubnub")).default;
  const channel = channelFor(opts.spaceId);

  const pubnub: AnyPubNub = new PubNub({
    subscribeKey,
    userId: opts.uuid,
    // Heartbeat drives presence-timeout. 60s heartbeat with a 300s presence
    // timeout window means a crashed tab is detected within ~5 min at worst,
    // and an explicit tab close fires `leave` instantly.
    heartbeatInterval: 60,
    presenceTimeout: 300,
    restore: true,
  });
  pubnub.setToken(token);

  const listener = {
    presence: (evt: any) => {
      // evt.action ∈ join | leave | timeout | state-change | interval
      opts.onPresence?.({
        occupancy: evt.occupancy ?? 0,
        uuids: Array.isArray(evt.uuid) ? evt.uuid : evt.uuid ? [evt.uuid] : [],
      });
    },
    message: (evt: any) => {
      const msg = evt.message;
      if (!msg || typeof msg !== "object") return;
      if (msg.__system) {
        opts.onSystemSignal?.(msg as Record<string, unknown>);
        return;
      }
      if (msg.__signal) {
        // Ignore our own signals echoed back by PubNub — we already applied
        // them optimistically on send.
        const from = msg.uuid ?? evt.publisher;
        if (from && from === opts.uuid) return;
        opts.onSignal?.(msg as SpaceSignal);
      }
    },
    status: (evt: any) => {
      if (evt.category === "PNAccessDeniedCategory") {
        opts.onError?.(new Error("PubNub access denied (token expired?)"));
      }
    },
  };
  pubnub.addListener(listener);

  pubnub.subscribe({ channels: [channel], withPresence: true });

  // Proactive token renewal ~1 min before TTL, mirroring the Agora flow.
  const renewMs = Math.max((ttlMinutes - 1) * 60_000, 30_000);
  const renewTimer = setTimeout(async function renew() {
    try {
      const fresh = await fetchToken(opts.spaceId);
      pubnub.setToken(fresh.token);
      if (active) {
        active.renewTimer = setTimeout(
          renew,
          Math.max((fresh.ttlMinutes - 1) * 60_000, 30_000),
        );
      }
    } catch (err) {
      opts.onError?.(err as Error);
    }
  }, renewMs);

  active = {
    pubnub,
    channel,
    spaceId: opts.spaceId,
    uuid: opts.uuid,
    listener,
    renewTimer,
  };
}

// Leave presence: explicit unsubscribe so PubNub fires a `leave` event right
// away (instead of waiting for the presence timeout). Idempotent.
export async function leavePresence(): Promise<void> {
  if (!active) return;
  const a = active;
  active = null;
  if (a.renewTimer) clearTimeout(a.renewTimer);
  try {
    a.pubnub.unsubscribe({ channels: [a.channel] });
    a.pubnub.removeListener(a.listener);
    // Explicitly signal leave for immediate presence emission, then release.
    if (typeof a.pubnub.stop === "function") a.pubnub.stop();
    else if (typeof a.pubnub.destroy === "function") a.pubnub.destroy();
  } catch (err) {
    console.warn("pubnub leave failed", err);
  }
}

// One-shot occupancy read (used for UI, e.g. "N here now").
export async function hereNow(spaceId: string): Promise<number> {
  if (!active || active.spaceId !== spaceId) return 0;
  try {
    const res = await active.pubnub.hereNow({
      channels: [channelFor(spaceId)],
      includeUUIDs: false,
    });
    return res.channels?.[channelFor(spaceId)]?.occupancy ?? 0;
  } catch {
    return 0;
  }
}

export function getPresenceSession() {
  return active
    ? { spaceId: active.spaceId, uuid: active.uuid, channel: active.channel }
    : null;
}

// Publish a peer signal (reaction or raise-hand) to the whole room. Best-effort
// and non-throwing: PubNub is additive, so a failed publish must never break
// the local UI (the caller already applied the change optimistically, and the
// DB stays the source of truth for raise-hand). No-op if not currently present
// in this space (e.g. PubNub not configured / join failed).
export async function publishSignal(
  spaceId: string,
  signal: SpaceSignal,
): Promise<void> {
  if (!active || active.spaceId !== spaceId) return;
  try {
    await active.pubnub.publish({
      channel: active.channel,
      message: {
        __signal: true,
        uuid: active.uuid,
        ts: Date.now(),
        ...signal,
      },
    });
  } catch (err) {
    console.warn("pubnub publishSignal failed", err);
  }
}
