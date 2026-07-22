"use client";

// MM Faces — LIVE VIDEO room engine (all three modes).
//
//   • Live         (live_solo)  — one host on camera; viewers watch/comment/react.
//   • Duo Live      (live_duo)   — host + one guest on camera (2 tiles).
//   • Group Live    (live_group) — host + up to 8 guests (auto-grid, up to 9 tiles).
//
// One engine, three configs. Tiles are laid out with the TikTok/KIMI auto-grid
// math (1→1x1, 2→2 cols, ≤4→2x2, ≤6→3x2, ≤8→3x3, 9→3x3). Guests raise a hand to
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
  becomeSubscriber,
  publishLocalMedia,
  type VideoTier,
  type RemoteVideo,
} from "@/lib/livekitVideoClient";
import { authFetch } from "@/lib/authClient";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/social/providers/AuthProvider";
import FacesLiveChat from "@/components/social/faces/FacesLiveChat";
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
  Share2,
  ArrowDownToLine,
  Ban,
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
  maxOnCamera: number; // host + guests ceiling (1 for solo, 2 duo, up to 9 group)
  canPublish: boolean; // may this viewer go on camera? (host or Superfan+)
}

interface FloatingHeart {
  id: number;
  x: number; // viewport coords of the tap (or a random point for remote hearts)
  y: number;
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
  // Two people: side-by-side (2 cols × 1 row) at ALL widths, including mobile
  // portrait — TikTok/duet style. Only very narrow screens (<360px) fall back to
  // stacked so faces stay usable. See `two-up-side-by-side` note in the PR.
  if (count === 2) return "grid-cols-1 grid-rows-2 min-[360px]:grid-cols-2 min-[360px]:grid-rows-1";
  if (count <= 4) return "grid-cols-2 grid-rows-2";
  if (count <= 6) return "grid-cols-2 grid-rows-3 sm:grid-cols-3 sm:grid-rows-2";
  if (count <= 8) return "grid-cols-2 grid-rows-4 sm:grid-cols-3 sm:grid-rows-3";
  // 9 faces (host + 8 guests): mobile stacks 2x5 (10 cells), desktop 3x3.
  return "grid-cols-2 grid-rows-5 sm:grid-cols-3 sm:grid-rows-3";
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
  // Set when the host removes/bans us: PARTICIPANT_REMOVED, no auto-reconnect.
  // Drives a terminal "You were removed" overlay instead of a generic error.
  const [removed, setRemoved] = useState(false);
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
  // Only one right-side panel may be open at a time (Invite / Guests / Roster).
  // Previously each had its own `showX` flag and they all rendered at the same
  // `right-4 top-16` slot — so opening two stacked them on top of each other.
  // We now derive individual show-flags from a single `activePanel` value so
  // opening one automatically closes the others.
  type ActivePanel = "invite" | "requests" | "roster" | null;
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const showRequests = activePanel === "requests";
  const showRoster = activePanel === "roster";
  const showInvite = activePanel === "invite";
  const setShowRequests = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      setActivePanel((prev) => {
        const currentlyOpen = prev === "requests";
        const next = typeof v === "function" ? v(currentlyOpen) : v;
        return next ? "requests" : currentlyOpen ? null : prev;
      });
    },
    [],
  );
  const setShowRoster = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      setActivePanel((prev) => {
        const currentlyOpen = prev === "roster";
        const next = typeof v === "function" ? v(currentlyOpen) : v;
        return next ? "roster" : currentlyOpen ? null : prev;
      });
    },
    [],
  );
  const setShowInvite = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      setActivePanel((prev) => {
        const currentlyOpen = prev === "invite";
        const next = typeof v === "function" ? v(currentlyOpen) : v;
        return next ? "invite" : currentlyOpen ? null : prev;
      });
    },
    [],
  );
  // Guests with an in-flight promote (invite/approve) call, for pending UI.
  const [pending, setPending] = useState<Set<string>>(new Set());
  // Tile arrangement (local view only). Starts as the equal auto-grid.
  const [layout, setLayout] = useState<FacesLayout>("grid");
  // In spotlight view, which tile the viewer has tapped to feature big. null =
  // fall back to the host. Local-only view preference.
  const [featuredOverride, setFeaturedOverride] = useState<string | null>(null);
  // Identities currently speaking (local + remote merged by the video client),
  // drives the green ring on tiles.
  const [speakers, setSpeakers] = useState<Set<string>>(new Set());
  // Room-level hearts (likes): a running total persisted server-side plus a live
  // broadcast so every client animates + increments together.
  const [heartCount, setHeartCount] = useState(0);
  // Full in-room roster (everyone present, on camera or not) for the "who's
  // here" sheet — sourced from the space_participants presence rows + profiles.
  const [roster, setRoster] = useState<
    { user_id: string; name: string; avatar: string | null; role: string; has_raised_hand: boolean }[]
  >([]);


  // Invite-followers panel state (host only). Distinct from the Guests panel:
  // this invites people the host FOLLOWS who are NOT yet in the room. The
  // `showInvite` open-flag itself lives in `activePanel` above so all three
  // right-side panels are mutually exclusive.
  const [following, setFollowing] = useState<
    { id: string; name: string; avatar: string | null }[]
  >([]);
  const [followingLoaded, setFollowingLoaded] = useState(false);
  const [followingLoading, setFollowingLoading] = useState(false);
  // Recipients with an in-flight invite call and those already invited.
  const [inviting, setInviting] = useState<Set<string>>(new Set());
  const [invited, setInvited] = useState<Set<string>>(new Set());

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

  // Identities currently CONNECTED to the LiveKit room (from the client's
  // real-time roster events). This is the live source of truth for presence:
  // the DB participant rows lag (a dropped guest's row isn't reaped until the
  // webhook/leave fires), so we intersect the DB roster with this set to hide
  // people who have actually left. `presentVersion` bumps on every join/leave
  // so the roster/requests effects re-fetch immediately instead of waiting on
  // their slow poll.
  const presentIdsRef = useRef<Set<string>>(new Set());
  const [presentVersion, setPresentVersion] = useState(0);
  const isPresent = useCallback(
    (id: string) => {
      const set = presentIdsRef.current;
      // Before the first LiveKit roster event lands, don't hide anyone.
      if (set.size === 0) return true;
      // The host is always shown even if their tile briefly drops on a
      // reconnect, so the room never looks host-less.
      return set.has(id) || id === hostId;
    },
    [hostId],
  );

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
          onRosterIdentitiesChange: (ids) => {
            presentIdsRef.current = new Set(ids);
            setPresentVersion((v) => v + 1);
          },
          onAudioPlaybackChanged: (canPlay) => setAudioBlocked(!canPlay),
          onActiveSpeakersChange: (ids) => setSpeakers(new Set(ids)),
          onLocalPermissionsChanged: (allowed) => {
            // Server promoted me (host/mod approved my raised hand). Publish in
            // place — no reconnect — per the runtime-permission flow.
            if (allowed && !onCameraRef.current) void goOnCameraInPlace();
          },
          onReconnecting: () => setReconnecting(true),
          onReconnected: () => setReconnecting(false),
          onRemoved: () => {
            if (!cancelled) {
              setReconnecting(false);
              setRemoved(true);
            }
          },
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

  // Host: load raise-hand requests + the audience roster. Reads through the
  // server route (service role) so it never depends on the anon client's RLS for
  // other users' rows, then splits locally into raised-hand "requests" and the
  // rest of the guest list. Kept fresh by BOTH Supabase realtime AND a slow poll
  // — the poll is the safety net for environments where space_participants isn't
  // in the realtime publication, which is why raised hands weren't reaching the
  // host live.
  useEffect(() => {
    if (!isHost) return;
    let active = true;
    const load = async () => {
      try {
        const res = await authFetch(`/api/social/spaces/${spaceId}/participants`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const { participants } = await res.json();
        if (!active) return;
        // Only guests actually still connected to LiveKit — a dropped guest's DB
        // row lingers until the webhook reaps it, so filter by live presence.
        const guests = (participants ?? []).filter(
          (p: any) => p.role === "audience" && isPresent(p.user_id),
        );
        setRequests(
          guests
            .filter((p: any) => p.has_raised_hand)
            .map((p: any) => ({ user_id: p.user_id, name: p.name, avatar: p.avatar })),
        );
        setAudience(
          guests.map((p: any) => ({ user_id: p.user_id, name: p.name, avatar: p.avatar })),
        );
      } catch {
        /* transient — the poll or realtime will retry */
      }
    };
    void load();
    const poll = setInterval(load, 8000);
    const ch = supabase
      .channel(`faces_requests:${spaceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "space_participants", filter: `space_id=eq.${spaceId}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      active = false;
      clearInterval(poll);
      void supabase.removeChannel(ch);
    };
  }, [isHost, spaceId, presentVersion, isPresent]);

  // In-room roster ("who's here"): every active participant with a name +
  // avatar, for the tappable Users badge sheet. Read through the server route
  // (service role) so it isn't gated by the anon client's RLS. Refreshed when
  // LiveKit reports a join/leave (viewerCount changes) and on a slow poll — the
  // poll is the safety net when space_participants isn't in the realtime feed.
  useEffect(() => {
    if (!user) return;
    let active = true;
    const load = async () => {
      try {
        const res = await authFetch(`/api/social/spaces/${spaceId}/participants`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const { participants } = await res.json();
        if (!active) return;
        // Show only people still connected to LiveKit so a dropped viewer leaves
        // the "who's here" sheet immediately instead of lingering until their DB
        // presence row is reaped.
        setRoster((participants ?? []).filter((p: any) => isPresent(p.user_id)));
      } catch {
        /* transient — the poll will retry */
      }
    };
    void load();
    const poll = setInterval(load, 10000);
    return () => {
      active = false;
      clearInterval(poll);
    };
  }, [user, spaceId, viewerCount, presentVersion, isPresent]);

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
      // Prefer publishing in place (no reconnect). This succeeds once LiveKit
      // has applied the runtime publish grant (ParticipantPermissionsChanged).
      // But our Supabase role-watch fires on the DB role→speaker write, which
      // the moderation route performs BEFORE it flips the LiveKit grant — so an
      // in-place publish here can race ahead of the grant and be rejected with
      // "insufficient permissions". When that happens, fall back to reconnecting
      // with a freshly-minted PUBLISHER token: it carries canPublish
      // deterministically because the server reads our now-"speaker" DB role, so
      // it never depends on runtime-grant timing.
      let el: HTMLVideoElement | null = null;
      try {
        el = await publishLocalMedia();
      } catch {
        el = null;
      }
      if (!el) el = await becomePublisher();
      setOnCamera(true);
      setHandRaised(false);
      if (el && user) {
        localElRef.current = el;
        upsertTile({ identity: user.id, name: "You", isLocal: true, el });
      }
    } catch (e: any) {
      // The publish path failed all the way through: in-place publish failed AND
      // becomePublisher's publisher rejoin failed. becomePublisher goes through
      // joinVideoRoom, which calls leaveVideoRoom() FIRST — so at this point the
      // guest has already left the old room and would be fully disconnected
      // (black screen) if we only showed an error. Degrade gracefully: rejoin as
      // a plain SUBSCRIBER so they stay in the room and can keep watching. Do
      // this only ONCE — never auto-retry publisher promotion — to avoid loops;
      // the host can re-approve, which re-triggers this flow.
      try {
        await becomeSubscriber();
        setOnCamera(false);
        setHandRaised(false);
        localElRef.current = null;
        if (user) removeTile(user.id);
        setError("Couldn't go on camera — you're watching as a viewer. Try again.");
      } catch {
        // Even the subscriber rejoin failed (rare). Fall back to the hard error.
        setError(e?.message ?? "Could not turn on your camera");
      }
    } finally {
      promotingRef.current = false;
    }
  }, [user, upsertTile, removeTile]);

  // Guest raises / lowers hand to request coming on camera. Goes through the
  // server (service role) rather than a direct client UPDATE: RLS blocks a
  // viewer from writing their own participant row, which is why the raised hand
  // never reached the host before. Optimistic, reverted on failure.
  const toggleHand = useCallback(async () => {
    if (!user) return;
    const next = !handRaised;
    setHandRaised(next);
    try {
      const res = await authFetch(`/api/social/spaces/${spaceId}/raise-hand`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raised: next }),
      });
      if (!res.ok) setHandRaised(!next);
    } catch {
      setHandRaised(!next);
    }
  }, [handRaised, user, spaceId]);

  // Room is full when the current on-camera count (host + on-camera guests, i.e.
  // `tiles`) has reached the mode's ceiling (2 for Duo, up to 9 for group).
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
        } else {
          // Optimistic: drop the just-approved guest from the local requests
          // list so the panel fades to only the guests still waiting. If they
          // were the last one, close the panel entirely so it stops covering
          // the stage. Realtime + poll will reconcile authoritatively.
          setRequests((prev) => {
            const nextReqs = prev.filter((r) => r.user_id !== guestId);
            if (nextReqs.length === 0 && prev.length > 0) {
              // Defer the close so we don't setState during another setState.
              queueMicrotask(() => setShowRequests(false));
            }
            return nextReqs;
          });
          setAudience((prev) => prev.filter((a) => a.user_id !== guestId));
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

  // Demote an on-camera guest to audience. Server-authoritative: the PATCH
  // route flips their LiveKit publish permission off (camera/mic stop for
  // everyone) and persists role=audience so any rejoin is subscriber-only. We
  // reflect the role locally so the roster updates before the next poll.
  const removeGuest = useCallback(
    async (guestId: string) => {
      setRoster((r) =>
        r.map((p) =>
          p.user_id === guestId
            ? { ...p, role: "audience", has_raised_hand: false }
            : p,
        ),
      );
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

  // Ban + remove a guest from the room entirely (host only). The PATCH route
  // ejects them via RoomServiceClient.removeParticipant AND records a room-
  // scoped ban so the token route refuses to let them rejoin. We optimistically
  // drop them from every local list; their tile is removed when LiveKit fires
  // the participant-disconnected event.
  const banGuest = useCallback(
    async (guestId: string) => {
      setRoster((r) => r.filter((p) => p.user_id !== guestId));
      setAudience((a) => a.filter((p) => p.user_id !== guestId));
      setRequests((q) => q.filter((p) => p.user_id !== guestId));
      await authFetch(
        `/api/social/spaces/${spaceId}/participants/${guestId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ban: true }),
        },
      );
    },
    [spaceId],
  );

  // --- Invite followers (host only) ------------------------------------
  // Load the people the host follows so they can invite someone who is NOT yet
  // in the room. This is the in-app live invite, distinct from promoteToStage.
  const loadFollowing = useCallback(async () => {
    setFollowingLoading(true);
    try {
      const res = await authFetch("/api/social/connections?kind=following");
      const data = await res.json().catch(() => ({}));
      const items = (data.items ?? []).map((p: any) => ({
        id: p.id,
        name: p.display_name || p.username || "Member",
        avatar: p.avatar_url ?? null,
      }));
      setFollowing(items);
    } catch {
      /* non-fatal */
    } finally {
      setFollowingLoaded(true);
      setFollowingLoading(false);
    }
  }, []);

  const openInvitePanel = useCallback(() => {
    setShowInvite((s) => {
      const next = !s;
      if (next && !followingLoaded) void loadFollowing();
      return next;
    });
  }, [followingLoaded, loadFollowing]);

  const inviteFollower = useCallback(
    async (recipientId: string) => {
      setInviting((p) => new Set(p).add(recipientId));
      try {
        const res = await authFetch("/api/social/live-invites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipient_id: recipientId, space_id: spaceId }),
        });
        // 409 = already invited; treat as sent so the UI reflects reality.
        if (res.ok || res.status === 409) {
          setInvited((p) => new Set(p).add(recipientId));
        } else {
          const data = await res.json().catch(() => ({}));
          setError(data?.error ?? "Could not send that invite.");
        }
      } catch {
        setError("Network error sending that invite.");
      } finally {
        setInviting((p) => {
          const next = new Set(p);
          next.delete(recipientId);
          return next;
        });
      }
    },
    [spaceId],
  );

  // --- Reactions -------------------------------------------------------
  const reactionChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  useEffect(() => {
    const ch = supabase.channel(`faces_reactions:${spaceId}`, {
      config: { broadcast: { self: false } },
    });
    ch.on("broadcast", { event: "heart" }, (msg: any) => {
      spawnHeart();
      // The sender includes the new running total; adopt it so every client's
      // counter stays in lockstep without each having to re-fetch.
      const total = Number(msg?.payload?.total);
      if (Number.isFinite(total)) setHeartCount((c) => Math.max(c, total));
    }).subscribe();
    reactionChannelRef.current = ch;
    return () => {
      void supabase.removeChannel(ch);
      reactionChannelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId]);

  // Seed the running heart total on mount (and after a reconnect remounts this)
  // so the counter is populated immediately, not only after the next tap.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/social/spaces/${spaceId}/hearts`, { cache: "no-store" });
        if (!res.ok) return;
        const { hearts } = await res.json();
        if (active && Number.isFinite(Number(hearts))) setHeartCount(Number(hearts));
      } catch {
        /* non-fatal — the counter just starts at 0 until the first tap */
      }
    })();
    return () => {
      active = false;
    };
  }, [spaceId]);

  // Spawn a floating heart at viewport coords (x,y). Local likes pass the tap
  // point; remote (broadcast) hearts have none, so we scatter them across the
  // lower-middle of the stage.
  const spawnHeart = useCallback((x?: number, y?: number) => {
    const id = ++heartSeq.current;
    const px =
      x ?? (typeof window !== "undefined" ? window.innerWidth * (0.3 + Math.random() * 0.4) : 100);
    const py =
      y ?? (typeof window !== "undefined" ? window.innerHeight * (0.55 + Math.random() * 0.2) : 400);
    setHearts((h) => [...h, { id, x: px, y: py }]);
    setTimeout(() => setHearts((h) => h.filter((v) => v.id !== id)), 2200);
  }, []);

  // Tap to like: animate instantly at the tap point, optimistically bump the
  // counter, persist the increment server-side, then broadcast the authoritative
  // new total so every other client animates + syncs. Reverts on failure.
  const sendHeart = useCallback((x?: number, y?: number) => {
    spawnHeart(x, y);
    setHeartCount((c) => c + 1);
    (async () => {
      try {
        const res = await authFetch(`/api/social/spaces/${spaceId}/hearts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ by: 1 }),
        });
        if (!res.ok) {
          setHeartCount((c) => Math.max(0, c - 1));
          return;
        }
        const { hearts } = await res.json();
        const total = Number(hearts);
        if (Number.isFinite(total)) setHeartCount(total);
        reactionChannelRef.current?.send({
          type: "broadcast",
          event: "heart",
          payload: { total: Number.isFinite(total) ? total : undefined },
        });
      } catch {
        setHeartCount((c) => Math.max(0, c - 1));
      }
    })();
  }, [spawnHeart, spaceId]);

  // Tap-anywhere-to-like: a tap on empty video area spawns a heart at the tap
  // point and fires the same like action. Guarded so it never steals taps meant
  // for controls, chat, the share button, panels, or (in spotlight) tile
  // buttons — anything interactive or explicitly marked `data-no-like`.
  const handleStageTap = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          'button, a, input, textarea, select, [role="dialog"], [data-no-like]',
        )
      ) {
        return;
      }
      sendHeart(e.clientX, e.clientY);
    },
    [sendHeart],
  );

  // Share the live room: native share sheet where available, else copy the URL
  // to the clipboard with a brief "Link copied" confirmation.
  const [shareCopied, setShareCopied] = useState(false);
  const handleShare = useCallback(async () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    if (!url) return;
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    if (nav?.share) {
      try {
        await nav.share({ title, text: `Watch ${hostName} live on MELORI`, url });
      } catch {
        /* user dismissed the share sheet — nothing to do */
      }
      return;
    }
    try {
      await nav?.clipboard?.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1800);
    } catch {
      /* clipboard blocked — best effort */
    }
  }, [title, hostName]);

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

  // The featured tile in spotlight layout. Default is the HOST (this is a hosted
  // room), but the viewer can tap any thumbnail to feature that person instead
  // (`featuredOverride`). Tapping the big/host tile clears the override. The
  // active speaker no longer auto-steals the big tile — it only drives the ring.
  const featuredId = useMemo(() => {
    if (tiles.length === 0) return null;
    if (
      featuredOverride &&
      tiles.some((t) => t.identity === featuredOverride)
    ) {
      return featuredOverride;
    }
    const host = tiles.find((t) => t.identity === hostId);
    return (host ?? tiles[0]).identity;
  }, [tiles, hostId, featuredOverride]);

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
      <span className="absolute bottom-2 left-2 z-10 max-w-[85%] truncate rounded-md bg-black/45 px-2 py-0.5 text-xs font-semibold text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.9)] backdrop-blur">
        {t.name}
      </span>
    </div>
  );

  const featuredTile = tiles.find((t) => t.identity === featuredId) ?? tiles[0];
  const stripTiles = tiles.filter((t) => t.identity !== featuredTile?.identity);

  return (
    <div className="fixed inset-0 z-[60] bg-black" onClick={handleStageTap}>
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
          // strip along the bottom. Tap a thumbnail to feature that person; tap
          // the big tile to clear back to the host.
          <div className="flex h-full w-full flex-col gap-0.5">
            <button
              type="button"
              onClick={() => setFeaturedOverride(null)}
              className="relative min-h-0 flex-1 cursor-pointer text-left"
              aria-label="Feature the host"
            >
              {renderTile(featuredTile)}
            </button>
            {stripTiles.length > 0 && (
              <div className="flex h-20 w-full shrink-0 gap-0.5 overflow-x-auto sm:h-28">
                {stripTiles.map((t) => (
                  <button
                    type="button"
                    key={t.identity}
                    onClick={() => setFeaturedOverride(t.identity)}
                    className="relative aspect-square h-full shrink-0 cursor-pointer"
                    aria-label={`Feature ${t.name}`}
                  >
                    {renderTile(t)}
                  </button>
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
      <div
        data-no-like
        className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3 sm:p-4"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <div className="flex shrink-0 items-center gap-2 rounded-full bg-black/40 px-2.5 py-1.5 backdrop-blur">
            {hostAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={hostAvatar} alt={hostName} className="h-7 w-7 rounded-full object-cover" />
            ) : (
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-muted text-xs font-bold text-text-primary">
                {hostName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="max-w-[8rem] truncate text-sm font-semibold text-white sm:max-w-[10rem]">
                {hostName}
              </span>
              {/* Hearts / likes total, live-updating, directly under the host name. */}
              <span className="flex items-center gap-1 text-[11px] font-medium leading-none text-white/85">
                <Heart className="h-3 w-3 fill-current text-brand-primary" />
                {heartCount > 999 ? `${(heartCount / 1000).toFixed(1)}k` : heartCount}
              </span>
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand-primary px-2 py-1 text-[11px] font-bold uppercase leading-none tracking-wide text-white sm:px-2.5 sm:text-xs">
            <Radio className="h-3 w-3" />
            Live
          </span>
          {/* "You / Host" self-tag — moved off the video tiles up to the header. */}
          {(isHost || onCamera) && (
            <span className="inline-flex shrink-0 items-center rounded-full bg-white/15 px-2 py-1 text-[11px] font-semibold uppercase leading-none tracking-wide text-white backdrop-blur sm:text-xs">
              {isHost ? "You · Host" : "You"}
            </span>
          )}
          {!isSolo && (
            <span className="hidden shrink-0 rounded-full bg-black/40 px-2.5 py-1 text-xs font-medium leading-none text-white backdrop-blur sm:inline">
              {mode === "live_duo" ? "Duo" : "Room"} · {tiles.length}/{maxOnCamera}
            </span>
          )}
          {/* Title inline on tablet/desktop — single truncated line, no wrap. */}
          <span className="hidden min-w-0 truncate text-sm font-medium text-white/90 drop-shadow sm:inline">
            {title}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {isHost && (
            <button
              onClick={openInvitePanel}
              aria-label="Invite followers"
              className="inline-flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1.5 text-sm font-semibold text-white backdrop-blur hover:bg-black/60"
            >
              <UserPlus className="h-4 w-4" />
              <span className="hidden sm:inline">Invite</span>
            </button>
          )}
          {isHost && !isSolo && (
            <button
              onClick={() => setShowRequests((s) => !s)}
              className="relative inline-flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1.5 text-sm font-semibold text-white backdrop-blur hover:bg-black/60"
            >
              <Hand className="h-4 w-4" />
              {requests.length > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-brand-primary text-[10px] font-bold">
                  {requests.length}
                </span>
              )}
            </button>
          )}
          <button
            onClick={() => setShowRoster((s) => !s)}
            aria-label="Show who's here"
            className="inline-flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1.5 text-sm font-semibold text-white backdrop-blur transition-colors hover:bg-black/60"
          >
            <Users className="h-4 w-4" />
            {viewerCount}
          </button>
          <button
            onClick={handleLeave}
            aria-label="Leave live"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition-colors hover:bg-black/60"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Title — mobile only. On sm+ it's rendered inline in the top bar
          above so it never collides with the right-side panels. On mobile
          we keep the previous placement but constrain width and cap it to a
          single line so the guests panel that opens at `top-16` can't
          overlap the title. */}
      <div data-no-like className="absolute left-3 top-14 max-w-[62%] pr-2 sm:hidden">
        <p className="truncate text-[13px] font-medium leading-tight text-white/90 drop-shadow">
          {title}
        </p>
      </div>

      {/* Invite-followers panel (host) — bring people who FOLLOW the host into
          the live via an in-app invite. Distinct from the Guests panel below,
          which promotes people already in the room. */}
      {isHost && showInvite && (
        <div data-no-like className="absolute right-4 top-16 z-20 flex max-h-[70vh] w-72 flex-col overflow-hidden rounded-2xl border border-brand-border bg-brand-surface/95 p-3 backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-text-primary">Invite followers</p>
            <button
              onClick={() => setShowInvite(false)}
              aria-label="Close"
              className="flex h-6 w-6 items-center justify-center rounded-full text-text-secondary hover:bg-brand-muted hover:text-text-primary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mb-2 text-xs text-text-secondary">
            Bring people you follow into your live.
          </p>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {followingLoading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-text-secondary">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : following.length === 0 ? (
              <p className="py-4 text-xs text-text-secondary">
                You&apos;re not following anyone yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {following.map((f) => {
                  const sent = invited.has(f.id);
                  const busy = inviting.has(f.id);
                  return (
                    <li key={f.id} className="flex items-center gap-2">
                      {f.avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={f.avatar}
                          alt={f.name}
                          className="h-8 w-8 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-muted text-xs font-bold text-text-primary">
                          {f.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                        {f.name}
                      </span>
                      <button
                        onClick={() => inviteFollower(f.id)}
                        disabled={sent || busy}
                        aria-label={`Invite ${f.name}`}
                        className="flex items-center gap-1 rounded-full border border-brand-border px-2.5 py-1 text-xs font-semibold text-text-primary hover:border-brand-primary hover:text-brand-primary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {busy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : sent ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <UserPlus className="h-3.5 w-3.5" />
                        )}
                        {sent ? "Invited" : "Invite"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Guests panel (host) — raised-hand REQUESTS to approve on top, then the
          full AUDIENCE roster to invite from. Mirrors the MM Spaces "Raised
          Hands" + "Audience" sections; every action hits the same server-side
          moderation endpoint. */}
      {isHost && !isSolo && showRequests && (
        <div data-no-like className="absolute right-4 top-16 z-20 flex max-h-[70vh] w-72 flex-col overflow-hidden rounded-2xl border border-brand-border bg-brand-surface/95 p-3 backdrop-blur">
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

      {/* Who's-here roster — every active participant (name + avatar), sourced
          from the space_participants presence rows. Opened from the Users badge;
          updates live as people join/leave. Anyone can view it. */}
      {showRoster && (
        <div data-no-like className="absolute right-4 top-16 z-20 flex max-h-[70vh] w-72 flex-col overflow-hidden rounded-2xl border border-brand-border bg-brand-surface/95 p-3 backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-text-primary">In the room</p>
            <button
              onClick={() => setShowRoster(false)}
              aria-label="Close"
              className="flex h-6 w-6 items-center justify-center rounded-full text-text-secondary hover:bg-brand-muted hover:text-text-primary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {roster.length === 0 ? (
              <p className="text-xs text-text-secondary">No one here yet.</p>
            ) : (
              <ul className="space-y-2">
                {roster.map((p) => {
                  // Host-only moderation: never on the host row, never on
                  // yourself. Demote is offered only for someone on camera.
                  const canModerate =
                    isHost && p.user_id !== hostId && p.user_id !== user?.id;
                  return (
                  <li key={p.user_id} className="flex items-center gap-2">
                    {p.avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.avatar} alt={p.name} className="h-8 w-8 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-muted text-xs font-bold text-text-primary">
                        {p.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{p.name}</span>
                    {p.has_raised_hand && p.role === "audience" && (
                      <Hand className="h-3.5 w-3.5 text-brand-primary" />
                    )}
                    {(p.role === "host" || p.role === "speaker") && (
                      <span className="rounded-full bg-brand-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-primary">
                        {p.role === "host" ? "Host" : "On camera"}
                      </span>
                    )}
                    {canModerate && (
                      <div className="flex shrink-0 items-center gap-1">
                        {p.role === "speaker" && (
                          <button
                            onClick={() => void removeGuest(p.user_id)}
                            aria-label={`Move ${p.name} to audience`}
                            title="Move to audience"
                            className="flex h-7 w-7 items-center justify-center rounded-full text-text-secondary hover:bg-brand-muted hover:text-text-primary"
                          >
                            <ArrowDownToLine className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          onClick={() => void banGuest(p.user_id)}
                          aria-label={`Remove ${p.name} from the room`}
                          title="Remove from room"
                          className="flex h-7 w-7 items-center justify-center rounded-full text-red-500 hover:bg-red-500/10"
                        >
                          <Ban className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Removed-by-host overlay — terminal. LiveKit disconnected us with
          PARTICIPANT_REMOVED (host ban/kick) and will NOT auto-reconnect, and
          the token route refuses a rejoin, so we show a clear message and only
          offer a way back to the Faces list. Takes precedence over other UI. */}
      {removed && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 p-6 backdrop-blur">
          <div className="w-[min(90%,24rem)] rounded-2xl border border-brand-border bg-brand-surface p-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
              <Ban className="h-6 w-6 text-red-500" />
            </div>
            <p className="text-base font-semibold text-text-primary">
              You were removed from this room
            </p>
            <p className="mt-1 text-sm text-text-secondary">
              The host removed you from this live room.
            </p>
            <Link
              href="/social/live"
              className="mt-4 inline-block rounded-full bg-brand-primary px-4 py-2 text-sm font-semibold text-white hover:bg-brand-primary-dark"
            >
              Back to MM Faces
            </Link>
          </div>
        </div>
      )}

      {/* Status overlays */}
      {(connecting || reconnecting) && !removed && (
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

      {/* Reaction hearts — spawn at the tap point and rise/fade. Full-stage,
          click-through layer so it never blocks controls or chat. */}
      <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
        {hearts.map((h) => (
          <span
            key={h.id}
            className="faces-heart absolute text-3xl"
            style={{ left: h.x, top: h.y, transform: "translate(-50%, -50%)" }}
          >
            ❤️
          </span>
        ))}
      </div>

      {/* TikTok-style live comment overlay — raised off the very bottom so it
          sits ABOVE the control bar. Messages float above the translucent input
          and auto-fade. Click-through except its own input/messages. */}
      <div
        data-no-like
        className="pointer-events-none absolute left-3 right-3 z-10 flex flex-col justify-end sm:right-auto sm:w-96"
        style={{
          bottom: "calc(env(safe-area-inset-bottom) + 5rem)",
          top: "40%",
        }}
      >
        <FacesLiveChat spaceId={spaceId} />
      </div>

      {/* "Link copied" confirmation for the share fallback. */}
      {shareCopied && (
        <div
          data-no-like
          className="absolute left-1/2 z-40 -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-sm font-semibold text-white backdrop-blur"
          style={{ bottom: "calc(env(safe-area-inset-bottom) + 8.5rem)" }}
        >
          Link copied
        </div>
      )}

      {/* Broadcast controls — CENTERED BOTTOM BAR (moved off the right rail).
          Horizontally laid out, pinned to the safe-area bottom, and sitting
          below the raised chat so nothing overlaps. The dedicated heart button
          is gone — tap anywhere on empty video to like (see handleStageTap). */}
      <div
        data-no-like
        className="absolute inset-x-0 z-30 flex items-center justify-center gap-3 px-3"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 0.85rem)" }}
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
        {/* Share — native share sheet where available, else copy link. */}
        <button
          onClick={handleShare}
          aria-label="Share this live"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/25"
        >
          <Share2 className="h-5 w-5" />
        </button>
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
      </div>
    </div>
  );
}
