"use client";

// Agora RTC client wrapper for MM Social spaces.
//
// Design notes
// ------------
// - One `IAgoraRTCClient` per active space page (module-level singleton so
//   rejoins under React StrictMode / Fast Refresh don't leak clients).
// - The Agora RTC SDK is a browser-only ESM package; it must be dynamically
//   imported inside `join()` to avoid pulling `document`/`window` into any
//   server component that transitively imports this module.
// - Tokens are minted server-side by `POST /api/agora-token` (Superfan-gated).
// - Publisher = host + speakers; subscriber = audience.
// - We proactively renew tokens on `token-privilege-will-expire`.
// - Volume indicator writes `is_speaking` back to `space_participants` for the
//   local user only, throttled to at most once every 500 ms per state change.

import { authFetch } from "@/lib/authClient";
import { supabase } from "@/lib/supabase";

// Types stay generic so this file compiles even before agora-rtc-sdk-ng loads.
type AnyClient = any;
type AnyTrack = any;

export type AgoraRole = "publisher" | "subscriber";

export interface JoinOptions {
  channel: string;
  uid?: number | string;
  role: AgoraRole;
  spaceId: string;
  onRemoteUserSpeaking?: (uid: string, level: number) => void;
  onLocalSpeakingChange?: (isSpeaking: boolean) => void;
  onError?: (err: Error) => void;
}

interface ActiveSession {
  client: AnyClient;
  localAudioTrack: AnyTrack | null;
  channel: string;
  uid: string | number;
  role: AgoraRole;
  spaceId: string;
  cleanups: Array<() => void>;
}

let session: ActiveSession | null = null;
// Throttle state for is_speaking writes so we don't hammer Supabase.
let lastSpeakingState: boolean | null = null;
let lastSpeakingWriteMs = 0;

async function fetchToken(
  channel: string,
  uid: number | string,
  role: AgoraRole,
): Promise<string> {
  const res = await authFetch("/api/agora-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      channel,
      uid: typeof uid === "string" ? 0 : uid,
      role,
      expireTime: 3600,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `agora-token ${res.status}`);
  }
  const { token } = await res.json();
  if (!token) throw new Error("agora-token: empty token");
  return token as string;
}

/**
 * Join an Agora channel for the given space.
 * Safe to call from a React `useEffect`. Calling twice with the same channel
 * is a no-op; calling with a different channel leaves+rejoins.
 */
export async function joinChannel(opts: JoinOptions): Promise<void> {
  if (typeof window === "undefined") return;

  // Already in the right channel? Just update role if needed.
  if (session && session.channel === opts.channel) {
    if (session.role !== opts.role) {
      await setRole(opts.role);
    }
    return;
  }
  // Different channel — leave the old one first.
  if (session) await leaveChannel();

  // Dynamic import so this file can be safely imported by server components.
  const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;

  const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID;
  if (!appId) throw new Error("NEXT_PUBLIC_AGORA_APP_ID is not set");

  const client: AnyClient = AgoraRTC.createClient({
    mode: "live",
    codec: "vp8",
    role: opts.role === "publisher" ? "host" : "audience",
  });

  const uid = opts.uid ?? 0;
  const token = await fetchToken(opts.channel, uid, opts.role);

  // Volume indicator gives us local + remote speaking levels.
  try {
    client.enableAudioVolumeIndicator();
  } catch {
    /* older SDK builds swallow this — non-fatal */
  }

  const cleanups: Array<() => void> = [];

  // Remote audio: auto-subscribe and play.
  const onUserPublished = async (user: any, mediaType: string) => {
    try {
      await client.subscribe(user, mediaType);
      if (mediaType === "audio") user.audioTrack?.play();
    } catch (err) {
      opts.onError?.(err as Error);
    }
  };
  const onUserUnpublished = (user: any) => {
    try {
      user.audioTrack?.stop();
    } catch {
      /* noop */
    }
  };
  client.on("user-published", onUserPublished);
  client.on("user-unpublished", onUserUnpublished);
  cleanups.push(() => {
    client.off("user-published", onUserPublished);
    client.off("user-unpublished", onUserUnpublished);
  });

  // Token renewal ~30s before expiry.
  const onWillExpire = async () => {
    try {
      const fresh = await fetchToken(opts.channel, uid, opts.role);
      await client.renewToken(fresh);
    } catch (err) {
      opts.onError?.(err as Error);
    }
  };
  client.on("token-privilege-will-expire", onWillExpire);
  cleanups.push(() => client.off("token-privilege-will-expire", onWillExpire));

  // Volume levels → speaking state for the local user.
  const onVolume = (volumes: Array<{ level: number; uid: string | number }>) => {
    for (const v of volumes) {
      const isLocal = String(v.uid) === "0" || v.uid === uid;
      if (isLocal) {
        const speaking = v.level > 5; // ~0-100 scale
        maybeWriteSpeaking(opts.spaceId, speaking, opts.onLocalSpeakingChange);
      } else if (opts.onRemoteUserSpeaking) {
        opts.onRemoteUserSpeaking(String(v.uid), v.level);
      }
    }
  };
  client.on("volume-indicator", onVolume);
  cleanups.push(() => client.off("volume-indicator", onVolume));

  await client.join(appId, opts.channel, token, uid === 0 ? null : uid);

  let localAudioTrack: AnyTrack | null = null;
  if (opts.role === "publisher") {
    localAudioTrack = await ensureMicTrack(AgoraRTC);
    if (localAudioTrack) {
      await client.publish([localAudioTrack]);
    }
  }

  session = {
    client,
    localAudioTrack,
    channel: opts.channel,
    uid,
    role: opts.role,
    spaceId: opts.spaceId,
    cleanups,
  };
}

async function ensureMicTrack(AgoraRTC: any): Promise<AnyTrack | null> {
  try {
    return await AgoraRTC.createMicrophoneAudioTrack({
      AEC: true,
      AGC: true,
      ANS: true,
    });
  } catch (err) {
    // NotAllowedError → user denied permission. Let caller handle UI.
    console.warn("mic permission denied", err);
    return null;
  }
}

async function maybeWriteSpeaking(
  spaceId: string,
  isSpeaking: boolean,
  onChange?: (isSpeaking: boolean) => void,
): Promise<void> {
  if (lastSpeakingState === isSpeaking) return;
  const now = Date.now();
  if (now - lastSpeakingWriteMs < 500) return;
  lastSpeakingState = isSpeaking;
  lastSpeakingWriteMs = now;
  onChange?.(isSpeaking);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("space_participants")
    .update({ is_speaking: isSpeaking })
    .eq("space_id", spaceId)
    .eq("user_id", user.id);
}

/** Toggle mute on the local publish track (Agora-side + our own DB flag). */
export async function setMuted(muted: boolean): Promise<void> {
  if (!session?.localAudioTrack) return;
  await session.localAudioTrack.setEnabled(!muted);
}

/** Change role between publisher (speaker) and subscriber (audience). */
export async function setRole(role: AgoraRole): Promise<void> {
  if (!session) return;
  const client = session.client;
  await client.setClientRole(role === "publisher" ? "host" : "audience");

  if (role === "publisher" && !session.localAudioTrack) {
    const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;
    const track = await ensureMicTrack(AgoraRTC);
    if (track) {
      await client.publish([track]);
      session.localAudioTrack = track;
    }
  } else if (role === "subscriber" && session.localAudioTrack) {
    await client.unpublish([session.localAudioTrack]);
    session.localAudioTrack.close();
    session.localAudioTrack = null;
  }
  session.role = role;
}

/** Leave the current channel and release the mic. Idempotent. */
export async function leaveChannel(): Promise<void> {
  if (!session) return;
  const s = session;
  session = null;
  lastSpeakingState = null;
  lastSpeakingWriteMs = 0;
  try {
    if (s.localAudioTrack) {
      try {
        await s.client.unpublish([s.localAudioTrack]);
      } catch {
        /* channel may already be gone */
      }
      s.localAudioTrack.close();
    }
    await s.client.leave();
  } catch (err) {
    console.warn("agora leave failed", err);
  } finally {
    s.cleanups.forEach((fn) => {
      try {
        fn();
      } catch {
        /* noop */
      }
    });
  }
}

export function getSession() {
  return session
    ? {
        channel: session.channel,
        uid: session.uid,
        role: session.role,
        spaceId: session.spaceId,
        hasMic: !!session.localAudioTrack,
      }
    : null;
}
