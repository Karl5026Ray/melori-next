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
import {
  preferLoudspeaker,
  startRouteWatch,
  stopRouteWatch,
} from "@/lib/audioOutput";
import {
  audioProfileForType,
  captureDefaultsFor,
  publishDefaultsFor,
  type AudioProfile,
} from "@/lib/audioProfile";
import { assertCaptureSupported } from "@/lib/mediaCapture";
import { classifyDisconnectReason } from "@/lib/roomDisconnect";
import type { FacingMode } from "@/lib/videoMirror";

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
  // Drives the audio capture + publish profile. Faces defaults to
  // "performance" (music-grade capture that keeps echo cancellation, so a host
  // on loudspeaker with live co-hosts cannot feed back). Pass "music" for a
  // headphones-on performance to get full 128 kbps stereo with all DSP off, or
  // "voice" for a talk-only room.
  audioProfile?: AudioProfile;
  // Optional space type, mapped through audioProfileForType when audioProfile
  // is not given explicitly.
  spaceType?: string | null;
  // Called when a remote participant's camera track is subscribed. The UI
  // should place `element` (an attached <video>) into a tile.
  onRemoteVideo?: (video: RemoteVideo) => void;
  // Called when a remote camera track goes away (unsubscribe / leave).
  onRemoteVideoRemoved?: (identity: string) => void;
  // Called when the local camera track is published so the UI can show the
  // host's own preview tile.
  onLocalVideo?: (element: HTMLVideoElement) => void;
  // Fired whenever the LOCAL camera's facing mode is known/changes (initial
  // capture, or after switchCamera() flips front/back). "user" = front-facing
  // (selfie) camera, "environment" = rear camera, null = undetermined (e.g. a
  // desktop webcam that doesn't report facingMode). The UI uses this to decide
  // whether to mirror the local preview — it must NEVER affect the published
  // track, only the on-screen CSS.
  onFacingModeChange?: (facingMode: FacingMode) => void;
  onParticipantCountChange?: (count: number) => void;
  // Full set of identities currently CONNECTED to the LiveKit room (local
  // INCLUDED). Emitted on connect and on every join/leave so the UI roster
  // reflects real presence in real time instead of waiting on a DB poll. Used
  // to filter the participant roster to who is actually in the room right now.
  onRosterIdentitiesChange?: (ids: string[]) => void;
  // Full set of currently-active speaker identities (local INCLUDED — LiveKit's
  // ActiveSpeakersChanged omits the local participant, so we merge it in here).
  // Drives the speaker ring for every tile, host + viewers alike.
  onActiveSpeakersChange?: (identities: string[]) => void;
  // Fired when the LOCAL participant's publish permission changes at runtime
  // (host/mod approved a stage request via the server SDK). canPublish=true
  // means the viewer may now turn on camera/mic WITHOUT reconnecting.
  onLocalPermissionsChanged?: (canPublish: boolean) => void;
  onReconnecting?: () => void;
  onReconnected?: () => void;
  // Fired when the server FORCIBLY removed the local participant (host ban /
  // kick — LiveKit Disconnected with reason PARTICIPANT_REMOVED). Distinct from
  // a transient network disconnect: the client will NOT auto-reconnect, so the
  // UI should show a clear "you were removed" message rather than a retry.
  onRemoved?: () => void;
  // Fired when the ROOM ITSELF was deliberately ended server-side
  // (endLiveKitRoom -> LiveKit deleteRoom, DisconnectReason.ROOM_DELETED),
  // as opposed to a kick (onRemoved) or a network failure (onError). Local
  // camera/mic are already stopped by the time this fires. Lets the UI show a
  // calm "This room has ended" state instead of the generic error overlay.
  onRoomEnded?: () => void;
  // Called whenever the browser's autoplay policy changes whether remote audio
  // can play. `canPlay === false` means the UI must show a tap-to-unmute
  // affordance and call ensureVideoAudio() from that user gesture.
  onAudioPlaybackChanged?: (canPlay: boolean) => void;
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
  // Active audio profile, so mic re-publish reuses the same tuning.
  audioProfile: AudioProfile;
  // Facing mode of the currently-active LOCAL camera. Drives self-preview
  // mirroring in the UI only — never touches the published track.
  facingMode: FacingMode;
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
  audioProfile: "performance",
  facingMode: null,
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

export type MediaPermissionState = "granted" | "denied" | "prompt" | "unknown";

// Read the browser's PERSISTED camera + mic permission via the Permissions API.
// The persisted grant is what makes a second join instant: once the user has
// clicked "Allow" for the origin, the state is "granted" and getUserMedia will
// NOT prompt again. We use this to (a) skip firing getUserMedia when access is
// "denied" (it would only reject) and show a settings hint instead, and (b)
// reason about the grant without prompting. Camera/microphone are not queryable
// in every browser (older Firefox/Safari), so "unknown" falls back to the
// normal getUserMedia path.
export async function getMediaPermission(): Promise<MediaPermissionState> {
  try {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) {
      return "unknown";
    }
    const [cam, mic] = await Promise.all([
      navigator.permissions.query({ name: "camera" as PermissionName }),
      navigator.permissions.query({ name: "microphone" as PermissionName }),
    ]);
    const states = [cam.state, mic.state];
    if (states.includes("denied")) return "denied";
    if (states.every((s) => s === "granted")) return "granted";
    return "prompt";
  } catch {
    return "unknown";
  }
}

// Turn on the local camera + mic in a SINGLE getUserMedia request and attach the
// resulting camera track. LiveKit's enableCameraAndMicrophone() exists
// specifically to surface ONE permission dialog (and to reuse a persisted grant
// silently); requesting camera and mic as two separate calls made the browser
// evaluate access twice — the repeat-prompt bug this replaces. Capture quality
// still comes from the room's per-tier videoCaptureDefaults/publishDefaults.
async function enableLocalCameraAndMic(
  room: AnyRoom,
  onLocalVideo?: (el: HTMLVideoElement) => void,
  onFacingModeChange?: (facingMode: FacingMode) => void,
): Promise<HTMLVideoElement | null> {
  // The capture API itself can be missing (iOS WKWebView without the camera/mic
  // usage descriptions, or a non-secure origin). LiveKit would surface that as a
  // bare "undefined is not an object" TypeError, so check first and explain.
  assertCaptureSupported();

  // If the user has explicitly BLOCKED access, don't fire getUserMedia (it just
  // rejects); surface an actionable message the UI can show instead.
  if ((await getMediaPermission()) === "denied") {
    throw new Error(
      "Camera and microphone are blocked. Enable them for this site in your browser settings, then try again.",
    );
  }

  const lp = room.localParticipant;
  try {
    await lp.enableCameraAndMicrophone();
  } catch (err: any) {
    // A genuine access failure (user denied at the prompt, no/unreadable device)
    // must NOT trigger a second getUserMedia — that would double-prompt. Only
    // fall back to the individual calls when the combined helper itself is
    // unavailable in this SDK build.
    const name = err?.name;
    if (
      name === "NotAllowedError" ||
      name === "NotFoundError" ||
      name === "NotReadableError" ||
      name === "SecurityError"
    ) {
      throw err;
    }
    await lp.setCameraEnabled(true);
    await lp.setMicrophoneEnabled(true);
  }

  const lk = await import("livekit-client");
  const { Track } = lk as any;
  const SOURCE_CAMERA = Track?.Source?.Camera ?? "camera";
  const camPub =
    lp.getTrackPublication?.(SOURCE_CAMERA) ??
    Array.from(lp.trackPublications?.values?.() ?? []).find(
      (p: any) => p?.source === SOURCE_CAMERA,
    );
  const camTrack = camPub?.track ?? camPub?.videoTrack;
  if (camTrack && typeof camTrack.attach === "function") {
    const el = camTrack.attach() as HTMLVideoElement;
    el.playsInline = true;
    el.autoplay = true;
    el.muted = true; // never echo your own mic
    session.localVideoEl = el;
    setFacingMode(readFacingMode(camTrack), onFacingModeChange);
    onLocalVideo?.(el);
    return el;
  }
  return session.localVideoEl;
}

// Read the active facing mode off a local camera track's MediaStreamTrack
// settings. Most laptop webcams and some browsers never report facingMode at
// all, so this legitimately returns null — callers must treat that as "do not
// mirror" rather than guessing.
function readFacingMode(track: AnyTrack): FacingMode {
  try {
    const settings = track?.mediaStreamTrack?.getSettings?.();
    const facingMode = settings?.facingMode;
    if (facingMode === "user" || facingMode === "environment") return facingMode;
    return null;
  } catch {
    return null;
  }
}

function setFacingMode(
  facingMode: FacingMode,
  onFacingModeChange?: (facingMode: FacingMode) => void,
) {
  session.facingMode = facingMode;
  onFacingModeChange?.(facingMode);
}

export async function joinVideoRoom(opts: JoinVideoOptions): Promise<void> {
  if (session.room) {
    await leaveVideoRoom();
  }

  const lk = await import("livekit-client");
  const { Room, RoomEvent, Track, VideoPresets, DisconnectReason, AudioPresets } =
    lk as any;

  const tier: VideoTier = opts.tier || "free";
  const limits = VIDEO_TIER_LIMITS[tier];
  session.lastOpts = opts;

  try {
    const creds = await fetchToken(opts.spaceId, opts.role);

    // Audio profile. Without this, Faces fell back to LiveKit's library
    // defaults — 48 kbps MONO with DTX on, plus the browser's full DSP chain
    // (noise suppression + auto gain) shredding any music the host performs.
    // "performance" is the right default for a video room: music-grade capture
    // at 96 kbps stereo with DTX off, echo cancellation retained for safety.
    const audioProfile: AudioProfile =
      opts.audioProfile ??
      (opts.spaceType ? audioProfileForType(opts.spaceType) : "performance");
    const audioCapture = captureDefaultsFor(audioProfile);
    const audioPublish = publishDefaultsFor(audioProfile, AudioPresets);
    session.audioProfile = audioProfile;

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
      // Keep the raw musical signal instead of the browser's call-tuned DSP.
      audioCaptureDefaults: audioCapture,
      publishDefaults: {
        videoEncoding: {
          maxBitrate: limits.maxBitrate,
          maxFramerate: limits.maxFramerate,
        },
        // Simulcast lets viewers on weak connections get a lower layer while
        // strong connections get full quality — best-in-class default.
        simulcast: true,
        audioPreset: audioPublish.audioPreset,
        dtx: audioPublish.dtx,
        red: audioPublish.red,
        forceStereo: audioPublish.forceStereo,
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
        el.autoplay = true;
        (el as HTMLAudioElement).muted = false;
        document.body.appendChild(el);
        session.remoteAudioEls.push(el);
        try {
          const p = el.play?.();
          if (p && typeof p.catch === "function") {
            p.catch((e: unknown) => {
              console.warn("[faces] remote audio autoplay blocked", e);
              // Surface the blocked state so the UI can prompt for a gesture.
              opts.onAudioPlaybackChanged?.(!!session.room?.canPlaybackAudio);
            });
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

    // --- Participant count + live roster ---------------------------------
    const emitCount = () => {
      // +1 for the local participant.
      const n = (room.remoteParticipants?.size ?? 0) + 1;
      opts.onParticipantCountChange?.(n);
    };
    // Identities actually connected to LiveKit right now (local included). This
    // is the real-time source of truth for presence — the UI intersects the DB
    // roster with this set so a guest who dropped disappears immediately instead
    // of lingering until their DB row is reaped.
    const emitRoster = () => {
      const ids: string[] = [];
      const local = room.localParticipant?.identity;
      if (local) ids.push(local);
      room.remoteParticipants?.forEach((p: AnyParticipant) => ids.push(p.identity));
      opts.onRosterIdentitiesChange?.(ids);
    };
    const onParticipantConnected = () => {
      emitCount();
      emitRoster();
    };
    const onParticipantDisconnected = (p: AnyParticipant) => {
      opts.onRemoteVideoRemoved?.(p.identity);
      emitCount();
      emitRoster();
    };
    room.on(RoomEvent.ParticipantConnected, onParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
    session.cleanups.push(() => {
      room.off(RoomEvent.ParticipantConnected, onParticipantConnected);
      room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
    });

    // --- Active speakers (rings) -----------------------------------------
    // Merge the local participant in: LiveKit's ActiveSpeakersChanged payload
    // does not include the local speaker, so the host would never get a ring
    // without this. We union the event's identities with the local one when the
    // local participant is speaking with an unmuted, published mic.
    const emitSpeakers = (speakers: Array<{ identity: string }>) => {
      const ids = new Set(speakers.map((s) => s.identity));
      const lp = room.localParticipant;
      const micPub =
        lp?.getTrackPublication?.(Track?.Source?.Microphone ?? "microphone");
      const localAudible = !!lp?.isSpeaking && !!micPub && !micPub.isMuted;
      if (localAudible && lp?.identity) ids.add(lp.identity);
      else if (lp?.identity) ids.delete(lp.identity);
      opts.onActiveSpeakersChange?.(Array.from(ids));
    };
    const onActiveSpeakers = (speakers: Array<{ identity: string }>) =>
      emitSpeakers(speakers);
    room.on(RoomEvent.ActiveSpeakersChanged, onActiveSpeakers);
    session.cleanups.push(() =>
      room.off(RoomEvent.ActiveSpeakersChanged, onActiveSpeakers),
    );
    // Local speaking transitions aren't part of ActiveSpeakersChanged, so also
    // recompute when the local mic is (un)published or (un)muted.
    const refreshSpeakers = () => emitSpeakers(room.activeSpeakers ?? []);
    room.on(RoomEvent.LocalTrackPublished, refreshSpeakers);
    room.on(RoomEvent.LocalTrackUnpublished, refreshSpeakers);
    room.on(RoomEvent.TrackMuted, refreshSpeakers);
    room.on(RoomEvent.TrackUnmuted, refreshSpeakers);
    session.cleanups.push(() => {
      room.off(RoomEvent.LocalTrackPublished, refreshSpeakers);
      room.off(RoomEvent.LocalTrackUnpublished, refreshSpeakers);
      room.off(RoomEvent.TrackMuted, refreshSpeakers);
      room.off(RoomEvent.TrackUnmuted, refreshSpeakers);
    });

    // --- Runtime permission change (server-driven promotion) --------------
    // When a host/mod approves a stage request, the server flips canPublish via
    // RoomServiceClient.updateParticipant and LiveKit pushes this event — no
    // token refresh / reconnect needed. Surface it so the UI can enable media.
    const onPermChanged = (
      _prev: unknown,
      participant: { isLocal?: boolean; permissions?: { canPublish?: boolean } },
    ) => {
      if (participant?.isLocal) {
        opts.onLocalPermissionsChanged?.(!!participant.permissions?.canPublish);
      }
    };
    room.on(RoomEvent.ParticipantPermissionsChanged, onPermChanged);
    session.cleanups.push(() =>
      room.off(RoomEvent.ParticipantPermissionsChanged, onPermChanged),
    );

    // --- Reconnection + disconnect ---------------------------------------
    const onReconnecting = () => opts.onReconnecting?.();
    const onReconnected = () => opts.onReconnected?.();
    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);
    session.cleanups.push(() => {
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.Reconnected, onReconnected);
    });
    // A host ban/kick disconnects us with PARTICIPANT_REMOVED and LiveKit will
    // NOT auto-reconnect. Surface that as a distinct "removed" signal so the UI
    // can show a clear message instead of a generic error / silent retry.
    const onDisconnected = (reason?: unknown) => {
      if (
        DisconnectReason &&
        reason === DisconnectReason.PARTICIPANT_REMOVED
      ) {
        opts.onRemoved?.();
        return;
      }
      const classification = classifyDisconnectReason(
        reason as string | number | undefined,
      );
      if (classification === "room-ended") {
        // Deliberate server-side teardown (the host ended the room, or the
        // lazy abandonment reaper closed it): stop local camera/mic
        // immediately rather than leaving hardware indicators on, then hand
        // off to the calm "room ended" path instead of onError.
        void room.localParticipant?.setCameraEnabled?.(false).catch(() => undefined);
        void room.localParticipant?.setMicrophoneEnabled?.(false).catch(() => undefined);
        opts.onRoomEnded?.();
        return;
      }
      opts.onError?.(new Error("Disconnected from live room"));
    };
    room.on(RoomEvent.Disconnected, onDisconnected);
    session.cleanups.push(() =>
      room.off(RoomEvent.Disconnected, onDisconnected),
    );

    // --- Audio autoplay gate ---------------------------------------------
    // Browsers block audio until a user gesture. LiveKit fires this whenever
    // the ability to play changes; we relay it so the UI can show/hide a
    // "tap to enable sound" prompt.
    const onAudioPlaybackChanged = () =>
      opts.onAudioPlaybackChanged?.(!!room.canPlaybackAudio);
    if (RoomEvent.AudioPlaybackStatusChanged) {
      room.on(RoomEvent.AudioPlaybackStatusChanged, onAudioPlaybackChanged);
      session.cleanups.push(() =>
        room.off(RoomEvent.AudioPlaybackStatusChanged, onAudioPlaybackChanged),
      );
    }

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

    // Report the initial autoplay state so the UI can prompt immediately if the
    // browser is holding audio back until a gesture.
    opts.onAudioPlaybackChanged?.(!!room.canPlaybackAudio);

    // Publisher (host) turns on camera + mic. Viewers stay receive-only. Uses a
    // single combined request so a persisted grant is reused with no re-prompt.
    if (creds.role === "publisher") {
      await enableLocalCameraAndMic(room, opts.onLocalVideo, opts.onFacingModeChange);
    }

    emitCount();
    emitRoster();
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

  // On iOS, mic capture drags output to the earpiece. Push it back to the
  // loudspeaker now that we are inside a user gesture (Safari 26+ only; no-ops
  // everywhere else and never overrides a connected headset).
  try {
    await preferLoudspeaker(session.remoteAudioEls);
    startRouteWatch(() => session.remoteAudioEls);
  } catch (err) {
    console.warn("[faces] loudspeaker routing skipped", err);
  }
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
    // Re-read the facing mode off the (now switched) camera track so the UI
    // can flip self-preview mirroring to match — front mirrors, back doesn't.
    const camTrack = lp.getTrackPublication?.("camera")?.track;
    setFacingMode(readFacingMode(camTrack), session.lastOpts?.onFacingModeChange);
  } catch (err) {
    console.warn("[faces] switchCamera failed", err);
  }
}

export async function leaveVideoRoom(): Promise<void> {
  // Drop any pinned audio sink and stop watching route changes; a pin must
  // never outlive the session it was applied for.
  stopRouteWatch();
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
    audioProfile: "performance",
    facingMode: null,
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

// Graceful degradation: rejoin the room as a plain SUBSCRIBER (viewer). Used
// when the on-stage publish path fails all the way through (in-place publish
// failed AND becomePublisher's publisher rejoin failed) — becomePublisher goes
// through joinVideoRoom, which calls leaveVideoRoom() first, so a failed
// publisher rejoin leaves the guest fully disconnected. Rather than leave them
// on a black screen, we reconnect with a subscriber token (the same path a
// normal viewer uses) so they stay in the room and can watch. Reuses the
// original join callbacks so remote tiles/audio wire back up.
export async function becomeSubscriber(): Promise<void> {
  const prev = session.lastOpts;
  if (!prev) throw new Error("Not connected to a live room");
  await joinVideoRoom({ ...prev, role: "subscriber" });
  await ensureVideoAudio();
}

// Publish camera + mic on an ALREADY-CONNECTED participant whose permission was
// just flipped to canPublish (server-driven promotion). No reconnect — this is
// the preferred path over becomePublisher() once the client is in the room and
// has received ParticipantPermissionsChanged. Returns the local <video> once
// the camera track is live so the UI can show a self-tile.
export async function publishLocalMedia(): Promise<HTMLVideoElement | null> {
  if (!session.room) return null;
  const el = await enableLocalCameraAndMic(
    session.room,
    session.lastOpts?.onLocalVideo,
    session.lastOpts?.onFacingModeChange,
  );
  session.role = "publisher";
  return el;
}

export function getVideoSession() {
  return {
    spaceId: session.spaceId,
    identity: session.identity,
    role: session.role,
    tier: session.tier,
    facingMode: session.facingMode,
    connected: !!session.room,
  };
}
