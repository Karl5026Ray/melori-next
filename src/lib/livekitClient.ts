"use client";

// LiveKit RTC client wrapper for MM Social spaces.
//
// Mirrors the previous agoraClient.ts public API (joinChannel / setMuted /
// setRole / leaveChannel / getSession) so the Spaces page swaps imports with
// minimal changes.
//
// Best-in-class audio design
// --------------------------
// - Audio profile is derived from the space "type":
//     * "listening" | "dj_set" | "creation" -> MUSIC profile:
//         stereo, high bitrate (up to 256 kbps), NO noise suppression /
//         echo cancellation / auto gain, so beats and mixes are not mangled.
//     * "discussion" (and default) -> VOICE profile:
//         mono, DTX + RED enabled, noise suppression + echo cancellation +
//         auto gain on for clean speech.
// - adaptiveStream + dynacast keep large audiences efficient.
// - Reconnection is surfaced (onReconnecting/onReconnected) instead of only
//   treating drops as fatal, so brief network blips self-heal.
// - Tokens are minted server-side by POST /api/livekit-token (Superfan-gated).
// - Publisher = host + speakers; subscriber = audience.

import { authFetch } from "@/lib/authClient";
import { supabase } from "@/lib/supabase";

type AnyRoom = any;
type AnyTrack = any;

export type LiveKitRole = "publisher" | "subscriber";
export type AudioProfile = "music" | "voice";

// Map a space type to the audio profile that should drive capture + publish.
export function audioProfileForType(spaceType?: string | null): AudioProfile {
  switch ((spaceType || "").toLowerCase()) {
    case "listening":
    case "dj_set":
    case "dj set":
    case "creation":
      return "music";
    default:
      return "voice";
  }
}

export interface JoinOptions {
  spaceId: string;
  channel?: string; // accepted for call-site compatibility; ignored (room derived server-side)
  role: LiveKitRole;
  // Optional space type ("listening", "dj_set", "discussion", "creation").
  // Drives the audio capture + publish profile. Falls back to voice.
  spaceType?: string | null;
  audioProfile?: AudioProfile;
  onRemoteUserSpeaking?: (identity: string, speaking: boolean) => void;
  onLocalSpeakingChange?: (isSpeaking: boolean) => void;
  onReconnecting?: () => void;
  onReconnected?: () => void;
  onError?: (err: Error) => void;
}

interface ActiveSession {
  room: AnyRoom | null;
  spaceId: string | null;
  identity: string | null;
  role: LiveKitRole;
  profile: AudioProfile;
  localAudioTrack: AnyTrack | null;
  // HTMLAudioElements created by attaching remote audio tracks, kept so we can
  // remove them from the DOM on leave/disconnect and not leak playing audio.
  remoteAudioEls: HTMLMediaElement[];
  cleanups: Array<() => void>;
}

let session: ActiveSession = {
  room: null,
  spaceId: null,
  identity: null,
  role: "subscriber",
  profile: "voice",
  localAudioTrack: null,
  remoteAudioEls: [],
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

// Capture (getUserMedia) constraints tuned per profile.
function captureDefaultsFor(profile: AudioProfile) {
  if (profile === "music") {
    // Preserve the source: disable the DSP that mangles music.
    return {
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
      channelCount: 2,
      sampleRate: 48000,
    };
  }
  // Voice: clean speech.
  return {
    autoGainControl: true,
    echoCancellation: true,
    noiseSuppression: true,
    channelCount: 1,
    sampleRate: 48000,
  };
}

// Publish options tuned per profile.
function publishDefaultsFor(profile: AudioProfile, AudioPresets: any) {
  if (profile === "music") {
    return {
      audioPreset: AudioPresets?.musicHighQualityStereo,
      dtx: false,
      red: false,
      forceStereo: true,
    };
  }
  return {
    audioPreset: AudioPresets?.speech,
    dtx: true,
    red: true,
    forceStereo: false,
  };
}

export async function joinChannel(opts: JoinOptions): Promise<void> {
  // Re-join cleanly if already connected somewhere.
  if (session.room) {
    await leaveChannel();
  }

  const lk = await import("livekit-client");
  const { Room, RoomEvent, AudioPresets, Track } = lk as any;

  const profile =
    opts.audioProfile || audioProfileForType(opts.spaceType);
  const capture = captureDefaultsFor(profile);
  const publish = publishDefaultsFor(profile, AudioPresets);

  try {
    const creds = await fetchToken(opts.spaceId, opts.role);

    const room: AnyRoom = new Room({
      adaptiveStream: true,
      dynacast: true,
      // Tuned publish defaults so speakers sound right for the room type.
      publishDefaults: {
        audioPreset: publish.audioPreset,
        dtx: publish.dtx,
        red: publish.red,
        forceStereo: publish.forceStereo,
      },
      // Default capture constraints; music rooms keep the raw signal.
      audioCaptureDefaults: capture,
      stopLocalTrackOnUnpublish: true,
    });

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

    // Surface reconnection so brief network blips self-heal instead of
    // being treated as a fatal disconnect.
    const onReconnecting = () => opts.onReconnecting?.();
    const onReconnected = () => opts.onReconnected?.();
    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);
    session.cleanups.push(() => room.off(RoomEvent.Reconnecting, onReconnecting));
    session.cleanups.push(() => room.off(RoomEvent.Reconnected, onReconnected));

    const onDisconnected = () => {
      opts.onError?.(new Error("Disconnected from space"));
    };
    room.on(RoomEvent.Disconnected, onDisconnected);
    session.cleanups.push(() => room.off(RoomEvent.Disconnected, onDisconnected));

    // Remote audio playback. LiveKit does NOT auto-play subscribed tracks even
    // with autoSubscribe:true — the client must attach() each remote audio
    // track to an <audio> element and play it. This runs for EVERYONE
    // (publishers and audience/subscribers) so all participants hear speakers.
    const AUDIO_KIND = Track?.Kind?.Audio ?? "audio";
    const attachAudio = (track: AnyTrack, participant: { identity: string }) => {
      if (typeof document === "undefined") return; // SSR guard
      if (track?.kind !== AUDIO_KIND) return;
      const el = track.attach() as HTMLMediaElement;
      el.setAttribute("data-lk-audio", participant.identity);
      document.body.appendChild(el);
      session.remoteAudioEls.push(el);
      // Some browsers gate autoplay behind a user gesture. The join is normally
      // triggered by a click, but if play() still rejects it's a known browser
      // autoplay limitation — log and carry on rather than crash.
      try {
        const p = el.play?.();
        if (p && typeof p.catch === "function") {
          p.catch((e: unknown) => console.warn("[spaces] remote audio autoplay blocked", e));
        }
      } catch (e) {
        console.warn("[spaces] remote audio play() failed", e);
      }
    };

    const onTrackSubscribed = (track: AnyTrack, _pub: unknown, participant: { identity: string }) => {
      attachAudio(track, participant);
    };
    room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
    session.cleanups.push(() => room.off(RoomEvent.TrackSubscribed, onTrackSubscribed));

    const onTrackUnsubscribed = (track: AnyTrack) => {
      try {
        (track?.detach?.() as HTMLMediaElement[] | undefined)?.forEach((el) => {
          session.remoteAudioEls = session.remoteAudioEls.filter((e) => e !== el);
          el.remove();
        });
      } catch {
        /* ignore cleanup errors */
      }
    };
    room.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
    session.cleanups.push(() => room.off(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed));

    await room.connect(creds.url, creds.token, { autoSubscribe: true });

    // Attach any remote audio tracks that were already subscribed before our
    // handler was registered (e.g. participants already in the room on join).
    room.remoteParticipants.forEach((p: any) => {
      p.trackPublications.forEach((pub: any) => {
        if (pub.track && pub.kind === AUDIO_KIND) attachAudio(pub.track, p);
      });
    });

    session.room = room;
    session.spaceId = opts.spaceId;
    session.identity = creds.identity;
    session.role = creds.role;
    session.profile = profile;

    // Publishers start with the mic enabled; subscribers stay silent.
    if (creds.role === "publisher") {
      await room.localParticipant.setMicrophoneEnabled(true, capture, {
        audioPreset: publish.audioPreset,
        dtx: publish.dtx,
        red: publish.red,
        forceStereo: publish.forceStereo,
      });
      session.localAudioTrack = true;
    }
  } catch (err) {
    opts.onError?.(err as Error);
    throw err;
  }
}

export async function setMuted(muted: boolean): Promise<void> {
  if (!session.room) return;
  // Unmuting while we're connected as a subscriber can never publish — the
  // current token has no canPublish grant. Re-mint a publisher token first
  // (same path as setRole("publisher")), which also enables the mic. This
  // makes unmute reliable even if the initial publisher connect fell back to
  // subscriber (e.g. a token race). Errors propagate so the UI can react.
  if (!muted && session.role !== "publisher") {
    await setRole("publisher");
    return;
  }
  // Enabling the mic lazily publishes a track if the user is a publisher. Pass
  // the profile capture constraints so a (re)publish keeps the right audio
  // characteristics (raw signal for music rooms, cleaned speech otherwise).
  const capture = muted ? undefined : captureDefaultsFor(session.profile);
  await session.room.localParticipant.setMicrophoneEnabled(!muted, capture);
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
    const capture = captureDefaultsFor(session.profile);
    await session.room.localParticipant.setMicrophoneEnabled(true, capture);
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
  // Detach and remove all remote audio elements so nothing keeps playing.
  session.remoteAudioEls.forEach((el) => {
    try {
      el.pause?.();
      el.srcObject = null;
      el.remove();
    } catch {
      /* ignore */
    }
  });
  session = {
    room: null,
    spaceId: null,
    identity: null,
    role: "subscriber",
    profile: "voice",
    localAudioTrack: null,
    remoteAudioEls: [],
    cleanups: [],
  };
}

export function getSession() {
  return {
    spaceId: session.spaceId,
    identity: session.identity,
    role: session.role,
    profile: session.profile,
    connected: !!session.room,
    hasLocalAudio: !!session.localAudioTrack,
  };
}
