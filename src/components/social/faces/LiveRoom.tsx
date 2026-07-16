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
  publishLocalMedia,
  type VideoTier,
  type RemoteVideo,
} from "@/lib/livekitVideoClient";
import { authFetch } from "@/lib/authClient";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/social/providers/AuthProvider";
import RoomChat from "@/components/social/rooms/RoomChat";
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
  Square,
  LayoutGrid,
  Focus,
} from "lucide-react";

export type LiveMode = "live_solo" | "live_duo" | "live_group";

// How the on-camera tiles are arranged. `grid` = the auto-grid (everyone equal);
// `spotlight` = one featured tile (active speaker, else host) fills the stage
// with the rest as a thumbnail strip. Purely a local view preference — it never
// changes who is publishing, so it's safe for any viewer to toggle.
export type FacesLayout = "grid" | "spotlight";

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
  const isHost = !!user && user.id === hostId;
  const isSolo = mode === "live_solo";

  // Background music is paused on entry by AudioPlayer's room-route effect (it
  // hides the floating player and pauses playback so it never fights the live
  // audio), so there's nothing to do here.

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
  // Full audience roster (viewers not on camera) so the host can browse a guest
  // list and invite anyone up — not just people who raised a hand.
  const [audience, setAudience] = useState<
    { user_id: string; name: string; avatar: string | null }[]
  >([]);
  const [showRequests, setShowRequests] = useState(false);
  // Guests with an in-flight promote (invite/approve) call, for pending UI.
  const [pending, setPending] = useState<Set<string>>(new Set());
  // Tile arrangement (local view only). Starts as the equal auto-grid.
  const [layout, setLayout] = useState<FacesLayout>("grid");
  // Identities currently speaking (local + remote merged by the video client),
  // drives the green ring on tiles.
  const [speakers, setSpeakers] = useState<Set<string>>(new Set());

  // Keep the local <video> for re-attach when tiles re-render.
  const localElRef = useRef<HTMLVideoElement | null>(null);
  const remoteEls = useRef<Map<string, HTMLVideoElement>>(new Map());
  // Mirror of `onCamera` so the join effect's permission callback (registered
  // once) reads the current value without needing to re-subscribe.
  const onCameraRef = useRef(isHost);
  useEffect(() => {
    onCameraRef.current = onCamera;
  }, [onCamera]);
  // Guards against going on camera twice when BOTH the Supabase role-watch and
  // the LiveKit ParticipantPermissionsChanged event fire for the same approval.
  const promotingRef = useRef(false);

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
          onActiveSpeakersChange: (ids) => setSpeakers(new Set(ids)),
          onLocalPermissionsChanged: (allowed) => {
            // Server promoted me (host/mod approved my raised hand). Publish in
            // place — no reconnect — per the runtime-permission flow.
            if (allowed && !onCameraRef.current) void goOnCameraInPlace();
          },
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
      // One query for every audience member; split locally into raised-hand
      // "requests" and the rest of the guest list. Mirrors how MM Spaces derives
      // its `raisedHands` + `audience` lists from the same participant rows.
      const { data } = await supabase
        .from("space_participants")
        .select("user_id, has_raised_hand, role, user:profiles(display_name, avatar_url)")
        .eq("space_id", spaceId)
        .eq("role", "audience")
        .is("left_at", null);
      const rows = (data ?? []).map((r: any) => ({
        user_id: r.user_id,
        name: r.user?.display_name ?? "Guest",
        avatar: r.user?.avatar_url ?? null,
        raised: !!r.has_raised_hand,
      }));
      setRequests(rows.filter((r) => r.raised).map(({ raised: _r, ...rest }) => rest));
      setAudience(rows.map(({ raised: _r, ...rest }) => rest));
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
            void goOnCameraInPlace();
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

  // Go on camera WITHOUT reconnecting — used when the server flips our publish
  // permission at runtime (ParticipantPermissionsChanged). Falls back to the
  // reconnect path (becomePublisher) if in-place publish yields no track.
  const goOnCameraInPlace = useCallback(async () => {
    if (promotingRef.current || onCameraRef.current) return;
    promotingRef.current = true;
    try {
      let el = await publishLocalMedia();
      if (!el) el = await becomePublisher();
      setOnCamera(true);
      setHandRaised(false);
      if (el && user) {
        localElRef.current = el;
        upsertTile({ identity: user.id, name: "You", isLocal: true, el });
      }
    } catch (e: any) {
      setError(e?.message ?? "Could not turn on your camera");
    } finally {
      promotingRef.current = false;
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

  // Room is full when the current on-camera count (host + on-camera guests, i.e.
  // `tiles`) has reached the mode's ceiling (2 for Duo, up to 8 for group).
  const stageFull = tiles.length >= maxOnCamera;

  // Host promotes a guest → speaker. Used by BOTH the "approve raised hand" and
  // the "invite from guest list" actions; they hit the SAME server-authoritative
  // moderation endpoint (PATCH role:speaker), which flips LiveKit publish
  // permission and updates the role — the client never self-promotes. The
  // promoted guest's own row-watch (below) then brings them on camera in place.
  const promoteToStage = useCallback(
    async (guestId: string) => {
      // Enforce the on-camera ceiling. `tiles` already includes the host's own
      // tile plus every on-camera guest, so it IS the current on-camera count —
      // adding +1 here previously made a 2-seat Duo look full before the first
      // guest could ever be approved.
      if (tiles.length >= maxOnCamera) {
        setError(`This room seats up to ${maxOnCamera} on camera.`);
        return;
      }
      setPending((p) => new Set(p).add(guestId));
      try {
        const res = await authFetch(
          `/api/social/spaces/${spaceId}/participants/${guestId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: "speaker" }),
          },
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data?.error ?? "Could not invite that guest.");
        }
      } catch {
        setError("Network error inviting that guest.");
      } finally {
        setPending((p) => {
          const next = new Set(p);
          next.delete(guestId);
          return next;
        });
      }
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

  // The featured tile in spotlight layout: the current active speaker if any,
  // otherwise the host, otherwise the first tile. Keeps the "big" tile tracking
  // whoever is talking, exactly like the ring does.
  const featuredId = useMemo(() => {
    if (tiles.length === 0) return null;
    const speaking = tiles.find((t) => speakers.has(t.identity));
    if (speaking) return speaking.identity;
    const host = tiles.find((t) => t.identity === hostId);
    return (host ?? tiles[0]).identity;
  }, [tiles, speakers, hostId]);

  // Attach each tile's <video> into its container div after render. Re-runs when
  // the layout or the featured tile changes too, since those swap which DOM node
  // holds a given identity — without the re-attach the moved tile goes black.
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
  }, [tiles, layout, featuredId]);

  const gridClass = useMemo(() => gridClassFor(Math.max(1, tiles.length)), [tiles.length]);
  const showStageFallback = tiles.length === 0;
  // The layout toggle only makes sense once there's more than one tile to
  // arrange (solo/single-tile rooms have nothing to switch).
  const canSwitchLayout = !isSolo && tiles.length >= 2;
  const useSpotlight = layout === "spotlight" && canSwitchLayout;

  // One tile renderer shared by both layouts so the active-speaker ring, name
  // label and <video> attach point stay identical regardless of arrangement.
  const renderTile = (t: Tile) => (
    <div
      key={t.identity}
      ref={(node) => {
        videoRefs.current.set(t.identity, node);
      }}
      className={`relative h-full w-full overflow-hidden rounded-lg bg-brand-surface ${
        speakers.has(t.identity) ? "speaking-ring-tile" : ""
      }`}
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
  );

  const featuredTile = tiles.find((t) => t.identity === featuredId) ?? tiles[0];
  const stripTiles = tiles.filter((t) => t.identity !== featuredTile?.identity);

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
        ) : useSpotlight && featuredTile ? (
          // Spotlight: featured tile fills the stage, the rest ride a thumbnail
          // strip along the bottom.
          <div className="flex h-full w-full flex-col gap-0.5">
            <div className="relative min-h-0 flex-1">{renderTile(featuredTile)}</div>
            {stripTiles.length > 0 && (
              <div className="flex h-20 w-full shrink-0 gap-0.5 overflow-x-auto sm:h-28">
                {stripTiles.map((t) => (
                  <div key={t.identity} className="relative aspect-square h-full shrink-0">
                    {renderTile(t)}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className={`grid h-full w-full gap-0.5 ${gridClass}`}>
            {tiles.map((t) => renderTile(t))}
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

      {/* Guests panel (host) — raised-hand REQUESTS to approve on top, then the
          full AUDIENCE roster to invite from. Mirrors the MM Spaces "Raised
          Hands" + "Audience" sections; every action hits the same server-side
          moderation endpoint. */}
      {isHost && !isSolo && showRequests && (
        <div className="absolute right-4 top-16 z-20 flex max-h-[70vh] w-72 flex-col overflow-hidden rounded-2xl border border-brand-border bg-brand-surface/95 p-3 backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-text-primary">Guests</p>
            <span className="text-xs text-text-secondary">{tiles.length}/{maxOnCamera} on camera</span>
          </div>
          {stageFull && (
            <p className="mb-2 rounded-lg bg-brand-primary/10 px-2 py-1.5 text-[11px] text-brand-primary">
              Stage is full ({maxOnCamera}). Move someone to the audience to invite another guest.
            </p>
          )}
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
            {/* Requests to join (raised hands). */}
            {requests.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                  Requests ({requests.length})
                </p>
                <ul className="space-y-2">
                  {requests.map((r) => (
                    <li key={r.user_id} className="flex items-center gap-2">
                      <div className="relative">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-muted text-xs font-bold text-text-primary">
                          {r.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-brand-primary">
                          <Hand className="h-2.5 w-2.5 text-white" />
                        </span>
                      </div>
                      <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{r.name}</span>
                      <button
                        onClick={() => promoteToStage(r.user_id)}
                        disabled={stageFull || pending.has(r.user_id)}
                        aria-label={`Approve ${r.name}`}
                        className="flex items-center gap-1 rounded-full bg-brand-primary px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-primary-dark disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {pending.has(r.user_id) ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                        Approve
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Full audience roster — invite anyone up. */}
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                Audience ({audience.length})
              </p>
              {audience.length === 0 ? (
                <p className="text-xs text-text-secondary">No one in the audience yet.</p>
              ) : (
                <ul className="space-y-2">
                  {audience.map((a) => (
                    <li key={a.user_id} className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-muted text-xs font-bold text-text-primary">
                        {a.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{a.name}</span>
                      <button
                        onClick={() => promoteToStage(a.user_id)}
                        disabled={stageFull || pending.has(a.user_id)}
                        aria-label={`Invite ${a.name} on camera`}
                        className="flex items-center gap-1 rounded-full border border-brand-border px-2.5 py-1 text-xs font-semibold text-text-primary hover:border-brand-primary hover:text-brand-primary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {pending.has(a.user_id) ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <UserPlus className="h-3.5 w-3.5" />
                        )}
                        Invite
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
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

      {/* Comment stream — shared RoomChat (auto-scroll, new-message pill,
          grouping, sticky composer). Fixed-height floating shell over the video
          so the internal scroll + composer behave. Orange accent for Faces. */}
      <div className="absolute bottom-24 left-0 z-10 flex h-[42%] w-full max-w-sm flex-col overflow-hidden pl-4 pr-24 md:bottom-28 md:pr-4">
        <div className="faces-comment-shell flex min-h-0 flex-1 flex-col">
          <RoomChat spaceId={spaceId} accent="orange" className="flex-1" />
        </div>
      </div>

      {/* Reaction hearts — rise just LEFT of the right-side control rail. */}
      <div className="pointer-events-none absolute bottom-40 right-20 h-56 w-20 md:bottom-28">
        {hearts.map((h) => (
          <span key={h.id} className="faces-heart absolute bottom-0 text-2xl" style={{ left: h.left }}>
            ❤️
          </span>
        ))}
      </div>

      {/* Broadcast controls — VERTICAL RIGHT-SIDE RAIL.
          The old bottom row sat UNDER the mobile tab bar (fixed, z-[70]) and
          behind its center "M" launcher, so camera/mic/flip/End Live/heart were
          covered and untappable on a live phone. They now live in a rail on the
          RIGHT edge (opposite the left hamburger), anchored ABOVE the tab bar +
          M button and clear of the bottom-left chat, honoring iOS safe areas.
          Applies to all three modes (solo/duo/group). */}
      <div
        className="absolute z-30 flex flex-col items-center gap-3"
        style={{
          right: "calc(env(safe-area-inset-right) + 0.75rem)",
          bottom: "calc(env(safe-area-inset-bottom) + 4.75rem)",
        }}
      >
        {/* Layout toggle — grid ⇄ spotlight. Only for multi-visitor rooms with
            2+ tiles to arrange; it's a local view preference (never broadcast,
            never touches who publishes). */}
        {canSwitchLayout && (
          <button
            onClick={() => setLayout((l) => (l === "grid" ? "spotlight" : "grid"))}
            aria-label={layout === "grid" ? "Switch to spotlight view" : "Switch to grid view"}
            title={layout === "grid" ? "Spotlight view" : "Grid view"}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/25"
          >
            {layout === "grid" ? <Focus className="h-5 w-5" /> : <LayoutGrid className="h-5 w-5" />}
          </button>
        )}
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
        {/* End Live (host) — primary, prominent, and always reachable. */}
        {isHost && (
          <button
            onClick={handleLeave}
            aria-label="End Live"
            className="flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-full bg-brand-primary text-white shadow-lg transition-colors hover:bg-brand-primary-dark"
          >
            <Square className="h-4 w-4 fill-current" />
            <span className="text-[9px] font-bold uppercase leading-none">End</span>
          </button>
        )}
        {/* Heart / reaction — everyone, bottom-most (frequent + harmless tap). */}
        <button
          onClick={sendHeart}
          aria-label="Send heart"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-transform hover:scale-110 active:scale-95"
        >
          <Heart className="h-6 w-6" />
        </button>
      </div>
    </div>
  );
}
