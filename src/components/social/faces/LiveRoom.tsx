"use client";

// MM Faces — Solo Live room (TikTok-style).
//
// One host broadcasts camera + mic; any number of viewers watch, comment, and
// react. This is the working engine; Duo Live / 8-Person Live extend the same
// component by seating additional publisher tiles (the video client already
// supports multiple remote video tiles via onRemoteVideo).
//
// Layout (mobile-first, TikTok-inspired):
//   - Full-bleed video stage (host camera fills the screen).
//   - Top-left: LIVE pill + live viewer count.
//   - Top-right: close/leave.
//   - Bottom-left: floating comment stream (reuses SpaceCommentSection data).
//   - Right rail: reaction (heart) button with floating burst animation.
//   - Host dock (bottom): mic toggle, camera toggle, flip camera, End Live.
//
// Brand: Melori orange (brand-primary) accents on the dark surface, matching
// the rest of the app and the nav redesign — NOT the purple social palette.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  joinVideoRoom,
  leaveVideoRoom,
  ensureVideoAudio,
  setCameraEnabled,
  setMicEnabled,
  switchCamera,
  type VideoTier,
  type RemoteVideo,
} from "@/lib/livekitVideoClient";
import { authFetch } from "@/lib/authClient";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/social/providers/AuthProvider";
import SpaceCommentSection from "@/components/social/spaces/SpaceCommentSection";
import {
  Mic,
  MicOff,
  Video as VideoIcon,
  VideoOff,
  SwitchCamera,
  X,
  Heart,
  Radio,
  Loader2,
  Users,
} from "lucide-react";

interface LiveRoomProps {
  spaceId: string;
  hostId: string;
  title: string;
  hostName: string;
  hostAvatar?: string | null;
  tier: VideoTier;
  durationMinutes: number | null;
}

interface FloatingHeart {
  id: number;
  left: number;
}

export default function LiveRoom({
  spaceId,
  hostId,
  title,
  hostName,
  hostAvatar,
  tier,
  durationMinutes,
}: LiveRoomProps) {
  const router = useRouter();
  const { user } = useAuth();
  const isHost = !!user && user.id === hostId;

  const stageRef = useRef<HTMLDivElement | null>(null);
  const heartSeq = useRef(0);
  const endTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [connecting, setConnecting] = useState(true);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [viewerCount, setViewerCount] = useState(1);
  const [hearts, setHearts] = useState<FloatingHeart[]>([]);
  const [hostLive, setHostLive] = useState(true);

  // Place a video element into the stage (host tile). For Solo Live there is a
  // single stage tile: the host's camera. Host sees their own; viewers see the
  // host's remote track.
  const mountStageVideo = useCallback((el: HTMLVideoElement) => {
    const stage = stageRef.current;
    if (!stage) return;
    el.className = "absolute inset-0 h-full w-full object-cover";
    // Clear any prior video then mount.
    stage
      .querySelectorAll("video[data-stage-tile]")
      .forEach((v) => v.remove());
    el.setAttribute("data-stage-tile", "1");
    stage.appendChild(el);
  }, []);

  const handleLeave = useCallback(async () => {
    if (endTimerRef.current) clearTimeout(endTimerRef.current);
    await leaveVideoRoom();
    // Host ending the live also ends the room row.
    if (isHost) {
      try {
        await authFetch(`/api/social/spaces/${spaceId}/end`, { method: "POST" });
      } catch {
        /* best-effort */
      }
    }
    router.push("/social/live");
  }, [isHost, spaceId, router]);

  // Connect on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setConnecting(true);
        await joinVideoRoom({
          spaceId,
          role: isHost ? "publisher" : "subscriber",
          tier,
          onLocalVideo: (el) => {
            if (isHost) mountStageVideo(el);
          },
          onRemoteVideo: (rv: RemoteVideo) => {
            // Viewers see the host's remote camera as the stage.
            if (!isHost && rv.identity === hostId) {
              mountStageVideo(rv.element);
              setHostLive(true);
            }
          },
          onRemoteVideoRemoved: (identity) => {
            if (!isHost && identity === hostId) setHostLive(false);
          },
          onParticipantCountChange: (n) => setViewerCount(n),
          onReconnecting: () => setReconnecting(true),
          onReconnected: () => setReconnecting(false),
          onError: (e) => {
            if (!cancelled) setError(e.message);
          },
        });
        if (cancelled) return;
        setConnected(true);
        // Unlock audio playback (viewers need this to hear the host).
        await ensureVideoAudio();

        // Free-tier duration cap: auto-end after the limit.
        if (durationMinutes && isHost) {
          endTimerRef.current = setTimeout(
            () => {
              void handleLeave();
            },
            durationMinutes * 60 * 1000,
          );
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Could not join the live room");
      } finally {
        if (!cancelled) setConnecting(false);
      }
    })();

    return () => {
      cancelled = true;
      if (endTimerRef.current) clearTimeout(endTimerRef.current);
      void leaveVideoRoom();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, isHost, hostId, tier, durationMinutes]);

  // Broadcast + receive heart reactions over a lightweight realtime channel.
  const reactionChannelRef = useRef<ReturnType<
    typeof supabase.channel
  > | null>(null);
  useEffect(() => {
    const ch = supabase.channel(`faces_reactions:${spaceId}`, {
      config: { broadcast: { self: false } },
    });
    ch.on("broadcast", { event: "heart" }, () => spawnHeart()).subscribe();
    reactionChannelRef.current = ch;
    return () => {
      void supabase.removeChannel(ch);
      reactionChannelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId]);

  const spawnHeart = useCallback(() => {
    const id = ++heartSeq.current;
    const left = 20 + Math.random() * 50; // px offset within the rail
    setHearts((h) => [...h, { id, left }]);
    setTimeout(() => {
      setHearts((h) => h.filter((x) => x.id !== id));
    }, 2200);
  }, []);

  const sendHeart = useCallback(() => {
    spawnHeart();
    reactionChannelRef.current?.send({
      type: "broadcast",
      event: "heart",
      payload: {},
    });
  }, [spawnHeart]);

  const toggleMic = useCallback(async () => {
    const next = !micOn;
    setMicOn(next);
    await setMicEnabled(next);
  }, [micOn]);

  const toggleCam = useCallback(async () => {
    const next = !camOn;
    setCamOn(next);
    await setCameraEnabled(next);
  }, [camOn]);

  return (
    <div className="fixed inset-0 z-[60] bg-black">
      {/* Video stage */}
      <div ref={stageRef} className="absolute inset-0 bg-black">
        {/* Fallback when no video is mounted yet */}
        {(!hostLive || (isHost && !camOn)) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-brand-surface to-black">
            {hostAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={hostAvatar}
                alt={hostName}
                className="h-24 w-24 rounded-full border-2 border-brand-primary object-cover"
              />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-brand-primary bg-brand-muted text-3xl font-bold text-text-primary">
                {hostName.charAt(0).toUpperCase()}
              </div>
            )}
            <p className="text-text-secondary">
              {isHost
                ? camOn
                  ? "Starting your camera…"
                  : "Your camera is off"
                : `${hostName} isn't on camera right now`}
            </p>
          </div>
        )}
      </div>

      {/* Dark gradient scrims for legibility */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/70 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-black/80 to-transparent" />

      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 flex items-start justify-between p-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-full bg-black/40 px-3 py-1.5 backdrop-blur">
            {hostAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={hostAvatar}
                alt={hostName}
                className="h-7 w-7 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-muted text-xs font-bold text-text-primary">
                {hostName.charAt(0).toUpperCase()}
              </div>
            )}
            <span className="max-w-[9rem] truncate text-sm font-semibold text-white">
              {hostName}
            </span>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-primary px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-white">
            <Radio className="h-3 w-3" />
            Live
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1.5 text-sm font-semibold text-white backdrop-blur">
            <Users className="h-4 w-4" />
            {viewerCount}
          </span>
          <button
            onClick={handleLeave}
            aria-label="Leave live"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition-colors hover:bg-black/60"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Title */}
      <div className="absolute left-4 top-16 max-w-[70%]">
        <p className="truncate text-sm font-medium text-white/90 drop-shadow">
          {title}
        </p>
      </div>

      {/* Status overlays */}
      {(connecting || reconnecting) && (
        <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm text-white backdrop-blur">
          <Loader2 className="h-4 w-4 animate-spin" />
          {reconnecting ? "Reconnecting…" : "Connecting…"}
        </div>
      )}
      {error && (
        <div className="absolute left-1/2 top-1/2 w-[min(90%,24rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-brand-border bg-brand-surface p-6 text-center">
          <p className="text-sm text-text-secondary">{error}</p>
          <div className="mt-4 flex justify-center gap-3">
            <button
              onClick={() => router.refresh()}
              className="rounded-full bg-brand-primary px-4 py-2 text-sm font-semibold text-white hover:bg-brand-primary-dark"
            >
              Try again
            </button>
            <Link
              href="/social/live"
              className="rounded-full border border-brand-border px-4 py-2 text-sm font-semibold text-text-primary hover:border-brand-primary"
            >
              Back to MM Faces
            </Link>
          </div>
        </div>
      )}

      {/* Comment stream — bottom-left, TikTok-style. Reuses the space comments
          data source (same spaces row). */}
      <div className="absolute bottom-24 left-0 z-10 max-h-[38%] w-full max-w-sm overflow-hidden px-4 md:bottom-28">
        <div className="faces-comment-shell">
          <SpaceCommentSection spaceId={spaceId} />
        </div>
      </div>

      {/* Reaction rail — floating hearts */}
      <div className="pointer-events-none absolute bottom-24 right-4 h-56 w-20 md:bottom-28">
        {hearts.map((h) => (
          <span
            key={h.id}
            className="faces-heart absolute bottom-0 text-2xl"
            style={{ left: h.left }}
          >
            ❤️
          </span>
        ))}
      </div>

      {/* Bottom controls */}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 p-4 pb-6">
        {isHost ? (
          <div className="flex items-center gap-3">
            <button
              onClick={toggleMic}
              aria-label={micOn ? "Mute mic" : "Unmute mic"}
              className={`flex h-12 w-12 items-center justify-center rounded-full backdrop-blur transition-colors ${
                micOn
                  ? "bg-white/15 text-white hover:bg-white/25"
                  : "bg-brand-primary text-white"
              }`}
            >
              {micOn ? (
                <Mic className="h-5 w-5" />
              ) : (
                <MicOff className="h-5 w-5" />
              )}
            </button>
            <button
              onClick={toggleCam}
              aria-label={camOn ? "Turn camera off" : "Turn camera on"}
              className={`flex h-12 w-12 items-center justify-center rounded-full backdrop-blur transition-colors ${
                camOn
                  ? "bg-white/15 text-white hover:bg-white/25"
                  : "bg-brand-primary text-white"
              }`}
            >
              {camOn ? (
                <VideoIcon className="h-5 w-5" />
              ) : (
                <VideoOff className="h-5 w-5" />
              )}
            </button>
            <button
              onClick={() => void switchCamera()}
              aria-label="Flip camera"
              className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/25"
            >
              <SwitchCamera className="h-5 w-5" />
            </button>
          </div>
        ) : (
          <div />
        )}

        <div className="flex items-center gap-3">
          {isHost && (
            <button
              onClick={handleLeave}
              className="rounded-full bg-brand-primary px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-brand-primary-dark"
            >
              End Live
            </button>
          )}
          <button
            onClick={sendHeart}
            aria-label="Send heart"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-transform hover:scale-110 active:scale-95"
          >
            <Heart className="h-6 w-6" />
          </button>
        </div>
      </div>
    </div>
  );
}
