"use client";

// LiveKit RTC client wrapper for MM Social spaces.
//
// This intentionally mirrors the public API of the previous agoraClient.ts
// (joinChannel / setMuted / setRole / leaveChannel / getSession) so the
// Spaces page swaps its import with minimal changes.
//
// Design notes
// ------------
// - One Room per active space page (module-level singleton).
// - The livekit-client SDK is dynamically imported inside joinChannel() to
//   avoid pulling browser globals into any server component.
// - Tokens are minted server-side by POST /api/livekit-token (Superfan-gated).
// - Publisher = host + speakers; subscriber = audience.
// - The ActiveSpeakers event writes local is_speaking back to
//   space_participants for the local user only, throttled to 500 ms.

import { authFetch } from "@/lib/authClient";
import { supabase } from "@/lib/supabase";

type AnyRoom = any;
type AnyTrack = any;

export type LiveKitRole = "publisher" | "subscriber";

export interface JoinOptions {
  spaceId: string;
  role: LiveKitRole;
  onRemoteUserSpeaking?: (identity: string, speaking: boolean) => void;
  onLocalSpeakingChange?: (isSpeaking: boolean) => void;
  onError?: (err: Error) => void;
}

interface ActiveSession {
  room: AnyRoom | null;
  spaceId: string | null;
  identity: string | null;
  role: LiveKitRole;
  localAudioTrack: AnyTrack | null;
  cleanups: Array<() => void>;
}

let session: ActiveSession = {
  room: null,
  spaceId: null,
  identity: null,
  role: "subscriber",
  localAudioTrack: null,
  cleanups: [],
};

async function fetchToken(spaceId: string, role: LiveKitRole) {
  const res = await authFetch("/api/livekit-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ space_id: spaceId, role }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail?.error || `token request failed (${res.status})`);
  }
  return res.json() as Promise<{
    token: string;
    url: string;
    room: string;
    identity: string;
    role: LiveKitRole;
  }>;
}

let lastSpeakingWrite = 0;
async function writeLocalSpeaking(spaceId: string, identity: string, speaking: boolean) {
  const now = Date.now();
  if (now - lastSpeakingWrite < 500) return;
  lastSpeakingWrite = now;
  try {
    await supabase
      .from("space_participants")
      .update({ is_speaking: speaking })
      .eq("space_id", spaceId)
      .eq("user_id", identity)
      .is("left_at", null);
  } catch {
    // Presence write is best-effort; audio must not depend on it.
  }
}

export async function joinChannel(opts: JoinOptions): Promise<void> {
  // Re-join cleanly if already connected somewhere.
  if (session.room) {
    await leaveChannel();
  }

  const { Room, RoomEvent, Track } = await import("livekit-client");

  try {
    const creds = await fetchToken(opts.spaceId, opts.role);
    const room: AnyRoom = new Room({ adaptiveStream: true, dynacast: true });

    const onActiveSpeakers = (speakers: Array<{ identity: string }>) => {
      const speakingIds = new Set(speakers.map((s) => s.identity));
      speakers.forEach((s) => {
        if (s.identity !== creds.identity) {
          opts.onRemoteUserSpeaking?.(s.identity, true);
        }
      });
      const localSpeaking = speakingIds.has(creds.identity);
      opts.onLocalSpeakingChange?.(localSpeaking);
      void writeLocalSpeaking(opts.spaceId, creds.identity, localSpeaking);
    };
    room.on(RoomEvent.ActiveSpeakersChanged, onActiveSpeakers);
    session.cleanups.push(() => room.off(RoomEvent.ActiveSpeakersChanged, onActiveSpeakers));

    const onDisconnected = () => {
      opts.onError?.(new Error("Disconnected from space"));
    };
    room.on(RoomEvent.Disconnected, onDisconnected);
    session.cleanups.push(() => room.off(RoomEvent.Disconnected, onDisconnected));

    await room.connect(creds.url, creds.token);

    session.room = room;
    session.spaceId = opts.spaceId;
    session.identity = creds.identity;
    session.role = creds.role;

    // Publishers start with the mic enabled; subscribers stay silent.
    if (creds.role === "publisher") {
      await room.localParticipant.setMicrophoneEnabled(true);
      session.localAudioTrack = Track ? true : true;
    }
  } catch (err) {
    opts.onError?.(err as Error);
    throw err;
  }
}

export async function setMuted(muted: boolean): Promise<void> {
  if (!session.room) return;
  // Enabling the mic lazily publishes a track if the user is a publisher.
  await session.room.localParticipant.setMicrophoneEnabled(!muted);
}

export async function setRole(role: LiveKitRole): Promise<void> {
  if (!session.room || !session.spaceId) {
    session.role = role;
    return;
  }
  // Roles are enforced by the token grant, so switching to publisher requires
  // a fresh token with canPublish. Re-mint and apply mic state accordingly.
  if (role === session.role) return;

  if (role === "publisher") {
    const creds = await fetchToken(session.spaceId, "publisher");
    // If the server refused (not a speaker), it throws before this line.
    await session.room.localParticipant.setMicrophoneEnabled(true);
    session.role = creds.role;
  } else {
    await session.room.localParticipant.setMicrophoneEnabled(false);
    session.role = "subscriber";
  }
}

export async function leaveChannel(): Promise<void> {
  const { room, cleanups } = session;
  cleanups.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
  try {
    if (room) {
      await room.localParticipant.setMicrophoneEnabled(false);
      await room.disconnect();
    }
  } catch {
    /* idempotent */
  }
  session = {
    room: null,
    spaceId: null,
    identity: null,
    role: "subscriber",
    localAudioTrack: null,
    cleanups: [],
  };
}

export function getSession() {
  return {
    spaceId: session.spaceId,
    identity: session.identity,
    role: session.role,
    connected: !!session.room,
    hasLocalAudio: !!session.localAudioTrack,
  };
}
