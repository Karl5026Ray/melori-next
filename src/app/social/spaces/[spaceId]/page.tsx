"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { useCanParticipate, useCanRequestStage } from "@/components/social/UpgradePrompt";
import { canSpeak, handRaiseAllowed } from "@/lib/spacesStage";
import { authFetch, authHeaders } from "@/lib/authClient";
import {
  joinChannel as agoraJoin,
  leaveChannel as agoraLeave,
  setMuted as agoraSetMuted,
  setRole as agoraSetRole,
  ensureAudioPlayback as agoraEnsureAudio,
} from "@/lib/livekitClient";
import {
  ensureVideoAudio,
  isVideoRoomConnected,
  joinVideoRoom,
  leaveVideoRoom,
  setCameraEnabled as setCinemaCameraEnabled,
  setMicEnabled as setCinemaMicEnabled,
} from "@/lib/livekitVideoClient";
import {
  joinPresence as pubnubJoin,
  leavePresence as pubnubLeave,
  publishSignal as pubnubPublishSignal,
} from "@/lib/pubnubClient";
import { ROOM_ENDED_MESSAGE } from "@/lib/roomDisconnect";
import { Space, SpaceParticipant, getRoomFormatConfig } from "@/types/social";
import { sortStageQueue } from "@/lib/stageQueue";
import { Badge } from "@/components/social/ui/Badge";
import { StageGrid } from "@/components/social/spaces/StageGrid";
import RoomCommentOverlay from "@/components/social/spaces/RoomCommentOverlay";
import { useRoomComments } from "@/components/social/rooms/useRoomComments";
import CinemaStage from "@/components/social/cinema/CinemaStage";
import CinemaAudience from "@/components/social/cinema/CinemaAudience";
import CinemaChat from "@/components/social/cinema/CinemaChat";
import { CinemaScreen } from "@/components/social/cinema/CinemaScreen";
import { buildCinemaSlotAssignments, type CinemaReservation } from "@/lib/roomMediaPolicy";
import { roomExitHref, roomExitLabel } from "@/lib/cinema";
import {
  ChevronDown,
  Share2,
  MoreHorizontal,
  Mic,
  MicOff,
  Hand,
  Send,
  Smile,
  Volume2,
  Copy,
  Flag,
  Trash2,
  VolumeX,
  UserMinus,
  Video,
  VideoOff,
} from "lucide-react";
import Link from "next/link";

export default function SpaceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const canParticipate = useCanParticipate();
  // Clubhouse parity: raising a hand is gated on being signed in ONLY (no
  // Superfan requirement) — see src/lib/spacesStage.ts. Speaking itself is
  // gated separately below on the caller's own participant role, which only
  // changes once the host promotes them.
  const canRequestStage = useCanRequestStage();
  const spaceId = params.spaceId as string;

  const [space, setSpace] = useState<Space | null>(null);
  const isCinema = space?.room_format === "cinema";

  // Where every exit from this room leads. Cinema rooms are `spaces` rows and
  // render at this same route, so without this they'd dump the viewer into
  // Spaces — a screen they may never have been on.
  //
  // Mirrored into a ref because the leave/end callbacks and the Agora + PubNub
  // effects need it too, and adding it to their dependency arrays would tear
  // down and rebuild live audio connections every time `space` refreshes.
  const exitHref = roomExitHref(space?.room_format);
  const exitHrefRef = useRef(exitHref);
  exitHrefRef.current = exitHref;

  const [participants, setParticipants] = useState<SpaceParticipant[]>([]);
  const [cinemaReservations, setCinemaReservations] = useState<CinemaReservation[]>([]);
  // Did THIS page session deliberately turn the camera on? Read by the Cinema
  // join effect to resume capture after a role change or reconnect rebuilds the
  // room. It is a ref, not state, so it never re-triggers that effect — and it
  // is deliberately per-page-session: a durable reservation alone must never
  // switch a camera on for someone who just loaded the page.
  const cinemaCameraIntentRef = useRef(false);
  const [cinemaVideoElements, setCinemaVideoElements] = useState<
    Record<string, HTMLVideoElement>
  >({});
  // Camera capture requires a connected room. Tracked so the control is disabled
  // until then rather than claiming a durable slot with nothing to publish on.
  const [cinemaRoomConnected, setCinemaRoomConnected] = useState(false);
  // A camera toggle claims a durable slot, so it must not run twice at once: a
  // double tap would otherwise race a claim against its own release.
  const [cinemaCameraBusy, setCinemaCameraBusy] = useState(false);
  // `participants` starts empty for two very different reasons: the roster has
  // not come back yet, or the roster came back empty. Everything that decides
  // whether we are in the room has to tell those apart, otherwise a member who
  // IS in the room gets treated as a stranger for the first few hundred ms.
  // That was the flash of "Join Space" on every entry.
  const [rosterLoaded, setRosterLoaded] = useState(false);
  const [isJoined, setIsJoined] = useState(false);
  // Set when a join attempt actually failed, so the auto-join effect stops
  // retrying into the same error and the room can offer a manual retry rather
  // than looping silently.
  const [joinFailed, setJoinFailed] = useState(false);
  // True only while an upsert is in flight, so the roster-mirror effect above
  // doesn't read the not-yet-written row as "you were removed".
  const joiningRef = useRef(false);
  // Where to come back to after a sign-in detour.
  const roomPath = `/social/spaces/${spaceId}`;
  const [isMuted, setIsMuted] = useState(true);
  const [hasRaisedHand, setHasRaisedHand] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [shareToast, setShareToast] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [reactions, setReactions] = useState<string[]>([]);
  // Targeted reaction bursts, keyed by the target participant's user id. Each
  // value is a list of unique burst keys ("<ts>-<seq>:<emoji>"). Rendered over
  // that person's avatar in StageGrid, separate from the center-screen bursts.
  const [targetedReactions, setTargetedReactions] = useState<
    Record<string, string[]>
  >({});
  // The participant whose per-person reaction picker is currently open (null =
  // closed).
  const [reactTarget, setReactTarget] = useState<SpaceParticipant | null>(null);
  // Members the viewer has followed from inside this room, so their tile flips
  // from "+" to a check without a refetch.
  //
  // Seeded empty on purpose: /api/social/follow only answers for a single
  // target, so hydrating true follow state for a 40-person room would be 40
  // requests. Until that route accepts a batch `targets=` list, someone you
  // already follow shows a "+" until you tap it — the POST is a no-op upsert
  // in that case, so the only cost is a redundant tap.
  const [followedIds, setFollowedIds] = useState<Set<string>>(new Set());
  // Room chat is now a pull-up sheet behind the control bar's chat button
  // rather than a 70vh box wedged into the page's scroll flow, so the
  // participant grid gets the full sheet the way the reference room does.
  const [draft, setDraft] = useState("");
  // Tapping a tile as the host opens per-person controls; long-press always
  // reacts. See StageGrid for the gesture handling.
  const [modTarget, setModTarget] = useState<SpaceParticipant | null>(null);
  // Newest room event, rendered as the one-line ticker docked above the
  // controls. Reactions only for now — hand raises keep their own toast.
  const [activity, setActivity] = useState<{
    key: string;
    actor: string;
    emoji: string;
    target: string;
  } | null>(null);
  const [micDenied, setMicDenied] = useState(false);   const [reconnecting, setReconnecting] = useState(false);
  // Set when the room ended out from under us (host ended it, or the lazy
  // abandonment reaper closed it) — either via the LiveKit ROOM_DELETED
  // disconnect reason or the PubNub "space-ended" system signal. Shows a calm
  // banner briefly before navigating away, instead of silently bouncing.
  const [roomEnded, setRoomEnded] = useState(false);
  // Real-time set of user_ids currently speaking (LiveKit identity == user id).
  // Primary driver for the speaking ring so EVERY speaker shows it, not just us.
  const [speakingIds, setSpeakingIds] = useState<Set<string>>(new Set());
  const [liveHere, setLiveHere] = useState<number | null>(null);
  const [peerHandToast, setPeerHandToast] = useState<string | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Monotonic counter so simultaneous reactions get unique React keys even if
  // they share a millisecond timestamp (fan-out can burst several at once).
  const reactionSeqRef = useRef(0);
  // Mirror of `participants` for use inside the PubNub signal callback, which
  // lives in an effect that must NOT re-subscribe every time the list changes
  // (that would tear down + rebuild presence). The ref stays current without
  // being a dependency.
  const participantsRef = useRef<SpaceParticipant[]>([]);
  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);

  useEffect(() => {
    const fetchSpace = async () => {
      const { data: spaceData } = await supabase
        .from("spaces")
        .select(
          `
          *,
          host:profiles(id, display_name, avatar_url, role, verified)
        `
        )
        .eq("id", spaceId)
        .single();

      if (spaceData) {
        setSpace(spaceData as Space);
      } else {
        setError("Space not found");
      }
      setIsLoading(false);
    };

    const fetchParticipants = async () => {
      const { data } = await supabase
        .from("space_participants")
        .select(
          `
          *,
          user:profiles(id, display_name, avatar_url, role, verified)
        `
        )
        .eq("space_id", spaceId)
        .is("left_at", null)
        .order("joined_at", { ascending: true });

      if (data) setParticipants(data as SpaceParticipant[]);
      setRosterLoaded(true);
    };

    fetchSpace();
    fetchParticipants();

    const channel = supabase
      .channel(`space:${spaceId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "space_participants",
          filter: `space_id=eq.${spaceId}`,
        },
        () => {
          fetchParticipants();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [spaceId]);

  // Camera assignments are durable state, separate from transient LiveKit
  // tracks. This keeps a guest departure as an empty fixed tile instead of
  // deriving/reordering seats from whichever speaker list arrived first.
  const refreshCinemaSlots = useCallback(async () => {
    try {
      const res = await fetch(`/api/social/spaces/${spaceId}/cinema-camera-slot`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data?.reservations)) {
        setCinemaReservations(
          data.reservations.map((entry: { slot: number; userId?: string; user_id?: string }) => ({
            slot: Number(entry.slot),
            userId: String(entry.userId ?? entry.user_id),
          })),
        );
      }
    } catch {
      // A slot fetch failure must render placeholders, never speculative seats.
      setCinemaReservations([]);
    }
  }, [spaceId]);

  useEffect(() => {
    if (!isCinema) {
      setCinemaReservations([]);
      setCinemaVideoElements({});
      cinemaCameraIntentRef.current = false;
      return;
    }
    void refreshCinemaSlots();
    const channel = supabase
      .channel(`cinema_slots:${spaceId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "cinema_camera_slots",
          filter: `space_id=eq.${spaceId}`,
        },
        () => void refreshCinemaSlots(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [isCinema, refreshCinemaSlots, spaceId]);

  // Mirror the roster into local join state. This used to be a one-way latch
  // (it only ever set isJoined true), so a host removing someone left that
  // person looking joined to themselves: composer live, controls live, writes
  // silently failing. Now the roster is the single source of truth in both
  // directions, and we only trust it once it has actually loaded.
  useEffect(() => {
    if (!user || !rosterLoaded) return;
    const myParticipation = participants.find(
      (p) => p.user_id === user.id && !p.left_at
    );
    if (myParticipation) {
      setIsJoined(true);
      setIsMuted(myParticipation.is_muted);
      setHasRaisedHand(myParticipation.has_raised_hand);
    } else if (!joiningRef.current) {
      // Not on the roster and we aren't mid-join — we're genuinely out.
      setIsJoined(false);
      setHasRaisedHand(false);
    }
  }, [user, participants, rosterLoaded]);
  
  const handleJoin = useCallback(async () => {
    if (!user) {
      // Come back to THIS room after signing in. AuthForm already honours
      // ?next= (with an open-redirect guard) and threads it through the Google
      // and Apple OAuth round-trips, so the room survives the whole detour.
      // Without this a shared room link was a dead end: tap in, sign in, land
      // on the social home with no idea where the room went.
      router.push(`/social/auth?next=${encodeURIComponent(roomPath)}`);
      return;
    }
    // Re-entrancy guard. This is called from an effect whose dependencies
    // include `participants`, which changes on every realtime tick, so without
    // a ref the first roster update after entry could fire a second join
    // before setIsJoined had landed — resetting joined_at and racing the role
    // calculation below against itself.
    if (joiningRef.current) return;
    joiningRef.current = true;

    try {
      // Stage placement is gated on membership: the host and any paid/elevated
      // member (admin, artist, superfan) start on stage; free members join as
      // listeners in the audience and can raise a hand to be promoted. Preserve an
      // existing on-stage role on re-join so we never demote someone who was
      // already speaking (or a free member the host promoted to speaker).
      const isHostJoining = user.id === space?.host_id;
      const stageRoles = ["admin", "artist", "superfan"];
      const isElevated = stageRoles.includes((((user as any).role as string) || "").toLowerCase());
      // Read through the ref, not the closed-over array. The closure can be a
      // tick behind the roster, and "I can't see your row" used to be
      // indistinguishable from "you don't have one" — which quietly demoted a
      // reconnecting speaker to audience mid-sentence.
      const existing = participantsRef.current.find((p) => p.user_id === user.id);
      const keepsStage =
        existing?.role === "speaker" || existing?.role === "host";
      const joinRole = isHostJoining
        ? "host"
        : keepsStage
          ? existing!.role
          : isElevated
            ? "speaker"
            : "audience";
      // On stage but start muted (except the host) so people opt in to talking.
      const joinMuted = joinRole === "host" ? false : true;

      // Only claim a role when we are actually creating the row. On a rejoin we
      // clear left_at and leave role/is_muted alone, so a host's promotion or
      // mute made while we were away is not overwritten by a stale client.
      const payload: Record<string, unknown> = existing
        ? {
            space_id: spaceId,
            user_id: user.id,
            left_at: null,
          }
        : {
            space_id: spaceId,
            user_id: user.id,
            role: joinRole,
            is_muted: joinMuted,
            joined_at: new Date().toISOString(),
            left_at: null,
          };

      const { error } = await supabase
        .from("space_participants")
        .upsert(payload, { onConflict: "space_id,user_id" });

      if (error) {
        // Show the real reason (RLS, network, etc.) instead of pretending we joined.
        setShareToast(error.message || "Could not join this space");
        setTimeout(() => setShareToast(null), 2500);
        setJoinFailed(true);
        return;
      }
      setJoinFailed(false);
      setIsJoined(true);
      // Unlock remote audio playback so listeners can hear the speakers.
      // Browsers only honour this inside a user gesture; entering the room from
      // a tap counts, and the mic button covers the case where it doesn't.
      void (isCinema ? ensureVideoAudio() : agoraEnsureAudio());
      // Best-effort participant count bump. Doesn't gate the UX.
      void supabase
        .rpc("increment_space_participants", { space_id: spaceId })
        .then(({ error: rpcErr }) => {
          if (rpcErr) console.warn("increment_space_participants failed", rpcErr);
        });
    } finally {
      joiningRef.current = false;
    }
  }, [user, spaceId, router, space, roomPath, isCinema]);

  // Enter the room on arrival, for EVERY signed-in user.
  //
  // This used to fire only for the host and paid tiers (admin/artist/superfan);
  // everyone else got a "Join Space" interstitial. That split is why the
  // problem stayed invisible for so long — the people testing the room were
  // exactly the people the gate skipped.
  //
  // No competing product gates LISTENING behind a confirmation screen: X
  // Spaces, Clubhouse, Fanbase and Discord Stage Channels all drop you
  // straight into the audience, muted. Gating belongs on SPEAKING, which is
  // still enforced server-side by the livekit-token route. So: arrive, you're
  // in, silent; ask to speak when you want the floor.
  //
  // Waits on rosterLoaded so the join decision is made against a real roster —
  // otherwise a member already in the room would be re-joined from scratch on
  // every entry.
  const autoJoinedRef = useRef(false);
  useEffect(() => {
    if (autoJoinedRef.current) return;
    if (isJoined || joinFailed) return;
    if (!user || !space || !rosterLoaded) return;
    if (space.status === "ended" || space.ended_at) return;
    autoJoinedRef.current = true;
    void handleJoin();
  }, [isJoined, joinFailed, user, space, rosterLoaded, handleJoin]);

  const handleLeave = useCallback(async () => {
    if (!user) return;

    // Release media before the follow-up API call so hardware shuts down even
    // shuts down even if the follow-up API call fails.
    try {
      if (isCinema) await leaveVideoRoom();
      else await agoraLeave();
    } catch {
      /* noop */
    }

    // Server-side leave: marks participant + auto-ends space when the last
    // host leaves (Clubhouse-style ephemerality).
    try {
      await authFetch(`/api/social/spaces/${spaceId}/leave`, {
        method: "POST",
        keepalive: true,
      });
    } catch {
      // Fallback: mark left_at directly.
      await supabase
        .from("space_participants")
        .update({ left_at: new Date().toISOString() })
        .eq("space_id", spaceId)
        .eq("user_id", user.id);
    }

    setIsJoined(false);
    await supabase.rpc("decrement_space_participants", { space_id: spaceId });
    router.push(exitHrefRef.current);
  }, [user, spaceId, router, isCinema]);

  // My own current on-stage role, mirrored from the participants table
  // (server-authoritative -- set only by the host's moderation actions or the
  // join flow). Drives whether the mic/PTT controls render at all: Clubhouse
  // parity means this is NOT the Superfan gate any more, it is "has the host
  // put me on stage". Declared here (above applyMute/toggleMute/toggleHand)
  // since those callbacks depend on it.
  const myRole = participants.find((p) => p.user_id === user?.id && !p.left_at)?.role ?? null;
  const canSpeakNow = canSpeak(myRole);
  const handRaiseMode = space?.hand_raise_mode ?? "everyone";
  const canRaiseHandNow =
    canRequestStage && handRaiseAllowed(handRaiseMode, { signedIn: !!user });

  // Central helper: change mute state locally + on LiveKit + in the DB.
  // The audio session is the source of truth: we drive the mic first, then
  // mirror local state, then persist. A Supabase/RLS hiccup on the DB write
  // must never leave the mic logically stuck.
  const applyMute = useCallback(
    async (nextMuted: boolean) => {
      if (!user) return;
      try {
        if (isCinema) await setCinemaMicEnabled(!nextMuted);
        else await agoraSetMuted(nextMuted);
        // A successful unmute means the mic is actually live — clear any
        // previous "blocked" hint.
        if (!nextMuted) setMicDenied(false);
      } catch (err) {
        // Going live failed (most often getUserMedia was blocked, or no
        // publisher token). Surface it and stay muted so the UI reflects
        // reality instead of showing a mic that isn't really publishing.
        const msg = (err as Error)?.message ?? "";
        if (!nextMuted && /NotAllowed|Permission|permission denied|denied/i.test(msg)) {
          setMicDenied(true);
        }
        console.warn("mic toggle failed", err);
        if (!nextMuted) {
          setIsMuted(true);
          return;
        }
      }
      setIsMuted(nextMuted);
      // Persist is_muted last, best-effort. The mic + local state above already
      // reflect the change, so an RLS/network failure here can't wedge the UI.
      const { error: muteErr } = await supabase
        .from("space_participants")
        .update({ is_muted: nextMuted })
        .eq("space_id", spaceId)
        .eq("user_id", user.id);
      if (muteErr) console.warn("is_muted persist failed", muteErr);
    },
    [user, spaceId, isCinema],
  );

  const toggleMute = useCallback(async () => {
    if (!user) return;
    // Speaking requires the host to have put us on stage (role 'host' or
    // 'speaker') -- Clubhouse parity, no membership tier check. The
    // livekit-token route enforces the same rule server-side for Spaces, so
    // this can never be bypassed even if this button were tampered with.
    if (!canSpeakNow) {
      return;
    }
    // Keyboard/click activation is also a user gesture — unlock playback here
    // too so non-pointer paths still enable remote audio.
    void (isCinema ? ensureVideoAudio() : agoraEnsureAudio());
    await applyMute(!isMuted);
  }, [user, isMuted, canSpeakNow, applyMute, isCinema]);

  // Press-and-hold-to-talk (PTT). While the mic button is held down we
  // unmute; on release we return to whatever mute state the user had before.
  // Short taps still fall through to `toggleMute` (see button onClick).
  const pttPrevMutedRef = useRef<boolean | null>(null);
  const pttHeldRef = useRef(false);
  const pttStartedAtRef = useRef(0);
  // Set when a pointer/touch release has already handled the tap so the
  // synthetic click that follows a mouse release doesn't toggle a second time.
  const suppressClickRef = useRef(false);

  const startPTT = useCallback(() => {
    if (!user || !canSpeakNow) return;
    // Unlock remote audio playback from this genuine user gesture (pointer/
    // touch/mouse down) so browsers allow everyone to be heard instantly.
    void (isCinema ? ensureVideoAudio() : agoraEnsureAudio());
    if (pttHeldRef.current) return;
    pttHeldRef.current = true;
    pttStartedAtRef.current = Date.now();
    pttPrevMutedRef.current = isMuted;
    // Optimistically go live while the button is held. For a quick tap we
    // reconcile this into a normal toggle in endPTT.
    if (isMuted) void applyMute(false);
  }, [user, canSpeakNow, isMuted, applyMute, isCinema]);

  const endPTT = useCallback(() => {
    if (!pttHeldRef.current) return false;
    const heldMs = Date.now() - pttStartedAtRef.current;
    pttHeldRef.current = false;
    const prevMuted = pttPrevMutedRef.current;
    pttPrevMutedRef.current = null;

    // Quick tap (< 350ms) → behave like a plain mute toggle. startPTT already
    // unmuted us if we were muted, so a tap that STARTED muted is now
    // (correctly) unmuted — leave it. A tap that started unmuted should mute.
    // Crucially this decision is made here in the pointer/touch handler, not in
    // a follow-up click: on touch the synthetic click is suppressed by
    // preventDefault, so relying on onClick left the mic stuck muted.
    if (heldMs < 350) {
      if (prevMuted === false) void applyMute(true);
      return true;
    }
    // Long press: restore whatever mute state we came from.
    if (prevMuted !== null) void applyMute(prevMuted);
    return true;
  }, [applyMute]);

  // Pointer/touch release handler: run the tap-vs-hold decision, then swallow
  // the synthetic click that a mouse release triggers so we don't toggle twice.
  const endPTTGesture = useCallback(() => {
    if (endPTT()) {
      suppressClickRef.current = true;
      // Clear shortly after the synthetic click would have arrived so a later
      // real click / keyboard activation isn't wrongly swallowed.
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 400);
    }
  }, [endPTT]);

  const toggleHand = useCallback(async () => {
    if (!user) {
      router.push("/social/auth");
      return;
    }
    // Clubhouse parity: raising a hand is signed-in-only, no Superfan gate.
    // The host may still turn hand-raising off (or, later, limit it to
    // followed accounts) via hand_raise_mode -- enforced server-side by the
    // raise-hand route and mirrored here so the control doesn't even render
    // when it would be rejected (see canRaiseHandNow below the button).
    if (!canRequestStage) {
      router.push("/social/auth");
      return;
    }
    const newHand = !hasRaisedHand;
    // Optimistic UI, reverted below if the server rejects the request (e.g.
    // the host just switched hand-raise mode to "off") so we never leave the
    // hand shown as raised when it wasn't actually recorded.
    setHasRaisedHand(newHand);
    void pubnubPublishSignal(spaceId, { type: "hand", raised: newHand });
    try {
      const res = await authFetch(`/api/social/spaces/${spaceId}/raise-hand`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raised: newHand }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setHasRaisedHand(!newHand);
        setShareToast(data?.error ?? "Could not raise hand");
        setTimeout(() => setShareToast(null), 2500);
      }
    } catch {
      setHasRaisedHand(!newHand);
      setShareToast("Network error");
      setTimeout(() => setShareToast(null), 2500);
    }
  }, [user, spaceId, hasRaisedHand, canRequestStage, router]);

  const isHost = user?.id === space?.host_id;
  // One comment subscription feeds both presentations. Cinema renders the
  // transient overlay while this page owns its only composer in the stable dock.
  const {
    comments: roomComments,
    sendComment,
    sending: sendingComment,
  } = useRoomComments(spaceId, true);

  const submitComment = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const text = draft;
      if (!text.trim() || sendingComment) return;
      const result = await sendComment(text);
      if (result.ok) setDraft("");
    },
    [draft, sendingComment, sendComment],
  );

  // Copy the room URL to the clipboard, with a Web Share fallback on mobile.
  const handleShare = useCallback(async () => {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    const title = space?.title ?? "MELORI Space";
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
    } catch {
      /* user cancelled — fall through to clipboard */
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareToast("Room link copied");
    } catch {
      setShareToast("Could not copy link");
    }
    setTimeout(() => setShareToast(null), 2200);
  }, [space?.title]);

  // Host-only: promote an audience member to speaker.
  const invitePromote = useCallback(
    async (participantUserId: string) => {
      if (!isHost) return;
      try {
        const res = await authFetch(
          `/api/social/spaces/${spaceId}/participants/${participantUserId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: "speaker" }),
          },
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setShareToast(data?.error ?? "Could not invite speaker");
          setTimeout(() => setShareToast(null), 2200);
        }
      } catch {
        setShareToast("Network error");
        setTimeout(() => setShareToast(null), 2200);
      }
    },
    [isHost, spaceId],
  );

  // Small helper: run a host moderation call and surface success/failure via
  // the same shareToast we use for the copy-link button. Silently failing
  // moderation is a footgun — the host taps and thinks it worked.
  const runHostAction = useCallback(
    async (
      participantUserId: string,
      body: Record<string, unknown>,
      successToast: string,
    ) => {
      if (!isHost) return;
      try {
        const res = await authFetch(
          `/api/social/spaces/${spaceId}/participants/${participantUserId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setShareToast(data?.error ?? "Action failed");
        } else {
          setShareToast(successToast);
        }
      } catch {
        setShareToast("Network error");
      }
      setTimeout(() => setShareToast(null), 2200);
    },
    [isHost, spaceId],
  );

  // Host-only: force-mute a speaker (they can still be present, just muted).
  const hostMute = useCallback(
    (participantUserId: string, muted: boolean) =>
      runHostAction(
        participantUserId,
        { host_muted: muted },
        muted ? "Speaker muted" : "Speaker unmuted",
      ),
    [runHostAction],
  );

  // Host-only: demote a speaker back to audience.
  const hostDemote = useCallback(
    (participantUserId: string) =>
      runHostAction(
        participantUserId,
        { role: "audience" },
        "Moved to audience",
      ),
    [runHostAction],
  );

  // Host-only: remove someone from the space entirely.
  const hostRemove = useCallback(
    (participantUserId: string) =>
      runHostAction(
        participantUserId,
        { remove: true },
        "Removed from space",
      ),
    [runHostAction],
  );

  const handleGoLive = useCallback(async () => {
    if (!isHost) return;
    const res = await authFetch(`/api/social/spaces/${spaceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "go_live" }),
    });
    if (res.ok) {
      const { space: updated } = await res.json();
      setSpace((prev) => (prev ? { ...prev, ...updated } : prev));
    }
  }, [isHost, spaceId]);

  // Host-only: change who is allowed to raise a hand in this space (Clubhouse
  // parity control #4). Optimistic with revert-on-failure, same pattern as
  // the other host actions in this file (runHostAction) -- a failed call must
  // never leave the menu silently lying about the active mode.
  const setHandRaiseMode = useCallback(
    async (mode: "off" | "followed" | "everyone") => {
      if (!isHost) return;
      const prevMode = space?.hand_raise_mode ?? "everyone";
      setSpace((prev) => (prev ? { ...prev, hand_raise_mode: mode } : prev));
      try {
        const res = await authFetch(`/api/social/spaces/${spaceId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "set_hand_raise_mode", hand_raise_mode: mode }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setSpace((prev) => (prev ? { ...prev, hand_raise_mode: prevMode } : prev));
          setShareToast(data?.error ?? "Could not update hand-raise mode");
        } else {
          setShareToast(`Hand-raise: ${mode}`);
        }
      } catch {
        setSpace((prev) => (prev ? { ...prev, hand_raise_mode: prevMode } : prev));
        setShareToast("Network error");
      }
      setTimeout(() => setShareToast(null), 2200);
    },
    [isHost, spaceId, space?.hand_raise_mode],
  );

  const handleEndSpace = useCallback(async () => {
    if (!isHost) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm("End this space for everyone?")
    ) {
      return;
    }
    try {
      if (isCinema) await leaveVideoRoom();
      else await agoraLeave();
    } catch {
      /* noop */
    }
    await authFetch(`/api/social/spaces/${spaceId}/end`, { method: "POST", headers: { "Content-Type": "application/json" } });
    router.push(exitHrefRef.current);
  }, [isHost, spaceId, router, isCinema]);

  // Spawn a floating emoji burst locally. Used both for the local user's own
  // reactions and for reactions received from other participants over PubNub.
  // Fades after ~2s. The seq counter guarantees a unique React key.
  const spawnReaction = useCallback((emoji: string) => {
    const key = `${Date.now()}-${reactionSeqRef.current++}:${emoji}`;
    setReactions((prev) => [...prev, key]);
    setTimeout(() => {
      setReactions((prev) => prev.filter((r) => r !== key));
    }, 2000);
  }, []);

  // Lightweight in-room reactions (host + audience). Show it locally right away
  // (optimistic), then fan it out to the whole room over PubNub so everyone
  // sees it instantly. Purely visual — never persisted.
  const sendReaction = useCallback(
    (emoji: string) => {
      spawnReaction(emoji);
      void pubnubPublishSignal(spaceId, { type: "reaction", emoji });
    },
    [spaceId, spawnReaction],
  );

  // Spawn a floating emoji burst over a specific participant's avatar. Mirrors
  // spawnReaction but keyed by the target user id so StageGrid can render each
  // person's bursts locally. Fades after ~2s; the seq counter keeps keys unique.
  const spawnTargetedReaction = useCallback(
    (targetId: string, emoji: string) => {
      const key = `${Date.now()}-${reactionSeqRef.current++}:${emoji}`;
      setTargetedReactions((prev) => ({
        ...prev,
        [targetId]: [...(prev[targetId] ?? []), key],
      }));
      setTimeout(() => {
        setTargetedReactions((prev) => {
          const remaining = (prev[targetId] ?? []).filter((r) => r !== key);
          const next = { ...prev };
          if (remaining.length) next[targetId] = remaining;
          else delete next[targetId];
          return next;
        });
      }, 2000);
    },
    [],
  );

  // Per-person reaction: animate over the target's avatar locally, then fan out
  // over PubNub carrying the target's user id so everyone sees it on that
  // avatar. Purely visual — never persisted.
  const sendReactionTo = useCallback(
    (targetId: string, emoji: string) => {
      spawnTargetedReaction(targetId, emoji);
      pushActivityRef.current?.(user?.id, emoji, targetId);
      void pubnubPublishSignal(spaceId, {
        type: "reaction",
        emoji,
        target: targetId,
      });
    },
    [spaceId, spawnTargetedReaction, user?.id],
  );

  // Push a line into the activity ticker. Names are resolved from the live
  // participant list, so someone who reacts and then leaves still reads by
  // name rather than as a raw uuid.
  const pushActivity = useCallback(
    (actorId: string | undefined, emoji: string, targetId: string) => {
      const nameFor = (id?: string) =>
        participantsRef.current.find((p) => p.user_id === id)?.user
          ?.display_name ?? "Someone";
      setActivity({
        key: `${Date.now()}-${reactionSeqRef.current++}`,
        actor: actorId && actorId === user?.id ? "You" : nameFor(actorId),
        emoji,
        target:
          targetId === user?.id ? "you" : nameFor(targetId),
      });
    },
    [user?.id],
  );

  // The PubNub subscription effect is deliberately not re-run when the ticker
  // helper changes identity — resubscribing on every render would drop and
  // rejoin presence. Read it through a ref instead.
  const pushActivityRef = useRef<typeof pushActivity | null>(null);
  useEffect(() => {
    pushActivityRef.current = pushActivity;
  }, [pushActivity]);

  // Clear the ticker a few seconds after the last event so a quiet room
  // doesn't keep showing a stale reaction indefinitely.
  useEffect(() => {
    if (!activity) return;
    const t = setTimeout(() => setActivity(null), 6000);
    return () => clearTimeout(t);
  }, [activity]);

  // Follow a member straight from their tile in the stage grid. Optimistic so
  // the "+" flips to a check on tap; rolled back with a toast if the request
  // fails, since a silently-stuck check would misreport the follow graph.
  const handleFollowFromTile = useCallback(
    (targetId: string) => {
      if (!user || !targetId || targetId === user.id) return;
      setFollowedIds((prev) => new Set(prev).add(targetId));
      void (async () => {
        try {
          const res = await authFetch("/api/social/follow", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target: targetId }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data?.error ?? "Could not follow");
          }
        } catch (e) {
          setFollowedIds((prev) => {
            const next = new Set(prev);
            next.delete(targetId);
            return next;
          });
          setShareToast(e instanceof Error ? e.message : "Could not follow");
          setTimeout(() => setShareToast(null), 2500);
        }
      })();
    },
    [user],
  );

  // ---- Agora audio lifecycle -----------------------------------------------
  // We (re)join whenever role changes. Audience → subscriber, speaker/host →
  // publisher. Any signed-in user joins as a SUBSCRIBER to LISTEN for free.
  // Clubhouse parity: publishing (speaking) is gated on the participant's
  // *role* (host/speaker, i.e. host-promoted), not on membership tier -- the
  // livekit-token route mints a publisher token for any promoted Spaces
  // participant regardless of tier (MM Faces video rooms still require
  // Superfan+ even once promoted; see that route's comments).
  useEffect(() => {
    // Cinema uses livekitVideoClient as its sole camera-capable Room. Never
    // connect the audio-only client to the same identity/room in parallel.
    if (isCinema || !isJoined || !user || !space?.agora_channel) return;

    const myPart = participants.find(
      (p) => p.user_id === user.id && !p.left_at,
    );
    if (!myPart) return;

    const role: "publisher" | "subscriber" =
      myPart.role === "host" || myPart.role === "speaker"
        ? "publisher"
        : "subscriber";

    let cancelled = false;
    (async () => {
      try {
        await agoraJoin({
          channel: space.agora_channel!,           spaceType: space.type,
          role,
          spaceId,
          onActiveSpeakersChange: (identities: string[]) => setSpeakingIds(new Set(identities)),
          onReconnecting: () => setReconnecting(true),         onReconnected: () => setReconnecting(false),
          onRoomEnded: () => {
            if (cancelled) return;
            setRoomEnded(true);
            setTimeout(() => router.push(exitHrefRef.current), 1800);
          },
          onError: (err) => {
            if (
              /NotAllowedError|Permission|permission denied/i.test(
                err.message ?? "",
              )
            ) {
              setMicDenied(true);
            }
            console.warn("agora error", err);
          },
        });
        if (cancelled) await agoraLeave();
      } catch (err) {
        if (
          /NotAllowedError|Permission|permission denied/i.test(
            (err as Error).message ?? "",
          )
        ) {
          setMicDenied(true);
        }
        console.warn("agora join failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // We intentionally re-run when the participant's role changes so we can
    // switch publisher/subscriber cleanly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isJoined,
    user?.id,
    space?.agora_channel,
    spaceId,
    canParticipate,
    isCinema,
    participants.find((p) => p.user_id === user?.id)?.role,
  ]);

  // React to role changes without a full rejoin when we're already connected.
  useEffect(() => {
    if (isCinema || !user || !isJoined) return;
    const myPart = participants.find(
      (p) => p.user_id === user.id && !p.left_at,
    );
    if (!myPart) return;
    const desired: "publisher" | "subscriber" =
      myPart.role === "host" || myPart.role === "speaker"
        ? "publisher"
        : "subscriber";
    agoraSetRole(desired).catch(() => {
      /* handled inside setRole */
    });
  }, [user, isJoined, participants, isCinema]);

  // Cinema's one RTC connection carries both audio and camera. Camera capture
  // stays off on join even for the host; LiveKit token/runtime grants only
  // include camera for a durable slot owner and the dock explicitly requests it.
  useEffect(() => {
    if (!isCinema || !isJoined || !user || !space) return;
    const myPart = participants.find((participant) => participant.user_id === user.id && !participant.left_at);
    if (!myPart) return;
    const role: "publisher" | "subscriber" =
      myPart.role === "host" || myPart.role === "speaker" ? "publisher" : "subscriber";
    let cancelled = false;

    // A role change or reconnect tears this room down and rebuilds it, but the
    // slot reservation and the token's camera grant both survive. Without this
    // the camera came back off while the seat stayed occupied and the control
    // still read "turn camera on". joinVideoRoom additionally requires the fresh
    // token to actually name camera, so a revoked slot cannot resume capture.
    const resumeCamera = cinemaCameraIntentRef.current;

    void joinVideoRoom({
      spaceId,
      role,
      roomMode: "cinema",
      autoEnableCamera: resumeCamera,
      autoEnableMicrophone: !myPart.is_muted && !myPart.host_muted,
      spaceType: space.type,
      onLocalVideo: (element) => {
        if (!cancelled) setCinemaVideoElements((current) => ({ ...current, [user.id]: element }));
      },
      onLocalVideoRemoved: () => {
        if (!cancelled) {
          // Covers both an explicit Camera Off and a host revoking this seat. In
          // either case a later reconnect must not resume capture.
          cinemaCameraIntentRef.current = false;
          setCinemaVideoElements((current) => {
            const next = { ...current };
            delete next[user.id];
            return next;
          });
        }
      },
      onRemoteVideo: ({ identity, element }) => {
        if (!cancelled) setCinemaVideoElements((current) => ({ ...current, [identity]: element }));
      },
      onRemoteVideoRemoved: (identity) => {
        if (!cancelled) {
          setCinemaVideoElements((current) => {
            const next = { ...current };
            delete next[identity];
            return next;
          });
        }
      },
      onActiveSpeakersChange: (identities) => {
        if (!cancelled) setSpeakingIds(new Set(identities));
      },
      onReconnecting: () => !cancelled && setReconnecting(true),
      onReconnected: () => !cancelled && setReconnecting(false),
      onRoomEnded: () => {
        if (cancelled) return;
        setCinemaRoomConnected(false);
        setRoomEnded(true);
        setTimeout(() => router.push(exitHrefRef.current), 1800);
      },
      onError: (err) => {
        if (/NotAllowedError|Permission|permission denied/i.test(err.message ?? "")) {
          setMicDenied(true);
        }
        console.warn("cinema LiveKit join error", err);
      },
    })
      .then(() => {
        if (!cancelled) setCinemaRoomConnected(isVideoRoomConnected());
      })
      .catch((err) => {
        if (!cancelled) setCinemaRoomConnected(false);
        if (/NotAllowedError|Permission|permission denied/i.test((err as Error).message ?? "")) {
          setMicDenied(true);
        }
      });

    return () => {
      cancelled = true;
      setCinemaRoomConnected(false);
      void leaveVideoRoom();
    };
    // A role transition intentionally reconnects this one room with a fresh,
    // server-authorized source grant. Reservation changes update permissions
    // runtime and do not create a second client.
  }, [
    isCinema,
    isJoined,
    user?.id,
    spaceId,
    space?.id,
    space?.type,
    participants.find((participant) => participant.user_id === user?.id)?.role,
    router,
  ]);

  // ---- PubNub presence lifecycle -------------------------------------------
  // Runs ALONGSIDE Supabase Realtime (which still drives the participant list
  // and is_speaking). PubNub exists purely so the SERVER gets a reliable
  // occupancy signal: when the last person leaves — or their tab crashes and
  // PubNub times them out — the presence webhook ends the room immediately.
  // The client never ends the room itself; it just joins/leaves presence and
  // shows a best-effort "here now" count.
  useEffect(() => {
    if (!isJoined || !user) return;
    let cancelled = false;
    (async () => {
      try {
        await pubnubJoin({
          spaceId,
          uuid: user.id,
          onPresence: (state) => {
            if (!cancelled) setLiveHere(state.occupancy);
          },
          onSystemSignal: (payload) => {
            // Server told us the room ended (e.g. it emptied, or the host left
            // with no eligible successor). Show the same calm banner as the
            // LiveKit-side ROOM_DELETED path (onRoomEnded above) before
            // bouncing out — important for pure-audience listeners who never
            // connected to LiveKit at all and so would never see that path.
            if (payload?.event === "space-ended") {
              setRoomEnded(true);
              setTimeout(() => router.push(exitHrefRef.current), 1800);
              return;
            }
            // Host was transferred server-side (the previous host left). Refresh
            // the space so host_id updates live — the new host's client starts
            // showing host controls, everyone else re-badges. The participant
            // realtime subscription already refreshed roles.
            if (payload?.event === "host-changed") {
              void supabase
                .from("spaces")
                .select(
                  `*, host:profiles(id, display_name, avatar_url, role, verified)`,
                )
                .eq("id", spaceId)
                .single()
                .then(({ data }) => {
                  if (data) setSpace(data as Space);
                });
            }
          },
          onSignal: (signal) => {
            if (cancelled) return;
            // A peer reacted — mirror their emoji. Targeted reactions animate
            // over that person's avatar; untargeted ones use the center burst.
            if (signal.type === "reaction" && signal.emoji) {
              if (signal.target) {
                spawnTargetedReaction(signal.target, signal.emoji);
                pushActivityRef.current?.(
                  signal.uuid,
                  signal.emoji,
                  signal.target,
                );
              } else {
                spawnReaction(signal.emoji);
              }
              return;
            }
            // A peer raised (or lowered) their hand. Supabase Realtime still
            // refreshes the authoritative participant list + raised-hand
            // badges; this just gives the host an instant heads-up toast.
            if (signal.type === "hand" && signal.raised) {
              const who =
                participantsRef.current.find(
                  (p) => p.user_id === signal.uuid,
                )?.user?.display_name ?? "Someone";
              setPeerHandToast(`✋ ${who} raised their hand`);
              setTimeout(() => setPeerHandToast(null), 2600);
            }
          },
          onError: (err) => console.warn("pubnub presence", err),
        });
      } catch (err) {
        // PubNub is additive — never block the room on a presence failure.
        console.warn("pubnub join failed", err);
      }
    })();
    return () => {
      cancelled = true;
      void pubnubLeave();
    };
  }, [isJoined, user?.id, spaceId, router, spawnReaction, spawnTargetedReaction]);

  // Heartbeat every 60s so `reap_idle_spaces` doesn't kill a live room.
  useEffect(() => {
    if (!isJoined) return;
    const ping = () =>
      authFetch(`/api/social/spaces/${spaceId}/heartbeat`, {
        method: "POST",
      }).catch(() => undefined);
    ping();
    heartbeatRef.current = setInterval(ping, 60_000);
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    };
  }, [isJoined, spaceId]);

  // pagehide/beforeunload → sendBeacon to end the space if we were the last host.
  useEffect(() => {
    if (!isJoined || typeof window === "undefined") return;
    const beacon = async () => {
      try {
        const headers = await authHeaders();
        const blob = new Blob([JSON.stringify({})], {
          type: "application/json",
        });
        // sendBeacon can't set headers directly, so fall back to keepalive fetch
        // when we need auth. We also try the beacon as a best-effort last resort.
        try {
          await fetch(`/api/social/spaces/${spaceId}/leave`, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({}),
            keepalive: true,
          });
        } catch {
          navigator.sendBeacon?.(
            `/api/social/spaces/${spaceId}/leave`,
            blob,
          );
        }
        if (isCinema) await leaveVideoRoom();
        else await agoraLeave();
        // Explicit PubNub leave → immediate `leave` presence event → webhook
        // fires now instead of waiting for the presence timeout.
        await pubnubLeave();
      } catch {
        /* best-effort */
      }
    };
    const onPageHide = () => {
      void beacon();
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onPageHide);
    };
  }, [isJoined, spaceId, isCinema]);

  // Component unmount → leave Agora + PubNub presence cleanly.
  useEffect(() => {
    return () => {
      void agoraLeave();
      void leaveVideoRoom();
      void pubnubLeave();
    };
  }, []);

  // Listener/audience autoplay unlock: any first tap/click anywhere on the
  // Space page counts as a user gesture, so unlock remote audio playback for
  // people who never press the mic button. One-time (removes itself after the
  // first event) and cleaned up on unmount. SSR-guarded.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const unlock = () => {
      void (isCinema ? ensureVideoAudio() : agoraEnsureAudio());
    };
    document.addEventListener("pointerdown", unlock, { once: true });
    document.addEventListener("click", unlock, { once: true });
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("click", unlock);
    };
  }, [isCinema]);

  // Drive is_speaking from the real-time client set (authoritative: every client
  // hears the whole room via ActiveSpeakersChanged), so the ring shows for
  // everyone who is speaking and clears when they stop — not stuck on a stale DB
  // value. StageGrid still gates on !is_muted, so muted users never show a ring.
  const withSpeaking = participants.map((p) => ({
    ...p,
    is_speaking: speakingIds.has(p.user_id),
  }));
  const speakers = withSpeaking.filter(
    (p) => p.role === "host" || p.role === "speaker"
  );
  const audience = withSpeaking.filter((p) => p.role === "audience");
  // Oldest request first — see src/lib/stageQueue.ts. The roster arrives in
  // join order, which is NOT request order.
  const raisedHands = sortStageQueue(
    participants.filter((p) => p.has_raised_hand && p.role === "audience")
  );

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-melori-purple border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !space) {
    return (
      <div className="flex-1 flex items-center justify-center flex-col gap-4">
        <p className="text-melori-muted">{error || "Space not found"}</p>
        <Link href={exitHref} className="text-melori-purple hover:underline">
          {roomExitLabel(space?.room_format)}
        </Link>
      </div>
    );
  }

  // Deliberate room end (host ended it, or the abandonment reaper closed it) —
  // a calm, non-alarming state, distinct from the `error` branch above which
  // is reserved for genuine failures (space not found / load error).
  if (roomEnded) {
    return (
      <div
        className="flex-1 flex items-center justify-center flex-col gap-4"
        data-testid="space-room-ended"
      >
        <p className="text-melori-text font-medium">{ROOM_ENDED_MESSAGE}</p>
        <Link href={exitHref} className="text-melori-purple hover:underline">
          {roomExitLabel(space?.room_format)}
        </Link>
      </div>
    );
  }

  const format = getRoomFormatConfig(space.room_format);
  const hostProfile = space.host;
  const hostId = hostProfile?.id ?? space.host_id;
  const followsHost = followedIds.has(hostId);
  const cinemaSlots = buildCinemaSlotAssignments(hostId, cinemaReservations).map((assignment) => ({
    slot: assignment.slot,
    participant:
      withSpeaking.find((participant) => participant.user_id === assignment.userId) ?? null,
    videoElement: assignment.userId ? cinemaVideoElements[assignment.userId] ?? null : null,
  }));
  const localCinemaCameraEnabled = Boolean(user && cinemaVideoElements[user.id]);

  const toggleCinemaCamera = async () => {
    if (!user || !isCinema || cinemaCameraBusy) return;
    // Claiming a slot before the RTC connection exists reserved a seat that
    // nothing could publish on, and the failure was invisible.
    if (!cinemaRoomConnected) {
      setShareToast("Still connecting to the room — try the camera again in a moment.");
      setTimeout(() => setShareToast(null), 2600);
      return;
    }
    setCinemaCameraBusy(true);
    try {
      if (localCinemaCameraEnabled) {
        // Clear the resume intent first: if the release below fails, a later
        // reconnect must not silently republish a camera the user turned off.
        cinemaCameraIntentRef.current = false;
        await setCinemaCameraEnabled(false);
        if (user.id !== hostId) {
          const res = await authFetch(`/api/social/spaces/${spaceId}/cinema-camera-slot`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data?.error ?? "Could not release camera slot");
          }
        }
      } else {
        const res = await authFetch(`/api/social/spaces/${spaceId}/cinema-camera-slot`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error ?? "No Cinema camera slot is available");
        }
        const data = await res.json();
        if (Array.isArray(data?.reservations)) {
          setCinemaReservations(data.reservations);
        }
        try {
          await setCinemaCameraEnabled(true);
          cinemaCameraIntentRef.current = true;
        } catch (error) {
          cinemaCameraIntentRef.current = false;
          let cleanupError: string | null = null;
          if (user.id !== hostId) {
            try {
              const release = await authFetch(`/api/social/spaces/${spaceId}/cinema-camera-slot`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
              });
              if (!release.ok) {
                const detail = await release.json().catch(() => ({}));
                cleanupError = detail?.error ?? "camera slot cleanup failed";
              }
            } catch {
              cleanupError = "camera slot cleanup failed";
            }
          }
          if (cleanupError) {
            throw new Error(
              `${error instanceof Error ? error.message : "Camera could not start"}; ${cleanupError}`,
            );
          }
          throw error;
        }
      }
      await refreshCinemaSlots();
    } catch (err) {
      setShareToast(err instanceof Error ? err.message : "Could not update camera");
      setTimeout(() => setShareToast(null), 2600);
      // Re-read durable state after a failure so the seat the UI shows always
      // matches what the server actually kept.
      await refreshCinemaSlots();
    } finally {
      setCinemaCameraBusy(false);
    }
  };

  return (
    // The room is presented as a sheet lifted off a black backdrop, per the
    // reference design: black gutter at the top, rounded shoulders, drag pill.
    // It is still a routed page — there is no minimise-to-background-audio
    // infrastructure yet — so the chevron navigates back exactly like the old
    // ArrowLeft did. When a persistent room player lands, that chevron is the
    // hook to change.
    // max-h is doing the real work here, not h-. `flex-1` resolves to
    // `flex: 1 1 0%`, and because this element's parent has no definite
    // height, flex-basis:0 + grow makes the item size to its CONTENT and the
    // `h-[calc(...)]` is ignored entirely — the room grew ~55px past the
    // viewport and pushed the control bar underneath the fixed MobileTabBar
    // (z-[70]). max-height still clamps a flex item, so it pins the column to
    // the real available height; the scroll region's `flex-1 min-h-0` then
    // absorbs the difference and the shrink-0 control bar stays on screen.
    <div className="flex-1 flex flex-col h-[calc(100dvh-4rem)] max-h-[calc(100dvh-4rem)] min-h-0 bg-black pt-2 animate-fade-in">
      <div className="flex-1 flex flex-col min-h-0 rounded-t-3xl bg-melori-void overflow-hidden">
        <div className="shrink-0 pt-2.5 flex justify-center" aria-hidden="true">
          <span className="h-1 w-9 rounded-full bg-white/25" />
        </div>

        <div className="px-4 md:px-6 pt-3 pb-1 flex items-center justify-between shrink-0">
          <Link
            href={exitHref}
            aria-label={roomExitLabel(space?.room_format)}
            className="-ml-1 p-2 rounded-full hover:bg-white/5 transition shrink-0"
          >
            <ChevronDown className="w-7 h-7" strokeWidth={2.5} />
          </Link>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={handleShare}
              className="w-11 h-11 flex items-center justify-center rounded-full bg-melori-elevated hover:bg-white/10 transition"
              title="Share"
              aria-label="Share this space"
            >
              <Share2 className="w-[18px] h-[18px]" />
            </button>
            {/* Leave moves out of the control bar and into the header as the
                reference's peace-sign pill. handleLeave is unchanged — this is
                the same "leave quietly" action, just relocated.

                Only for people actually in the room. A signed-out visitor was
                previously offered "leave" for a room they had never entered,
                which is where the flow started reading as broken. They get a
                plain back link to the same destination instead. */}
            {isJoined ? (
              <button
                type="button"
                data-testid="spaces-leave"
                onClick={handleLeave}
                className="h-11 pl-3.5 pr-4 flex items-center gap-1.5 rounded-full bg-melori-elevated hover:bg-red-500/15 transition"
              >
                <span aria-hidden="true" className="text-base leading-none">
                  ✌️
                </span>
                <span className="text-[17px] font-medium">leave</span>
              </button>
            ) : (
              <Link
                href={exitHref}
                data-testid="spaces-back"
                className="h-11 px-4 flex items-center rounded-full bg-melori-elevated hover:bg-white/10 transition text-[17px] font-medium"
              >
                back
              </Link>
            )}
          </div>
        </div>

        {/* Room meta: host chip, title, topic. The reference puts a community
            chip here with a join link; MM Spaces has no club/community model,
            so the closest true equivalent is the host — same shape, same
            inline follow affordance, backed by the follow API we already use
            on the tiles. */}
        <div className="px-4 md:px-6 pt-2 pb-4 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <img
              src={hostProfile?.avatar_url || "/favicon.png"}
              alt=""
              className="w-5 h-5 rounded object-cover shrink-0"
            />
            <span className="text-[15px] font-semibold uppercase tracking-wide truncate min-w-0">
              {hostProfile?.display_name ?? "Host"}
            </span>
            {!isHost && hostId && (
              <button
                type="button"
                onClick={() => handleFollowFromTile(hostId)}
                disabled={followsHost}
                className={`shrink-0 text-[15px] font-semibold ${
                  followsHost
                    ? "text-melori-muted"
                    : "text-[#1d9bf0] underline hover:brightness-110"
                }`}
              >
                {followsHost ? "following" : "follow"}
              </button>
            )}
            <div className="ml-auto relative shrink-0">
              <button
                type="button"
                onClick={() => setMoreOpen((v) => !v)}
                aria-expanded={moreOpen}
                className="p-1.5 -mr-1.5 rounded-full hover:bg-white/5 transition"
                title="More"
                aria-label="More room options"
              >
                <MoreHorizontal className="w-6 h-6" />
              </button>
              {moreOpen && (
            <div className="absolute right-0 top-full mt-2 w-52 rounded-xl border border-melori-border bg-melori-void shadow-xl overflow-hidden z-20">
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  void handleShare();
                }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-melori-text hover:bg-white/5 transition"
              >
                <Copy className="w-4 h-4" />
                Copy room link
              </button>
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  alert(
                    "Thanks — a moderator will review this space.",
                  );
                }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-melori-text hover:bg-white/5 transition"
              >
                <Flag className="w-4 h-4" />
                Report space
              </button>
              {isHost && (
                <div className="border-t border-melori-border">
                  <p className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-melori-muted">
                    Who can raise a hand
                  </p>
                  {(
                    [
                      { value: "everyone" as const, label: "Everyone" },
                      { value: "off" as const, label: "Off (host invites only)" },
                      { value: "followed" as const, label: "Followed (TODO)" },
                    ]
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={opt.value === "followed"}
                      onClick={() => {
                        setMoreOpen(false);
                        void setHandRaiseMode(opt.value);
                      }}
                      title={
                        opt.value === "followed"
                          ? "Not implemented yet -- no follow-graph check is wired up. See spacesStage.ts."
                          : undefined
                      }
                      className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-sm transition ${
                        opt.value === "followed"
                          ? "text-melori-muted/50 cursor-not-allowed"
                          : "text-melori-text hover:bg-white/5"
                      }`}
                    >
                      <span>{opt.label}</span>
                      {handRaiseMode === opt.value && (
                        <span className="text-melori-purple text-xs">✓</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {isHost && (
                <button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    void handleEndSpace();
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition border-t border-melori-border"
                >
                  <Trash2 className="w-4 h-4" />
                  End space
                </button>
              )}
            </div>
          )}
              {shareToast && (
                <span className="absolute right-0 -bottom-9 whitespace-nowrap rounded-full bg-melori-purple/90 text-white text-xs font-medium px-3 py-1.5 shadow-lg z-20">
                  {shareToast}
                </span>
              )}
            </div>
          </div>

          {/* Title gets room to wrap to two lines instead of being truncated
              next to a row of badges. break-words guards the long unbroken
              title the mobile-layout spec exercises. */}
          <h1 className="mt-1.5 text-[26px] leading-[1.15] font-bold break-words">
            {space.title}
          </h1>

          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {space.topic && (
              <p className="text-[15px] text-melori-muted break-words min-w-0">
                {space.topic}
              </p>
            )}
            <Badge variant={format.variant} className="shrink-0">
              {format.label}
            </Badge>
            {liveHere !== null && (
              <span
                className="shrink-0 inline-flex items-center gap-1 rounded-full bg-melori-purple/15 px-2 py-0.5 text-[11px] font-medium text-melori-purple"
                title="Live presence (PubNub)"
                data-testid="badge-here-now"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-melori-purple animate-pulse" />
                {liveHere} here
              </span>
            )}
          </div>
        </div>

      {/* relative anchors the floating comment overlay to the grid area, so
          comments drift up over the tiles instead of over the header. */}
      <div className="relative flex-1 min-h-0 flex flex-col">
      {isJoined && !isCinema && (
        <RoomCommentOverlay comments={roomComments} />
      )}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-8 pb-4">
        <div className="max-w-2xl mx-auto">
          {space.status === "scheduled" && (
            <div className="mb-6 rounded-2xl border border-melori-purple/30 bg-melori-purple/10 p-5 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-melori-text">
                  Scheduled to start
                </p>
                <p className="text-xs text-melori-muted mt-1">
                  {space.scheduled_at
                    ? new Date(space.scheduled_at).toLocaleString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    : "Time not set"}
                </p>
              </div>
              {isHost && (
                <button
                  type="button"
                  onClick={handleGoLive}
                  className="btn-primary px-5 py-2.5 rounded-full font-semibold text-sm"
                >
                  Go Live Now
                </button>
              )}
            </div>
          )}
          {/* The room renders for everyone who opens it — signed in or not,
              on the roster or not. What used to sit here was a full-screen
              interstitial: a speaker icon, the title repeated a second time
              (the header already shows it), "N people listening", and a Join
              Space button. It asked for a commitment while hiding the only
              thing that would inform it — who is actually in the room — and it
              did that on top of a header already offering Share and Leave for
              a room you had not entered.

              Now: you see the faces, you hear the room, and the only thing
              still gated is speaking. See the auto-join effect above. */}

          {/* Join genuinely failed (RLS, offline, banned). Say so and offer a
              retry rather than looping the auto-join effect into the same
              error, and rather than showing a room the user is not in as
              though they were. */}
          {user && joinFailed && (
            <div className="max-w-2xl mx-auto px-4 md:px-6 pb-3">
              <button
                onClick={() => {
                  autoJoinedRef.current = false;
                  setJoinFailed(false);
                  void handleJoin();
                }}
                data-testid="spaces-join-retry"
                className="w-full rounded-full border border-melori-border bg-melori-elevated py-3 text-[15px] font-bold text-melori-text active:opacity-80"
              >
                Couldn&apos;t join — tap to retry
              </button>
            </div>
          )}

            <>
              {/* MM Cinema: the shared screen sits above the stage, so the
                  room reads screen -> who's on mic -> audience -> chat.

                  Rendered here rather than in a forked Cinema room page on
                  purpose. This page already owns joining, LiveKit audio, roles,
                  the raise-hand queue, moderation, bans, and teardown; a
                  separate page would have to duplicate all of it and would
                  drift out of sync with every future room fix. Cinema is a
                  format, so it is an additive layer, not a second room. */}
              {isCinema && (
                <CinemaScreen
                  spaceId={spaceId}
                  isHost={isHost}
                  overlay={<CinemaChat comments={roomComments} />}
                />
              )}

              <div className={isCinema ? "mb-0" : "mb-8"}>
                {reconnecting && (<div className="mb-3 px-4 py-2 rounded-lg bg-yellow-500/15 border border-yellow-500/40 text-yellow-200 text-sm text-center">Reconnecting to audio…</div>)}
                {/* Audio rooms render everyone in ONE continuous grid, speakers
                    first, the way the reference room does — role is read off
                    the tile's own badges rather than from a section heading.
                    Cinema keeps its split stage/audience layout: its seats are
                    a fixed-capacity front row with their own HOST/GUEST labels,
                    so merging them into the crowd would lose that meaning. */}
                {isCinema ? (
                  <CinemaStage
                    slots={cinemaSlots}
                    onReactToParticipant={setReactTarget}
                    reactionBursts={targetedReactions}
                  />
                ) : (
                  <StageGrid
                    participants={[...speakers, ...audience]}
                    onReactToParticipant={setReactTarget}
                    onSelectParticipant={isHost ? setModTarget : setReactTarget}
                    reactionBursts={targetedReactions}
                    viewerId={user?.id}
                    followingIds={followedIds}
                    onFollow={handleFollowFromTile}
                  />
                )}

                {isHost && speakers.filter((s) => s.user_id !== user?.id).length > 0 && (
                  <div className="mt-4 rounded-xl border border-melori-border bg-melori-elevated/40 divide-y divide-melori-border/60">
                    {speakers
                      .filter((s) => s.user_id !== user?.id)
                      .map((s) => (
                        <div
                          key={s.id}
                          className="flex items-center gap-3 px-3 py-2"
                        >
                          <img
                            src={s.user?.avatar_url || "/favicon.png"}
                            className="w-8 h-8 rounded-full object-cover"
                            alt=""
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {s.user?.display_name}
                            </p>
                            <p className="text-[11px] text-melori-muted">
                              {s.role === "host" ? "Host" : "Speaker"}
                              {(s as any).host_muted ? " · muted by host" : ""}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              s.user_id &&
                              hostMute(s.user_id, !(s as any).host_muted)
                            }
                            className="p-2 rounded-full hover:bg-white/5 text-melori-muted hover:text-melori-text transition"
                            title={
                              (s as any).host_muted
                                ? "Unmute speaker"
                                : "Mute speaker"
                            }
                          >
                            {(s as any).host_muted ? (
                              <Mic className="w-4 h-4" />
                            ) : (
                              <VolumeX className="w-4 h-4" />
                            )}
                          </button>
                          {s.role !== "host" && s.user_id && (
                            <button
                              type="button"
                              onClick={() => hostDemote(s.user_id!)}
                              className="p-2 rounded-full hover:bg-white/5 text-melori-muted hover:text-melori-text transition"
                              title="Move to audience"
                            >
                              <Hand className="w-4 h-4" />
                            </button>
                          )}
                          {s.role !== "host" && s.user_id && (
                            <button
                              type="button"
                              onClick={() => hostRemove(s.user_id!)}
                              className="p-2 rounded-full hover:bg-red-500/10 text-melori-muted hover:text-red-400 transition"
                              title="Remove from space"
                            >
                              <UserMinus className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}
                  </div>
                )}
              </div>

              {micDenied && (
                <div className="mb-6 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-200">
                  Microphone access was blocked. Enable it in your browser
                  settings to speak in this space.
                </div>
              )}

              {raisedHands.length > 0 && (
                <div className="mb-8">
                  <h3 className="text-xs font-semibold text-melori-muted uppercase tracking-wider mb-4">
                    Raised Hands ({raisedHands.length})
                  </h3>
                  <div className="flex gap-4 overflow-x-auto pb-2 hide-scrollbar">
                    {raisedHands.map((p) => (
                      <div
                        key={p.id}
                        className="flex flex-col items-center gap-2 min-w-[64px]"
                      >
                        <div className="relative">
                          <img
                            src={p.user?.avatar_url || "/favicon.png"}
                            className="w-14 h-14 rounded-full border-2 border-melori-warning/50 opacity-70 object-cover"
                            alt={p.user?.display_name}
                          />
                          <div className="absolute -top-1 -right-1 w-5 h-5 bg-melori-warning rounded-full flex items-center justify-center">
                            <Hand className="w-3 h-3 text-melori-void" />
                          </div>
                        </div>
                        <span className="text-xs text-melori-muted truncate w-16 text-center">
                          {p.user?.display_name}
                        </span>
                        {isHost && p.user_id && (
                          <button
                            type="button"
                            onClick={() =>
                              p.user_id && invitePromote(p.user_id)
                            }
                            className="text-[10px] bg-melori-purple/20 text-melori-purple px-2 py-1 rounded-full hover:bg-melori-purple/30 transition"
                          >
                            Invite
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Audio audience is already folded into the single grid above;
                  only Cinema still renders a separate watching row. */}
              {isCinema && (
                <div className="min-h-0">
                  <CinemaAudience
                    audience={audience}
                    onReactToParticipant={setReactTarget}
                    reactionBursts={targetedReactions}
                  />
                </div>
              )}
            </>

        </div>
      </div>
      </div>
      </div>

      {/* Floating reaction bursts */}
      {reactions.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 safe-bottom-offset-32 z-30 flex justify-center gap-3">
          {reactions.map((r) => {
            // r has the form "<ts>-<seq>:<emoji>". Split on the first ':'.
            const emoji = r.slice(r.indexOf(":") + 1) || "❤️";
            return (
              <span
                key={r}
                className="text-3xl animate-bounce"
                style={{ animationDuration: "1.6s" }}
              >
                {emoji}
              </span>
            );
          })}
        </div>
      )}

      {/* Peer raised-hand heads-up (instant via PubNub signal) */}
      {peerHandToast && (
        <div className="pointer-events-none fixed inset-x-0 safe-bottom-offset-44 z-30 flex justify-center">
          <span
            className="rounded-full bg-melori-warning/90 text-melori-void text-xs font-semibold px-4 py-2 shadow-lg"
            data-testid="toast-peer-hand"
          >
            {peerHandToast}
          </span>
        </div>
      )}

      {/* Per-person reaction picker: tap an avatar to react to that person. */}
      {/* Host controls for one participant. Reached by TAPPING their tile;
          long-press reacts instead. These are the same runHostAction calls the
          host list below the grid uses — this is a second entry point, not a
          second implementation, so behaviour cannot drift between them. */}
      {modTarget && isHost && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setModTarget(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`Manage ${modTarget.user?.display_name ?? "participant"}`}
        >
          <div
            className="w-full max-w-md rounded-t-3xl bg-melori-elevated p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center pb-3" aria-hidden="true">
              <span className="h-1 w-9 rounded-full bg-white/25" />
            </div>
            <div className="flex items-center gap-3 pb-4">
              <img
                src={modTarget.user?.avatar_url || "/favicon.png"}
                alt=""
                className="w-11 h-11 rounded-full object-cover"
              />
              <p className="font-semibold truncate">
                {modTarget.user?.display_name ?? "Participant"}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              {(() => {
                const targetId = modTarget.user?.id ?? modTarget.user_id;
                const onStage =
                  modTarget.role === "host" || modTarget.role === "speaker";
                const close = () => setModTarget(null);
                const Item = ({
                  label,
                  onClick,
                  danger,
                }: {
                  label: string;
                  onClick: () => void;
                  danger?: boolean;
                }) => (
                  <button
                    type="button"
                    onClick={() => {
                      onClick();
                      close();
                    }}
                    className={`w-full text-left px-3 py-3 rounded-xl text-[15px] font-medium transition hover:bg-white/5 ${
                      danger ? "text-red-400" : ""
                    }`}
                  >
                    {label}
                  </button>
                );
                return (
                  <>
                    <Item
                      label="Send a reaction"
                      onClick={() => setReactTarget(modTarget)}
                    />
                    {modTarget.role !== "host" &&
                      (onStage ? (
                        <>
                          <Item
                            label={
                              modTarget.host_muted ? "Unmute speaker" : "Mute speaker"
                            }
                            onClick={() =>
                              void hostMute(targetId, !modTarget.host_muted)
                            }
                          />
                          <Item
                            label="Move to audience"
                            onClick={() => void hostDemote(targetId)}
                          />
                        </>
                      ) : (
                        <Item
                          label="Invite to speak"
                          onClick={() => void invitePromote(targetId)}
                        />
                      ))}
                    {modTarget.role !== "host" && (
                      <Item
                        danger
                        label="Remove from space"
                        onClick={() => void hostRemove(targetId)}
                      />
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {reactTarget && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center"
          onClick={() => setReactTarget(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`React to ${reactTarget.user?.display_name ?? "participant"}`}
        >
          <div
            className="safe-area-pad-extra-bottom-5 w-full max-w-sm rounded-t-2xl border border-melori-border bg-melori-void p-5 shadow-xl sm:rounded-2xl animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <img
                src={reactTarget.user?.avatar_url || "/favicon.png"}
                className="w-10 h-10 rounded-full object-cover"
                alt=""
              />
              <p className="text-sm font-semibold text-melori-text truncate">
                React to {reactTarget.user?.display_name ?? "this person"}
              </p>
            </div>
            <div className="flex items-center justify-between gap-1">
              {["❤️", "🔥", "👏", "🎵", "😂", "🙌"].map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    const targetId =
                      reactTarget.user?.id ?? reactTarget.user_id;
                    if (targetId) sendReactionTo(targetId, emoji);
                    setReactTarget(null);
                  }}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center text-2xl rounded-full hover:bg-white/5 hover:scale-125 transition-transform"
                  aria-label={`React ${emoji} to ${reactTarget.user?.display_name ?? "participant"}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* pb clears MobileTabBar, which is `md:hidden fixed bottom-0 z-[70]`
          and h-14 (3.5rem) + env(safe-area-inset-bottom). Without this the tab
          bar renders directly on top of these controls on iPhone and they look
          "cut off". Same pattern as ConnectProfileEditor and the MobileTabBar
          sheet. md:pb-6 restores normal desktop padding, where the bar is
          hidden. */}
      {/* Signed out: the room above renders read-only — faces, title, live
          comments. The dock slot carries the single call to action instead of
          a composer nobody can use, so the sign-in ask sits exactly where the
          thing it unlocks will appear, and the participant grid is never
          pushed down the screen to make room for it. */}
      {!user && (
        <div className="shrink-0 rounded-t-3xl bg-melori-elevated pt-2.5 pb-[calc(1rem+3.5rem+env(safe-area-inset-bottom))] md:pb-6">
          <div className="flex justify-center" aria-hidden="true">
            <span className="h-1 w-9 rounded-full bg-white/25" />
          </div>
          <div className="max-w-2xl mx-auto px-4 md:px-6 pt-3">
            <button
              onClick={handleJoin}
              data-testid="spaces-signin-cta"
              className="w-full rounded-full bg-[#1d9bf0] py-3.5 text-[16px] font-bold text-white active:opacity-80"
            >
              Sign in to join the conversation
            </button>
          </div>
        </div>
      )}

      {isJoined && (
        <div className="shrink-0 rounded-t-3xl bg-melori-elevated pt-2.5 pb-[calc(1rem+3.5rem+env(safe-area-inset-bottom))] md:pb-6">
          <div className="flex justify-center" aria-hidden="true">
            <span className="h-1 w-9 rounded-full bg-white/25" />
          </div>

          {/* Activity ticker — the newest targeted reaction, as one line. */}
          {activity && (
            <div
              key={activity.key}
              data-testid="spaces-activity"
              className="max-w-2xl mx-auto px-4 md:px-6 pt-2.5 flex items-center gap-2 text-[15px] animate-fade-in"
            >
              <span className="font-semibold truncate max-w-[35%]">
                {activity.actor}
              </span>
              <span className="text-melori-muted shrink-0">reacted</span>
              <span className="text-lg leading-none shrink-0">
                {activity.emoji}
              </span>
              <span className="text-melori-muted shrink-0">to</span>
              <span className="font-semibold truncate">{activity.target}</span>
            </div>
          )}

          {/* Control bar: a solid composer row. The comment field is the
             widest element because commenting is the thing everyone in the
             room can do; speaking is gated on the host. Mic / ask-to-speak
             therefore sit as a compact icon to the LEFT of the field rather
             than taking the primary slot. "End space" is not duplicated here
             — it lives in the header's overflow menu. */}
          <div
            data-testid={isCinema ? "cinema-control-dock" : "spaces-control-bar"}
            className="max-w-2xl mx-auto px-4 md:px-6 pt-3 flex items-center gap-2 min-h-[64px]"
          >
            {/* Mic button — primary control once you're on stage. Only participants the
               host has put on stage (canSpeakNow: role 'host'/'speaker') see
               it; listeners get the reactions control only. Clubhouse parity:
               this is no longer gated on Superfan membership, only on the
               host's own promotion decision.
                 - Tap: toggle mute (classic behavior).
                 - Press & hold: push-to-talk. Unmutes for as long as you're
                   holding it, then restores the previous mute state on
                   release. Works with mouse and touch. */}
            {canSpeakNow && (
              <button
                type="button"
                onClick={() => {
                  // Pointer/touch gestures resolve the tap in endPTTGesture; a
                  // mouse release fires a synthetic click right after, which we
                  // swallow here. Only a keyboard activation (Enter/Space) with
                  // no preceding press should fall through to toggleMute.
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false;
                    return;
                  }
                  void toggleMute();
                }}
                onMouseDown={startPTT}
                onMouseUp={endPTTGesture}
                onMouseLeave={endPTTGesture}
                onTouchStart={(e) => {
                  e.preventDefault();
                  startPTT();
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  endPTTGesture();
                }}
                onTouchCancel={() => endPTT()}
                aria-label={
                  isMuted
                    ? "Unmute (tap) or hold to talk"
                    : "Mute (tap) or hold to talk"
                }
                title="Tap to toggle mute · Press and hold to talk"
                className={`w-12 h-12 shrink-0 flex items-center justify-center rounded-full transition select-none touch-none ${
                  isMuted
                    ? "bg-red-500/20 text-red-400"
                    : "bg-melori-purple text-white"
                }`}
              >
                {isMuted ? (
                  <MicOff className="w-6 h-6" />
                ) : (
                  <Mic className="w-6 h-6" />
                )}
              </button>
            )}

            {isCinema && canSpeakNow && (
              <button
                type="button"
                onClick={() => void toggleCinemaCamera()}
                data-testid="cinema-camera-toggle"
                disabled={!cinemaRoomConnected || cinemaCameraBusy}
                aria-label={localCinemaCameraEnabled ? "Turn camera off" : "Turn camera on"}
                aria-busy={cinemaCameraBusy}
                title={
                  !cinemaRoomConnected
                    ? "Connecting to the room…"
                    : localCinemaCameraEnabled
                      ? "Turn camera off and release your guest slot"
                      : "Turn camera on"
                }
                className={`w-12 h-12 shrink-0 flex items-center justify-center rounded-full transition disabled:opacity-50 ${
                  localCinemaCameraEnabled
                    ? "bg-cinema-gold text-black"
                    : "bg-melori-void/70 text-melori-text hover:bg-melori-void"
                }`}
              >
                {localCinemaCameraEnabled ? (
                  <Video className="w-5 h-5" />
                ) : (
                  <VideoOff className="w-5 h-5" />
                )}
              </button>
            )}

            {/* Ask to speak. Hidden for the host, for anyone already on stage
               (they don't need to ask), and whenever the host has set
               hand_raise_mode to "off" (or the not-yet-enforced "followed" --
               see spacesStage.ts). The label is carried by aria + title rather
               than visible text so the comment field keeps the width. */}
            {!isHost && !canSpeakNow && canRaiseHandNow && (
              <button
                type="button"
                onClick={toggleHand}
                data-testid="spaces-ask-to-speak"
                title={hasRaisedHand ? "Lower hand" : "Ask to speak"}
                aria-label={hasRaisedHand ? "Lower hand" : "Ask to speak"}
                aria-pressed={hasRaisedHand}
                className={`w-12 h-12 shrink-0 flex items-center justify-center rounded-full transition ${
                  hasRaisedHand
                    ? "bg-melori-warning/20 text-melori-warning"
                    : "bg-[#1d9bf0] text-white hover:brightness-110"
                }`}
              >
                <Hand className="w-6 h-6" />
              </button>
            )}

            {/* Listeners in a hands-off room get an honest disabled state
               rather than a missing control, so the bar keeps its shape. */}
            {!isHost && !canSpeakNow && !canRaiseHandNow && (
              <span
                title="The host has turned off requests to speak"
                className="w-12 h-12 shrink-0 flex items-center justify-center rounded-full bg-white/5 text-melori-muted"
              >
                <Volume2 className="w-6 h-6" />
              </span>
            )}

            {/* The one stable composer for every room format. Cinema's feed is
               display-only over the screen, so it never owns another sticky
               input in the scrollable content. */}
            <form
              onSubmit={submitComment}
              data-testid={isCinema ? "cinema-composer" : "spaces-composer"}
              className="flex-1 min-w-0 flex items-center gap-1.5 h-12 pl-4 pr-1.5 rounded-full bg-melori-void/70 focus-within:bg-melori-void transition"
            >
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="say something"
                  aria-label="Write a comment"
                  enterKeyHint="send"
                  className="flex-1 min-w-0 bg-transparent text-[15px] placeholder:text-melori-muted focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!draft.trim() || sendingComment}
                  aria-label="Send comment"
                  className="w-9 h-9 shrink-0 flex items-center justify-center rounded-full bg-[#1d9bf0] text-white transition disabled:opacity-30 disabled:cursor-not-allowed hover:brightness-110"
                >
                  <Send className="w-[18px] h-[18px]" />
                </button>
            </form>

            {/* Right cluster: room-wide reactions. Reactions aimed at ONE
               person are a long-press on their tile — see StageGrid. */}
            <div className="ml-auto flex items-center gap-2">

              {/* Quick reactions (global, center-screen burst). Emoji picker on click. */}
              <div className="relative">
                <details className="group">
                  <summary className="list-none cursor-pointer w-12 h-12 rounded-full bg-melori-void/60 text-melori-text hover:bg-melori-void transition flex items-center justify-center">
                    <Smile className="w-6 h-6" />
                  </summary>
                  <div className="absolute right-0 bottom-full mb-2 flex gap-1 rounded-full border border-melori-border bg-melori-void px-2 py-2 shadow-xl">
                    {["❤️", "🔥", "👏", "🎵", "😂", "🙌"].map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          sendReaction(emoji);
                          (
                            e.currentTarget.closest("details") as
                              | HTMLDetailsElement
                              | null
                          )?.removeAttribute("open");
                        }}
                        className="text-xl px-1 hover:scale-125 transition-transform"
                        aria-label={`React ${emoji}`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </details>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
