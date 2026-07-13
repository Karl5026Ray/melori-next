"use client";

// LiveKit RTC client wrapper for MM Faces — the LIVE VIDEO system.
//
// This is a SEPARATE module from livekitClient.ts (which powers audio MM
// Spaces) on purpose: video rooms have different capture/publish concerns
// (camera + mic tracks, remote <video> attachment, layout) and keeping them
// apart means the mature, working audio path is never disturbed.
//
// Design
// ------
// - A host (publisher) publishes CAMERA video + microphone audio.
// - Viewers (subscribers) subscribe and see/hear the host. Solo Live = one
//   host broadcasting to any number of viewers (TikTok-style).
// - Remote video tracks are surfaced via onRemoteVideo/onRemoteVideoRemoved so
//   the room UI can attach them to <video> tiles it owns (the UI controls the
//   DOM/layout; this client just hands back the track + identity).
// - Remote audio is attached to hidden <audio> elements here (same approach as
//   the audio client) so viewers HEAR the host without the UI managing audio.
// - Tokens are minted server-side by POST /api/livekit-token (Superfan-gated),
//   the SAME endpoint the audio spaces use — the server derives the room from
//   the space id and only grants publish to the host.
// - Tier gating (Free vs Artist quality) is applied to the published video
//   track's resolution/bitrate via the profile passed in JoinVideoOptions.

import { authFetch } from "@/lib/authClient";

type AnyRoom = any;
type AnyTrack = any;
type AnyParticipant = { identity: string; name?: string };

export type VideoRole = "publisher" | "subscriber";
export type VideoTier = "free" | "artist";

// Tier limits — mirrors the values from the MM Faces spec (KIMI), but applied
// through LiveKit's native video capture/publish instead of a self-hosted SFU.
//   FREE  : ~480p, 500 Kbps
//   ARTIST: ~720p, 1.5 Mbps
export const VIDEO_TIER_LIMITS: Record<
  VideoTier,
  { width: number; height: number; maxBitrate: number; maxFramerate: number }
> = {
  free: { width: 640, height: 480, maxBitrate: 500_000, maxFramerate: 24 },
  artist: { width: 1280, height: 720, maxBitrate: 1_500_000, maxFramerate: 30 },
};

export interface RemoteVideo {
  identity: string;
  name: string;
  track: AnyTrack;
  element: HTMLVideoElement;
}

export interface JoinVideoOptions {
  spaceId: string;
  role: VideoRole;
  tier?: VideoTier;
  // Called when a remote participant's camera track is subscribed. The UI
  // should place `element` (an attached <video>) into a tile.
  onRemoteVideo?: (video: RemoteVideo) => void;
  // Called when a remote camera track goes away (unsubscribe / leave).
  onRemoteVideoRemoved?: (identity: string) => void;
  // Called when the local camera track is published so the UI can show the
  // host's own preview tile.
  onLocalVideo?: (element: HTMLVideoElement) => void;
  onParticipantCountChange?: (count: number) => void;
  onReconnecting?: () => void;
  onReconnected?: () => void;
  onError?: (err: Error) => void;
}

interface ActiveVideoSession {
  room: AnyRoom | null;
  spaceId: string | null;
  identity: string | null;
  role: VideoRole;
  tier: VideoTier;
  localVideoEl: HTMLVideoElement | null;
  remoteVideoEls: Map<string, HTMLVideoElement>;
  remoteAudioEls: HTMLMediaElement[];
  cleanups: Array<() => void>;
  // Remembered so a subscriber can later upgrade to publisher (becomePublisher)
  // by reconnecting with the same callbacks but a publisher token.
  lastOpts: JoinVideoOptions | null;
}

let session: ActiveVideoSession = {
  room: null,
  spaceId: null,
  identity: null,
  role: "subscriber",
  tier: "free",
  localVideoEl: null,
  remoteVideoEls: new Map(),
  remoteAudioEls: [],
  cleanups: [],
  lastOpts: null,
};

async function fetchToken(spaceId: string, role: VideoRole) {
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
    role: VideoRole;
  }>;
}

export async function joinVideoRoom(opts: JoinVideoOptions): Promise<void> {
  if (session.room) {
    await leaveVideoRoom();
  }

  const lk = await import("livekit-client");
  const { Room, RoomEvent, Track, VideoPresets } = lk as any;

  const tier: VideoTier = opts.tier || "free";
  const limits = VIDEO_TIER_LIMITS[tier];
  session.lastOpts = opts;

  try {
    const creds = await fetchToken(opts.spaceId, opts.role);

    const room: AnyRoom = new Room({
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: {
        resolution: {
          width: limits.width,
          height: limits.height,
          frameRate: limits.maxFramerate,
        },
      },
      publishDefaults: {
        videoEncoding: {
          maxBitrate: limits.maxBitrate,
          maxFramerate: limits.maxFramerate,
        },
        // Simulcast lets viewers on weak connections get a lower layer while
        // strong connections get full quality — best-in-class default.
        simulcast: true,
      },
      stopLocalTrackOnUnpublish: true,
    });

    const VIDEO_KIND = Track?.Kind?.Video ?? "video";
    const AUDIO_KIND = Track?.Kind?.Audio ?? "audio";
    const SOURCE_CAMERA = Track?.Source?.Camera ?? "camera";

    // --- Remote track handling -------------------------------------------
    const attachRemote = (
      track: AnyTrack,
      pub: any,
      participant: AnyParticipant,
    ) => {
      if (typeof document === "undefined") return;
      if (track?.kind === VIDEO_KIND) {
        // Only attach CAMERA video (ignore screenshare here for now).
        const source = pub?.source ?? track?.source;
        if (source && source !== SOURCE_CAMERA) return;
        const el = track.attach() as HTMLVideoElement;
        el.setAttribute("data-lk-video", participant.identity);
        el.playsInline = true;
        el.autoplay = true;
        el.muted = true; // video element muted; audio flows via <audio>
        session.remoteVideoEls.set(participant.identity, el);
        opts.onRemoteVideo?.({
          identity: participant.identity,
          name: participant.name || "Guest",
          track,
          element: el,
        });
      } else if (track?.kind === AUDIO_KIND) {
        const el = track.attach() as HTMLMediaElement;
        el.setAttribute("data-lk-audio", participant.identity);
        document.body.appendChild(el);
        session.remoteAudioEls.push(el);
        try {
          const p = el.play?.();
          if (p && typeof p.catch === "function") {
            p.catch((e: unknown) =>
              console.warn("[faces] remote audio autoplay blocked", e),
            );
          }
        } catch (e) {
          console.warn("[faces] remote audio play() failed", e);
        }
      }
    };

    const onTrackSubscribed = (
      track: AnyTrack,
      pub: any,
      participant: AnyParticipant,
    ) => attachRemote(track, pub, participant);
    room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
    session.cleanups.push(() =>
      room.off(RoomEvent.TrackSubscribed, onTrackSubscribed),
    );

    const onTrackUnsubscribed = (
      track: AnyTrack,
      _pub: unknown,
      participant: AnyParticipant,
    ) => {
      try {
        if (track?.kind === VIDEO_KIND) {
          const el = session.remoteVideoEls.get(participant.identity);
          if (el) {
            track.detach?.(el);
            el.remove();
            session.remoteVideoEls.delete(participant.identity);
          }
          opts.onRemoteVideoRemoved?.(participant.identity);
        } else {
          (track?.detach?.() as HTMLMediaElement[] | undefined)?.forEach(
            (el) => {
              session.remoteAudioEls = session.remoteAudioEls.filter(
                (e) => e !== el,
              );
              el.remove();
            },
          );
        }
      } catch {
        /* ignore cleanup errors */
      }
    };
    room.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
    session.cleanups.push(() =>
      room.off(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed),
    );

    // --- Participant count -----------------------------------------------
    const emitCount = () => {
      // +1 for the local participant.
      const n = (room.remoteParticipants?.size ?? 0) + 1;
      opts.onParticipantCountChange?.(n);
    };
    const onParticipantConnected = () => emitCount();
    const onParticipantDisconnected = (p: AnyParticipant) => {
      opts.onRemoteVideoRemoved?.(p.identity);
      emitCount();
    };
    room.on(RoomEvent.ParticipantConnected, onParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
    session.cleanups.push(() => {
      room.off(RoomEvent.ParticipantConnected, onParticipantConnected);
      room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
    });

    // --- Reconnection + disconnect ---------------------------------------
    const onReconnecting = () => opts.onReconnecting?.();
    const onReconnected = () => opts.onReconnected?.();
    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);
    session.cleanups.push(() => {
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.Reconnected, onReconnected);
    });
    const onDisconnected = () =>
      opts.onError?.(new Error("Disconnected from live room"));
    room.on(RoomEvent.Disconnected, onDisconnected);
    session.cleanups.push(() =>
      room.off(RoomEvent.Disconnected, onDisconnected),
    );

    await room.connect(creds.url, creds.token, { autoSubscribe: true });

    // Attach tracks already present before our handlers registered.
    room.remoteParticipants.forEach((p: any) => {
      p.trackPublications.forEach((pub: any) => {
        if (pub.track) attachRemote(pub.track, pub, p);
      });
    });

    session.room = room;
    session.spaceId = opts.spaceId;
    session.identity = creds.identity;
    session.role = creds.role;
    session.tier = tier;

    // Publisher (host) turns on camera + mic. Viewers stay receive-only.
    if (creds.role === "publisher") {
      await room.localParticipant.setCameraEnabled(true);
      await room.localParticipant.setMicrophoneEnabled(true);
      const camPub =
        room.localParticipant.getTrackPublication?.(SOURCE_CAMERA) ??
        Array.from(room.localParticipant.trackPublications?.values?.() ?? []).find(
          (p: any) => p?.source === SOURCE_CAMERA,
        );
      const camTrack = camPub?.track ?? camPub?.videoTrack;
      if (camTrack && typeof camTrack.attach === "function") {
        const el = camTrack.attach() as HTMLVideoElement;
        el.playsInline = true;
        el.autoplay = true;
        el.muted = true; // never echo your own mic
        session.localVideoEl = el;
        opts.onLocalVideo?.(el);
      }
    }

    emitCount();
  } catch (err) {
    opts.onError?.(err as Error);
    throw err;
  }
}

// Unlock audio playback from a user gesture (browsers gate autoplay).
export async function ensureVideoAudio(): Promise<void> {
  if (!session.room) return;
  try {
    if (typeof session.room.startAudio === "function") {
      await session.room.startAudio();
    }
  } catch (err) {
    console.warn("[faces] startAudio failed", err);
  }
  session.remoteAudioEls.forEach((el) => {
    const p = el.play?.();
    if (p && typeof p.catch === "function") p.catch(() => {});
  });
}

export async function setCameraEnabled(enabled: boolean): Promise<void> {
  if (!session.room) return;
  await session.room.localParticipant.setCameraEnabled(enabled);
}

export async function setMicEnabled(enabled: boolean): Promise<void> {
  if (!session.room) return;
  await session.room.localParticipant.setMicrophoneEnabled(enabled);
}

export async function switchCamera(): Promise<void> {
  // Flip between front/back cameras on mobile by cycling facingMode.
  if (!session.room) return;
  try {
    const lp = session.room.localParticipant;
    const devices = await (
      await import("livekit-client")
    ).Room.getLocalDevices?.("videoinput");
    if (!devices || devices.length < 2) return;
    // Pick the device that isn't the current one.
    const current = lp.getTrackPublication?.("camera")?.track?.mediaStreamTrack
      ?.getSettings?.()?.deviceId;
    const next = devices.find((d: any) => d.deviceId !== current) ?? devices[0];
    if (next) await session.room.switchActiveDevice("videoinput", next.deviceId);
  } catch (err) {
    console.warn("[faces] switchCamera failed", err);
  }
}

export async function leaveVideoRoom(): Promise<void> {
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
      await room.localParticipant.setCameraEnabled(false);
      await room.localParticipant.setMicrophoneEnabled(false);
      await room.disconnect();
    }
  } catch {
    /* idempotent */
  }
  session.remoteVideoEls.forEach((el) => {
    try {
      el.srcObject = null;
      el.remove();
    } catch {
      /* ignore */
    }
  });
  session.remoteAudioEls.forEach((el) => {
    try {
      el.pause?.();
      el.srcObject = null;
      el.remove();
    } catch {
      /* ignore */
    }
  });
  const keepOpts = session.lastOpts;
  session = {
    room: null,
    spaceId: null,
    identity: null,
    role: "subscriber",
    tier: "free",
    localVideoEl: null,
    remoteVideoEls: new Map(),
    remoteAudioEls: [],
    cleanups: [],
    lastOpts: keepOpts,
  };
}

// Upgrade an already-connected subscriber (a viewer the host just approved)
// into a publisher. LiveKit bakes publish permission into the JWT, so we
// reconnect with a freshly-minted publisher token, reusing the original join
// callbacks. Returns the local <video> element once the camera is live.
export async function becomePublisher(): Promise<HTMLVideoElement | null> {
  const prev = session.lastOpts;
  if (!prev) throw new Error("Not connected to a live room");
  let localEl: HTMLVideoElement | null = null;
  await joinVideoRoom({
    ...prev,
    role: "publisher",
    onLocalVideo: (el) => {
      localEl = el;
      prev.onLocalVideo?.(el);
    },
  });
  await ensureVideoAudio();
  return localEl ?? session.localVideoEl;
}

export function getVideoSession() {
  return {
    spaceId: session.spaceId,
    identity: session.identity,
    role: session.role,
    tier: session.tier,
    connected: !!session.room,
  };
}
