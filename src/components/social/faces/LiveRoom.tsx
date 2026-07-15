"use client";

// MM Faces — LIVE VIDEO room engine (all three modes).
//
//   • Live         (live_solo)  — one host on camera; viewers watch/comment/react.
//   • Duo Live      (live_duo)   — host + one guest on camera (2 tiles).
//   • 8-Person Live (live_group) — host + up to N guests (auto-grid, up to 8 tiles).
//
// One engine, three configs. Tiles are laid out with the TikTok/KIMI auto-grid
// math (1→1x1, 2→2 cols, ≤4→2x2, ≤6→3x2, else 3x3). Guests raise a hand to
// request camera; the host approves (promote to "speaker" = publisher). This
// reuses the SAME server model as audio MM Spaces: `space_participants.role`
// + has_raised_hand, the host-only PATCH moderation endpoint, and the
// Superfan-gated /api/livekit-token (publisher only for host/speaker).
//
// Brand: Melori orange accents on dark — matches the rest of the app.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  joinVideoRoom,
  leaveVideoRoom,
  ensureVideoAudio,
  setCameraEnabled,
  setMicEnabled,
  switchCamera,
  becomePublisher,
  type VideoTier,
  type RemoteVideo,
} from "@/lib/livekitVideoClient";
import { authFetch } from "@/lib/authClient";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { usePlayer } from "@/components/player/PlayerProvider";
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
  Hand,
  Check,
  UserPlus,
  Volume2,
  Music,
} from "lucide-react";

export type LiveMode = "live_solo" | "live_duo" | "live_group";

interface LiveRoomProps {
  spaceId: string;
  hostId: string;
  title: string;
  hostName: string;
  hostAvatar?: string | null;
  tier: VideoTier;
  durationMinutes: number | null;
  mode: LiveMode;
  maxOnCamera: number; // host + guests ceiling (1 for solo, 2 duo, up to 8 group)
  canPublish: boolean; // may this viewer go on camera? (host or Superfan+)
}

interface FloatingHeart {
  id: number;
  left: number;
}

// A tile = one on-camera participant (host or guest) plus their attached
// <video> element (or null while their camera is off / loading).
interface Tile {
  identity: string;
  name: string;
  isLocal: boolean;
  el: HTMLVideoElement | null;
}

// Auto-layout grid (KIMI/TikTok math), returned as a Tailwind grid class.
function gridClassFor(count: number): string {
  if (count <= 1) return "grid-cols-1 grid-rows-1";
  if (count === 2) return "grid-cols-1 grid-rows-2 sm:grid-cols-2 sm:grid-rows-1";
  if (count <= 4) return "grid-cols-2 grid-rows-2";
  if (count <= 6) return "grid-cols-2 grid-rows-3 sm:grid-cols-3 sm:grid-rows-2";
  return "grid-cols-2 grid-rows-4 sm:grid-cols-3 sm:grid-rows-3";
}

export default function LiveRoom({
  spaceId,
  hostId,
  title,
  hostName,
  hostAvatar,
  tier,
  durationMinutes,
  mode,
  maxOnCamera,
  canPublish,
}: LiveRoomProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { isPlaying, togglePlay } = usePlayer();
  const isHost = !!user && user.id === hostId;
  const isSolo = mode === "live_solo";

  // Prevent the background music bar from doubling up with live participant
  // audio (Bug A/D): if music is playing when we enter the room, pause it once.
  const pausedMusicRef = useRef(false);
  useEffect(() => {
    if (!pausedMusicRef.current && isPlaying) {
      pausedMusicRef.current = true;
      togglePlay();
    }
    // Run only on mount — the user may re-enable music from the collapsed bar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const heartSeq = useRef(0);
  const endTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  const [connecting, setConnecting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [viewerCount, setViewerCount] = useState(1);
  const [hearts, setHearts] = useState<FloatingHeart[]>([]);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [onCamera, setOnCamera] = useState<boolean>(isHost); // am I publishing?
  const [handRaised, setHandRaised] = useState(false);
  const [requests, setRequests] = useState<
    { user_id: string; name: string; avatar: string | null }[]
  >([]);
  const [showRequests, setShowRequests] = useState(false);

  // Keep the local <video> for re-attach when tiles re-render.
  const localElRef = useRef<HTMLVideoElement | null>(null);
  const remoteEls = useRef<Map<string, HTMLVideoElement>>(new Map());

  const upsertTile = useCallback((t: Tile) => {
    setTiles((prev) => {
      const idx = prev.findIndex((x) => x.identity === t.identity);
      if (idx === -1) return [...prev, t];
      const next = [...prev];
      next[idx] = { ...next[idx], ...t };
      return next;
    });
  }, []);

  const removeTile = useCallback((identity: string) => {
    setTiles((prev) => prev.filter((x) => x.identity !== identity));
    remoteEls.current.delete(identity);
  }, []);

  const handleLeave = useCallback(async () => {
    if (endTimerRef.current) clearTimeout(endTimerRef.current);
    await leaveVideoRoom();
    if (isHost) {
      try {
        await authFetch(`/api/social/spaces/${spaceId}/end`, { method: "POST" });
      } catch {
        /* best-effort */
      }
    } else if (user) {
      // Mark my participant row as left.
      try {
        await supabase
          .from("space_participants")
          .update({ left_at: new Date().toISOString() })
          .eq("space_id", spaceId)
          .eq("user_id", user.id)
          .is("left_at", null);
      } catch {
        /* best-effort */
      }
    }
    router.push("/social/live");
  }, [isHost, spaceId, router, user]);

  // Ensure a participant row exists for anyone who joins (audience by default;
  // host row is 'host'). Enables the raise-hand / promote flow.
  useEffect(() => {
    if (!user) return;
    void supabase
      .from("space_participants")
      .upsert(
        {
          space_id: spaceId,
          user_id: user.id,
          role: isHost ? "host" : "audience",
          left_at: null,
        },
        { onConflict: "space_id,user_id" },
      );
  }, [user, spaceId, isHost]);

  // Connect to the LiveKit room on mount.
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
            localElRef.current = el;
            if (user) {
              upsertTile({
                identity: user.id,
                name: hostName === "You" || isHost ? "You" : "You",
                isLocal: true,
                el,
              });
            }
          },
          onRemoteVideo: (rv: RemoteVideo) => {
            remoteEls.current.set(rv.identity, rv.element);
            upsertTile({
              identity: rv.identity,
              name: rv.identity === hostId ? hostName : rv.name,
              isLocal: false,
              el: rv.element,
            });
          },
          onRemoteVideoRemoved: (identity) => removeTile(identity),
          onParticipantCountChange: (n) => setViewerCount(n),
          onAudioPlaybackChanged: (canPlay) => setAudioBlocked(!canPlay),
          onReconnecting: () => setReconnecting(true),
          onReconnected: () => setReconnecting(false),
          onError: (e) => {
            if (!cancelled) setError(e.message);
          },
        });
        if (cancelled) return;
        await ensureVideoAudio();

        // If I'm the host, seed my own tile even before camera frames arrive.
        if (isHost && user) {
          upsertTile({ identity: user.id, name: "You", isLocal: true, el: localElRef.current });
        }

        // Free-tier duration cap (host auto-ends).
        if (durationMinutes && isHost) {
          endTimerRef.current = setTimeout(() => {
            void handleLeave();
          }, durationMinutes * 60 * 1000);
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

  // Host: subscribe to raise-hand requests (audience with has_raised_hand).
  useEffect(() => {
    if (!isHost) return;
    const load = async () => {
      const { data } = await supabase
        .from("space_participants")
        .select("user_id, has_raised_hand, role, user:profiles(display_name, avatar_url)")
        .eq("space_id", spaceId)
        .eq("has_raised_hand", true)
        .eq("role", "audience")
        .is("left_at", null);
      setRequests(
        (data ?? []).map((r: any) => ({
          user_id: r.user_id,
          name: r.user?.display_name ?? "Guest",
          avatar: r.user?.avatar_url ?? null,
        })),
      );
    };
    void load();
    const ch = supabase
      .channel(`faces_requests:${spaceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "space_participants", filter: `space_id=eq.${spaceId}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [isHost, spaceId]);

  // Guest: watch my own row — when host promotes me to speaker, go on camera.
  useEffect(() => {
    if (isHost || !user) return;
    const ch = supabase
      .channel(`faces_myrole:${spaceId}:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "space_participants",
          filter: `space_id=eq.${spaceId}`,
        },
        (payload: any) => {
          const row = payload.new;
          if (row?.user_id !== user.id) return;
          if (row.role === "speaker" && !onCamera) {
            void goOnCamera();
          }
          if (row.role === "audience" && onCamera) {
            // Demoted — stop publishing.
            void setCameraEnabled(false);
            void setMicEnabled(false);
            setOnCamera(false);
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, user, spaceId, onCamera]);

  // Promote to publisher (re-mint token with canPublish, enable cam+mic).
  const goOnCamera = useCallback(async () => {
    try {
      const el = await becomePublisher();
      setOnCamera(true);
      setHandRaised(false);
      if (el && user) {
        localElRef.current = el;
        upsertTile({ identity: user.id, name: "You", isLocal: true, el });
      }
    } catch (e: any) {
      setError(e?.message ?? "Could not turn on your camera");
    }
  }, [user, upsertTile]);

  // Guest raises / lowers hand to request coming on camera.
  const toggleHand = useCallback(async () => {
    if (!user) return;
    const next = !handRaised;
    setHandRaised(next);
    await supabase
      .from("space_participants")
      .update({ has_raised_hand: next })
      .eq("space_id", spaceId)
      .eq("user_id", user.id)
      .is("left_at", null);
  }, [handRaised, user, spaceId]);

  // Host approves a guest → promote to speaker (they auto-go-on-camera).
  const approveGuest = useCallback(
    async (guestId: string) => {
      // Enforce the on-camera ceiling. `tiles` already includes the host's own
      // tile plus every on-camera guest, so it IS the current on-camera count —
      // adding +1 here previously made a 2-seat Duo look full before the first
      // guest could ever be approved.
      if (tiles.length >= maxOnCamera) {
        setError(`This room seats up to ${maxOnCamera} on camera.`);
        return;
      }
      await authFetch(
        `/api/social/spaces/${spaceId}/participants/${guestId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "speaker" }),
        },
      );
    },
    [spaceId, tiles.length, maxOnCamera],
  );

  const removeGuest = useCallback(
    async (guestId: string) => {
      await authFetch(
        `/api/social/spaces/${spaceId}/participants/${guestId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "audience" }),
        },
      );
    },
    [spaceId],
  );

  // --- Reactions -------------------------------------------------------
  const reactionChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
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
    const left = 20 + Math.random() * 50;
    setHearts((h) => [...h, { id, left }]);
    setTimeout(() => setHearts((h) => h.filter((x) => x.id !== id)), 2200);
  }, []);

  const sendHeart = useCallback(() => {
    spawnHeart();
    reactionChannelRef.current?.send({ type: "broadcast", event: "heart", payload: {} });
  }, [spawnHeart]);

  // Autoplay unlock — must run from a user gesture. Retries startAudio() and
  // re-plays every attached remote <audio>, then clears the prompt.
  const enableSound = useCallback(async () => {
    try {
      await ensureVideoAudio();
      setAudioBlocked(false);
    } catch {
      /* keep the prompt up so the user can retry */
    }
  }, []);

  // Ask the global music bar (AudioPlayer) to pop up from its collapsed peek
  // strip. The player owns its own state; we just nudge it via a window event.
  const toggleMusicBar = useCallback(() => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("melori:music-bar:expand"));
    }
  }, []);

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

  // Attach each tile's <video> into its container div after render.
  useEffect(() => {
    tiles.forEach((t) => {
      const container = videoRefs.current.get(t.identity);
      const el = t.isLocal ? localElRef.current : remoteEls.current.get(t.identity);
      if (container && el && el.parentElement !== container) {
        el.className = "absolute inset-0 h-full w-full object-cover";
        container.querySelectorAll("video").forEach((v) => v.remove());
        container.appendChild(el);
      }
    });
  }, [tiles]);

  const gridClass = useMemo(() => gridClassFor(Math.max(1, tiles.length)), [tiles.length]);
  const showStageFallback = tiles.length === 0;

  return (
    <div className="fixed inset-0 z-[60] bg-black">
      {/* Video stage — single tile (solo) or auto-grid (duo/group) */}
      <div className="absolute inset-0 bg-black p-0.5">
        {showStageFallback ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-brand-surface to-black">
            {hostAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={hostAvatar} alt={hostName} className="h-24 w-24 rounded-full border-2 border-brand-primary object-cover" />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-brand-primary bg-brand-muted text-3xl font-bold text-text-primary">
                {hostName.charAt(0).toUpperCase()}
              </div>
            )}
            <p className="text-text-secondary">
              {isHost ? "Starting your camera…" : `${hostName} isn't on camera yet`}
            </p>
          </div>
        ) : (
          <div className={`grid h-full w-full gap-0.5 ${gridClass}`}>
            {tiles.map((t) => (
              <div
                key={t.identity}
                ref={(node) => {
                  videoRefs.current.set(t.identity, node);
                }}
                className="relative overflow-hidden rounded-lg bg-brand-surface"
              >
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-muted text-lg font-bold text-text-primary">
                    {t.name.charAt(0).toUpperCase()}
                  </div>
                </div>
                <span className="absolute bottom-2 left-2 z-10 rounded-md bg-black/50 px-2 py-0.5 text-xs font-medium text-white backdrop-blur">
                  {t.identity === hostId ? `${t.name} · Host` : t.name}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Scrims */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/70 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-black/80 to-transparent" />

      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 flex items-start justify-between p-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-full bg-black/40 px-3 py-1.5 backdrop-blur">
            {hostAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={hostAvatar} alt={hostName} className="h-7 w-7 rounded-full object-cover" />
            ) : (
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-muted text-xs font-bold text-text-primary">
                {hostName.charAt(0).toUpperCase()}
              </div>
            )}
            <span className="max-w-[9rem] truncate text-sm font-semibold text-white">{hostName}</span>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-primary px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-white">
            <Radio className="h-3 w-3" />
            Live
          </span>
          {!isSolo && (
            <span className="hidden rounded-full bg-black/40 px-2.5 py-1 text-xs font-medium text-white backdrop-blur sm:inline">
              {mode === "live_duo" ? "Duo" : "Room"} · {tiles.length}/{maxOnCamera}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isHost && !isSolo && (
            <button
              onClick={() => setShowRequests((s) => !s)}
              className="relative inline-flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1.5 text-sm font-semibold text-white backdrop-blur hover:bg-black/60"
            >
              <UserPlus className="h-4 w-4" />
              {requests.length > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-brand-primary text-[10px] font-bold">
                  {requests.length}
                </span>
              )}
            </button>
          )}
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
        <p className="truncate text-sm font-medium text-white/90 drop-shadow">{title}</p>
      </div>

      {/* Guest requests panel (host) */}
      {isHost && !isSolo && showRequests && (
        <div className="absolute right-4 top-16 z-20 w-64 rounded-2xl border border-brand-border bg-brand-surface/95 p-3 backdrop-blur">
          <p className="mb-2 text-sm font-semibold text-text-primary">Requests to join</p>
          {requests.length === 0 ? (
            <p className="text-xs text-text-secondary">No requests right now.</p>
          ) : (
            <ul className="space-y-2">
              {requests.map((r) => (
                <li key={r.user_id} className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-muted text-xs font-bold text-text-primary">
                    {r.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{r.name}</span>
                  <button
                    onClick={() => approveGuest(r.user_id)}
                    aria-label="Approve"
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-primary text-white hover:bg-brand-primary-dark"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Status overlays */}
      {(connecting || reconnecting) && (
        <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm text-white backdrop-blur">
          <Loader2 className="h-4 w-4 animate-spin" />
          {reconnecting ? "Reconnecting…" : "Connecting…"}
        </div>
      )}
      {error && (
        <div className="absolute left-1/2 top-1/2 z-30 w-[min(90%,24rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-brand-border bg-brand-surface p-6 text-center">
          <p className="text-sm text-text-secondary">{error}</p>
          <div className="mt-4 flex justify-center gap-3">
            <button onClick={() => setError(null)} className="rounded-full bg-brand-primary px-4 py-2 text-sm font-semibold text-white hover:bg-brand-primary-dark">
              Dismiss
            </button>
            <Link href="/social/live" className="rounded-full border border-brand-border px-4 py-2 text-sm font-semibold text-text-primary hover:border-brand-primary">
              Back to MM Faces
            </Link>
          </div>
        </div>
      )}

      {/* Tap-to-enable-sound — browsers gate autoplay until a user gesture, so
          when LiveKit reports audio is blocked we show a visible prompt that
          unlocks playback for every remote participant on tap (Bug A). */}
      {audioBlocked && !connecting && (
        <button
          onClick={enableSound}
          className="absolute left-1/2 top-28 z-40 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-brand-primary px-4 py-2 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-brand-primary-dark"
        >
          <Volume2 className="h-4 w-4" />
          Tap to enable sound
        </button>
      )}

      {/* Comment stream — bottom-anchored chat that auto-scrolls to the newest
          message. Sits above the mobile tab bar + collapsed music bar and is
          kept clear of the right-edge control rail. */}
      <div className="absolute bottom-28 left-0 z-10 h-[38%] w-full max-w-[16rem] px-4 sm:max-w-sm">
        <div className="faces-comment-shell h-full">
          <SpaceCommentSection spaceId={spaceId} live />
        </div>
      </div>

      {/* Reaction hearts — float up just left of the control rail */}
      <div className="pointer-events-none absolute bottom-28 right-16 h-56 w-16">
        {hearts.map((h) => (
          <span key={h.id} className="faces-heart absolute bottom-0 text-2xl" style={{ left: h.left }}>
            ❤️
          </span>
        ))}
      </div>

      {/* Right-edge control rail (Reels/TikTok-style). Vertical stack so the
          controls never form a wide bottom bar that overlaps the music bar or
          the mobile tab bar (Bug D). */}
      <div className="absolute bottom-28 right-2 z-20 flex flex-col items-center gap-3 sm:right-3">
        {/* Camera/mic controls show for host OR an on-camera guest */}
        {onCamera && (
          <>
            <button
              onClick={toggleMic}
              aria-label={micOn ? "Mute mic" : "Unmute mic"}
              className={`flex h-12 w-12 items-center justify-center rounded-full backdrop-blur transition-colors ${micOn ? "bg-white/15 text-white hover:bg-white/25" : "bg-brand-primary text-white"}`}
            >
              {micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
            </button>
            <button
              onClick={toggleCam}
              aria-label={camOn ? "Turn camera off" : "Turn camera on"}
              className={`flex h-12 w-12 items-center justify-center rounded-full backdrop-blur transition-colors ${camOn ? "bg-white/15 text-white hover:bg-white/25" : "bg-brand-primary text-white"}`}
            >
              {camOn ? <VideoIcon className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
            </button>
            <button
              onClick={() => void switchCamera()}
              aria-label="Flip camera"
              className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/25"
            >
              <SwitchCamera className="h-5 w-5" />
            </button>
          </>
        )}

        {/* Superfan viewer in duo/group can raise a hand to request camera */}
        {!isHost && !onCamera && !isSolo && canPublish && (
          <button
            onClick={toggleHand}
            aria-label={handRaised ? "Cancel camera request" : "Join on camera"}
            className={`flex h-12 w-12 items-center justify-center rounded-full backdrop-blur transition-colors ${handRaised ? "bg-brand-primary text-white" : "bg-white/15 text-white hover:bg-white/25"}`}
          >
            <Hand className="h-5 w-5" />
          </button>
        )}
        {/* Free viewer: gentle upgrade nudge instead of a button that 403s */}
        {!isHost && !onCamera && !isSolo && !canPublish && (
          <Link
            href="/membership"
            aria-label="Go Superfan to join on camera"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/25"
          >
            <Hand className="h-5 w-5" />
          </Link>
        )}

        {/* React */}
        <button
          onClick={sendHeart}
          aria-label="Send heart"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-transform hover:scale-110 active:scale-95"
        >
          <Heart className="h-6 w-6" />
        </button>

        {/* Bring up the (collapsed) background music bar */}
        <button
          onClick={toggleMusicBar}
          aria-label="Show music player"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/25"
        >
          <Music className="h-5 w-5" />
        </button>

        {/* Host: end the broadcast */}
        {isHost && (
          <button
            onClick={handleLeave}
            aria-label="End live"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-primary text-white transition-colors hover:bg-brand-primary-dark"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  );
}
