"use client";

// MM Spaces live room: /social/spaces/[spaceId].
//
// Spaces' own screen. Until 2 Oct 2026 one RoomScreen served both Spaces and
// Cinema; Karl asked for the two to share no room code, so Cinema now has its
// own screen and this file only knows about audio Spaces (release_party,
// discussion, dj_set). The route bounces Cinema and Concert rooms to their own
// URLs before this renders.
//
// What the two products still share is plumbing: the `spaces` /
// `space_participants` / `space_comments` tables, the moderation and ban
// routes, LiveKit and PubNub.
//
// Layout, top to bottom on a phone: one header line, the stage (host + up to
// SPACES_SPEAKER_LIMIT speakers with live speaking rings), the listeners, the
// room chat filling the rest, and a dock with Leave quietly, the hands queue,
// the mic or raise-hand, and reactions.

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { useCanRequestStage } from "@/components/social/UpgradePrompt";
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
  joinPresence as pubnubJoin,
  leavePresence as pubnubLeave,
  publishSignal as pubnubPublishSignal,
} from "@/lib/pubnubClient";
import { ROOM_ENDED_MESSAGE } from "@/lib/roomDisconnect";
import { Space, SpaceParticipant, getRoomFormatConfig } from "@/types/social";
import { sortStageQueue } from "@/lib/stageQueue";
import { useSpaceChat, type SpaceChatMessage } from "@/components/social/spaces/useSpaceChat";
import SpacesStage from "@/components/social/spaces/SpacesStage";
import SpacesListeners from "@/components/social/spaces/SpacesListeners";
import SpacesChat from "@/components/social/spaces/SpacesChat";
import { SPACES_SPEAKER_LIMIT, buildSpacesStage } from "@/lib/spacesRoom";
import { spacesAvatarColor, spacesInitials } from "@/lib/spacesAvatar";
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
  Users,
} from "lucide-react";
import Link from "next/link";

const SPACES_HOME = "/social/spaces";

export default function SpacesRoomScreen({ spaceId }: { spaceId: string }) {
  const router = useRouter();
  const { user } = useAuth();
  // Clubhouse parity: raising a hand is gated on being signed in ONLY (no
  // Superfan requirement) — see src/lib/spacesStage.ts. Speaking itself is
  // gated separately below on the caller's own participant role, which only
  // changes once the host promotes them.
  const canRequestStage = useCanRequestStage();

  const [space, setSpace] = useState<Space | null>(null);
  // Every exit from the room leads back to the Spaces list. A ref so the
  // long-lived audio and presence effects can read it without re-subscribing.
  const exitHref = SPACES_HOME;
  const exitHrefRef = useRef(exitHref);

  const [participants, setParticipants] = useState<SpaceParticipant[]>([]);
  // Identity -> 0..1 microphone level, sampled from LiveKit (livekitClient).
  // Drives the speaking rings on the stage.
  const [audioLevels, setAudioLevels] = useState<Record<string, number>>({});
  // The room's bottom sheets. One state so two can never be open at once, all
  // sharing one focus-contained dialog below:
  //   hands     — raised-hands queue (host / moderators)
  //   leave     — host's choice: hand the room off, or end it for everyone
  //   listeners — everyone listening, searchable by eye, tap for their sheet
  //   report    — report the room or one chat message
  const [roomSheet, setRoomSheet] = useState<null | "hands" | "leave" | "listeners" | "report">(
    null,
  );
  const sheetReturnFocusRef = useRef<HTMLElement | null>(null);
  const sheetDialogRef = useRef<HTMLElement>(null);
  const openSheet = useCallback((sheet: "hands" | "leave" | "listeners" | "report") => {
    sheetReturnFocusRef.current =
      typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
    setRoomSheet(sheet);
  }, []);
  const closeSheet = useCallback(() => setRoomSheet(null), []);
  // This must live with the rest of the component hooks, before the loading,
  // error, and ended-room returns below. A room initially loads without a
  // space, then renders the room controls after the query resolves.
  useEffect(() => {
    if (!roomSheet) return;
    const dialog = sheetDialogRef.current;
    if (!dialog) return;

    const focusableSelector = [
      'button:not([disabled])',
      'select:not([disabled])',
      'input:not([disabled])',
      'textarea:not([disabled])',
      'a[href]',
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");
    const getFocusable = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => !element.hasAttribute("hidden"),
      );
    const focusInitialControl = () =>
      dialog.querySelector<HTMLElement>("[data-sheet-initial-focus]")?.focus();
    const focusFrame = window.requestAnimationFrame(focusInitialControl);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSheet();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === first || !dialog.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !dialog.contains(activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      sheetReturnFocusRef.current?.focus?.();
    };
  }, [roomSheet, closeSheet]);
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
  const roomPath = `${SPACES_HOME}/${spaceId}`;
  const [isMuted, setIsMuted] = useState(true);
  const [hasRaisedHand, setHasRaisedHand] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [shareToast, setShareToast] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [reactions, setReactions] = useState<string[]>([]);
  // Targeted reaction bursts, keyed by the target participant's user id. Each
  // value is a list of unique burst keys ("<ts>-<seq>:<emoji>"). Rendered over
  // that person's circle on the stage, separate from the center-screen bursts.
  const [targetedReactions, setTargetedReactions] = useState<
    Record<string, string[]>
  >({});
  // The person whose sheet is open: follow, react, and (for the host or a
  // moderator) the stage controls. One sheet for every tap on a person; it
  // replaced separate "react" and "manage" sheets that did half each.
  const [personTarget, setPersonTarget] = useState<SpaceParticipant | null>(null);
  // Who in this room the viewer already follows. Loaded in one query when the
  // roster changes (follows are publicly readable), so "Follow" only shows for
  // people you don't follow yet. It used to be seeded empty, which showed a
  // follow "+" on people you already followed.
  const [followedIds, setFollowedIds] = useState<Set<string>>(new Set());
  // Does the host follow the viewer? Only matters in "followed" hand-raise
  // mode; the raise-hand route re-checks it server-side.
  const [hostFollowsMe, setHostFollowsMe] = useState(false);
  const [draft, setDraft] = useState("");
  // What the open report sheet is about: the room, or one chat message.
  const [reportTarget, setReportTarget] = useState<
    { kind: "space" } | { kind: "chat"; message: SpaceChatMessage } | null
  >(null);
  const [reportSending, setReportSending] = useState(false);
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
      const isHostJoining = user.id === space?.host_id;
      // Read through the ref, not the closed-over array. The closure can be a
      // tick behind the roster, and "I can't see your row" used to be
      // indistinguishable from "you don't have one" — which quietly demoted a
      // reconnecting speaker to audience mid-sentence.
      const existing = participantsRef.current.find((p) => p.user_id === user.id);
      const keepsStage =
        existing?.role === "speaker" || existing?.role === "host";
      // Clubhouse model: everyone but the host walks in as a listener and the
      // host brings people up. Membership tier used to auto-seat artists and
      // superfans as speakers, which bypassed the SPACES_SPEAKER_LIMIT cap the
      // participants route enforces (and put strangers on the mic). Someone
      // already on stage keeps their seat when they reconnect.
      const joinRole = isHostJoining ? "host" : keepsStage ? existing!.role : "audience";
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
      void agoraEnsureAudio();
      // Best-effort participant count bump. Doesn't gate the UX.
      void supabase
        .rpc("increment_space_participants", { space_id: spaceId })
        .then(({ error: rpcErr }) => {
          if (rpcErr) console.warn("increment_space_participants failed", rpcErr);
        });
    } finally {
      joiningRef.current = false;
    }
  }, [user, spaceId, router, space, roomPath]);

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
      await agoraLeave();
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
  }, [user, spaceId, router]);

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
    canRequestStage &&
    handRaiseAllowed(handRaiseMode, { signedIn: !!user, followedByHost: hostFollowsMe });

  // Central helper: change mute state locally + on LiveKit + in the DB.
  // The audio session is the source of truth: we drive the mic first, then
  // mirror local state, then persist. A Supabase/RLS hiccup on the DB write
  // must never leave the mic logically stuck.
  const applyMute = useCallback(
    async (nextMuted: boolean) => {
      if (!user) return;
      try {
        await agoraSetMuted(nextMuted);
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
    [user, spaceId],
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
    void agoraEnsureAudio();
    await applyMute(!isMuted);
  }, [user, isMuted, canSpeakNow, applyMute]);

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
    void agoraEnsureAudio();
    if (pttHeldRef.current) return;
    pttHeldRef.current = true;
    pttStartedAtRef.current = Date.now();
    pttPrevMutedRef.current = isMuted;
    // Optimistically go live while the button is held. For a quick tap we
    // reconcile this into a normal toggle in endPTT.
    if (isMuted) void applyMute(false);
  }, [user, canSpeakNow, isMuted, applyMute]);

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
  // Host plus badged moderators run the stage. The participants route grants
  // moderators the same promote / demote / mute / remove; only the host can
  // ban or hand out the moderator badge, and the route enforces that too.
  const myRow = participants.find((p) => p.user_id === user?.id && !p.left_at) ?? null;
  const canModerate = isHost || myRow?.badge === "mod" || myRow?.badge === "cohost";
  const {
    comments: chatMessages,
    sendComment,
    deleteComment,
    sending: sendingComment,
  } = useSpaceChat(spaceId);

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

  // Host or moderator: bring a listener up to speak. The route answers 409
  // when the stage already holds SPACES_SPEAKER_LIMIT speakers.
  const invitePromote = useCallback(
    async (participantUserId: string) => {
      if (!canModerate) return;
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
          setTimeout(() => setShareToast(null), 2600);
        }
      } catch {
        setShareToast("Network error");
        setTimeout(() => setShareToast(null), 2200);
      }
    },
    [canModerate, spaceId],
  );

  // Run one stage-moderation call for the host or a moderator and say plainly
  // whether it worked. Host-only actions (ban, moderator badge) are refused by
  // the route for anyone else, and that refusal shows as the toast.
  const runHostAction = useCallback(
    async (
      participantUserId: string,
      body: Record<string, unknown>,
      successToast: string,
    ) => {
      if (!canModerate) return;
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
    [canModerate, spaceId],
  );

  // Host or moderator: force-mute a speaker (they can still be present, just muted).
  const hostMute = useCallback(
    (participantUserId: string, muted: boolean) =>
      runHostAction(
        participantUserId,
        { host_muted: muted },
        muted ? "Speaker muted" : "Speaker unmuted",
      ),
    [runHostAction],
  );

  // Host or moderator: move a speaker back to the audience.
  const hostDemote = useCallback(
    (participantUserId: string) =>
      runHostAction(
        participantUserId,
        { role: "audience" },
        "Moved to audience",
      ),
    [runHostAction],
  );

  // Host or moderator: remove someone from the room (they may come back).
  const hostRemove = useCallback(
    (participantUserId: string) =>
      runHostAction(
        participantUserId,
        { remove: true },
        "Removed from space",
      ),
    [runHostAction],
  );

  // Host-only: remove someone AND keep them out. Records a room-scoped ban
  // (037_space_bans) that the token route and the chat route both refuse.
  // The route has supported { ban: true } all along; this is its first UI.
  const hostBan = useCallback(
    (participantUserId: string) =>
      runHostAction(participantUserId, { ban: true }, "Removed and banned"),
    [runHostAction],
  );

  // Host-only: grant or revoke the moderator badge. The
  // route restricts this to the host regardless of who calls it, and mirrors
  // the change into LiveKit stage permissions server-side — this is just the
  // UI trigger. Works whether the target is currently on stage or in the
  // audience; moderators help run the room, they don't have to be speaking.
  const hostSetBadge = useCallback(
    (participantUserId: string, badge: "mod" | null) =>
      runHostAction(
        participantUserId,
        { badge },
        badge === "mod" ? "Made moderator" : "Moderator removed",
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

  // End the room for everyone. Only ever called from the leave sheet, which is
  // the confirmation step, so there is no second browser dialog.
  const handleEndSpace = useCallback(async () => {
    if (!isHost) return;
    try {
      await agoraLeave();
    } catch {
      /* noop */
    }
    await authFetch(`/api/social/spaces/${spaceId}/end`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    router.push(exitHrefRef.current);
  }, [isHost, spaceId, router]);

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
  // spawnReaction but keyed by the target user id so the stage can render each
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

  // Follow or unfollow someone from their person sheet. Optimistic, rolled
  // back with a toast if the request fails so the button never lies about
  // the follow graph.
  const toggleFollow = useCallback(
    (targetId: string) => {
      if (!user || !targetId || targetId === user.id) return;
      const following = followedIds.has(targetId);
      const flip = (on: boolean) =>
        setFollowedIds((prev) => {
          const next = new Set(prev);
          if (on) next.add(targetId);
          else next.delete(targetId);
          return next;
        });
      flip(!following);
      void (async () => {
        try {
          const res = following
            ? await authFetch(`/api/social/follow?target=${encodeURIComponent(targetId)}`, {
                method: "DELETE",
              })
            : await authFetch("/api/social/follow", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ target: targetId }),
              });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data?.error ?? (following ? "Could not unfollow" : "Could not follow"));
          }
        } catch (e) {
          flip(following);
          setShareToast(e instanceof Error ? e.message : "Could not follow");
          setTimeout(() => setShareToast(null), 2500);
        }
      })();
    },
    [user, followedIds],
  );

  // Load who the viewer follows among the people in the room, in one query.
  // Keyed on the set of ids, not the roster object, so a mute or a hand raise
  // does not refetch.
  const rosterIdsKey = participants
    .map((p) => p.user_id)
    .filter(Boolean)
    .sort()
    .join(",");
  useEffect(() => {
    if (!user || !rosterIdsKey) return;
    const ids = rosterIdsKey.split(",").filter((id) => id !== user.id);
    if (ids.length === 0) return;
    let cancelled = false;
    void supabase
      .from("follows")
      .select("following_id")
      .eq("follower_id", user.id)
      .in("following_id", ids)
      .then(({ data }) => {
        if (cancelled || !data) return;
        setFollowedIds(new Set(data.map((row) => row.following_id as string)));
      });
    return () => {
      cancelled = true;
    };
  }, [user, rosterIdsKey]);

  // In "followed" hand-raise mode, the hand only shows if the host follows you.
  const hostIdForFollow = space?.host_id ?? null;
  useEffect(() => {
    if (!user || !hostIdForFollow || hostIdForFollow === user.id || handRaiseMode !== "followed") {
      setHostFollowsMe(false);
      return;
    }
    let cancelled = false;
    void supabase
      .from("follows")
      .select("id")
      .eq("follower_id", hostIdForFollow)
      .eq("following_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setHostFollowsMe(Boolean(data));
      });
    return () => {
      cancelled = true;
    };
  }, [user, hostIdForFollow, handRaiseMode]);

  // Send a report about the room or one chat message to the moderation queue
  // (and an email to Karl, see /api/social/report).
  const submitReport = useCallback(
    async (reason: string) => {
      if (!reportTarget || reportSending) return;
      setReportSending(true);
      const body =
        reportTarget.kind === "space"
          ? {
              content_type: "space",
              content_id: spaceId,
              reported_user: space?.host_id ?? undefined,
              reason,
            }
          : {
              content_type: "space_chat",
              content_id: reportTarget.message.id,
              reported_user: reportTarget.message.user_id ?? undefined,
              reason,
              details: reportTarget.message.body.slice(0, 900),
            };
      try {
        const res = await authFetch("/api/social/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        setShareToast(res.ok ? "Reported. Thank you." : data?.error ?? "Could not send the report");
      } catch {
        setShareToast("Network error");
      } finally {
        setReportSending(false);
        setReportTarget(null);
        setRoomSheet(null);
        setTimeout(() => setShareToast(null), 2500);
      }
    },
    [reportTarget, reportSending, spaceId, space?.host_id],
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
    if (!isJoined || !user || !space?.agora_channel) return;

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
          // Live loudness for the stage's speaking rings.
          onAudioLevels: (levels) => {
            if (!cancelled) setAudioLevels(levels);
          },
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
    participants.find((p) => p.user_id === user?.id)?.role,
  ]);

  // React to role changes without a full rejoin when we're already connected.
  useEffect(() => {
    if (!user || !isJoined) return;
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
  }, [user, isJoined, participants]);

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
        await agoraLeave();
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
  }, [isJoined, spaceId]);

  // Component unmount → leave Agora + PubNub presence cleanly.
  useEffect(() => {
    return () => {
      void agoraLeave();
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
      void agoraEnsureAudio();
    };
    document.addEventListener("pointerdown", unlock, { once: true });
    document.addEventListener("click", unlock, { once: true });
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("click", unlock);
    };
  }, []);

  // Speaking state comes from LiveKit's active-speaker set (every client hears
  // the whole room), not a stale DB flag, so a ring clears when someone stops.
  const withSpeaking = participants.map((p) => ({
    ...p,
    is_speaking: speakingIds.has(p.user_id),
  }));
  // Oldest request first — see src/lib/stageQueue.ts. The roster arrives in
  // join order, which is NOT request order.
  const raisedHands = sortStageQueue(
    participants.filter((p) => p.has_raised_hand && p.role === "audience"),
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
          Back to Spaces
        </Link>
      </div>
    );
  }

  // Deliberate room end (host ended it, or the abandonment reaper closed it) —
  // a calm state, distinct from the `error` branch above.
  if (roomEnded) {
    return (
      <div
        className="flex-1 flex items-center justify-center flex-col gap-4"
        data-testid="space-room-ended"
      >
        <p className="text-melori-text font-medium">{ROOM_ENDED_MESSAGE}</p>
        <Link href={exitHref} className="text-melori-purple hover:underline">
          Back to Spaces
        </Link>
      </div>
    );
  }

  const format = getRoomFormatConfig(space.room_format);
  const hostProfile = space.host;
  const hostId = hostProfile?.id ?? space.host_id;
  const hostName = hostProfile?.display_name ?? "the host";
  const stage = buildSpacesStage(withSpeaking, hostId);
  const stageIds = new Set(stage.map((p) => p.user_id));
  // Listeners with a raised hand first, so the host sees them without opening
  // anything; everyone else keeps join order.
  const listeners = withSpeaking
    .filter((p) => !stageIds.has(p.user_id))
    .sort((a, b) => Number(Boolean(b.has_raised_hand)) - Number(Boolean(a.has_raised_hand)));
  const stageHasRoom = stage.filter((p) => p.user_id !== hostId).length < SPACES_SPEAKER_LIMIT;
  const isLive = space.status === "live";
  const nameOf = (p: SpaceParticipant | null | undefined) =>
    p?.user?.display_name || p?.user?.username || "Member";

  // The one composer. It sits at the foot of the chat, under the conversation.
  const commentComposer = (
    <form
      onSubmit={submitComment}
      data-testid="spaces-composer"
      className="flex h-11 min-w-0 flex-1 items-center gap-1.5 rounded-full bg-melori-elevated pl-4 pr-1.5 transition focus-within:ring-1 focus-within:ring-melori-purple"
    >
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Say something to the room"
        aria-label="Write a comment"
        enterKeyHint="send"
        maxLength={2000}
        className="min-w-0 flex-1 bg-transparent text-[15px] text-melori-text placeholder:text-melori-muted focus:outline-none"
      />
      <button
        type="submit"
        disabled={!draft.trim() || sendingComment}
        aria-label="Send comment"
        className="grid h-8 shrink-0 place-items-center rounded-full bg-melori-purple px-3.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-35 disabled:cursor-not-allowed"
      >
        <Send className="h-4 w-4" />
      </button>
    </form>
  );

  const sheetButton =
    "min-h-11 w-full rounded-xl border border-melori-border bg-melori-surface px-4 text-left text-sm font-semibold text-melori-text transition hover:bg-white/5";

  return (
    <div
      className="spaces-room-shell flex h-[100dvh] max-h-[100dvh] min-h-0 flex-1 flex-col overflow-hidden bg-melori-void animate-fade-in"
      data-testid="spaces-room"
    >
      {/* Header: one line. Back, live state, title with the host and the head
          count under it, share, and the room menu. */}
      <div
        className="mx-auto flex w-full max-w-2xl shrink-0 items-center gap-2.5 px-4 pb-2 pt-1"
        data-testid="spaces-room-header"
      >
        <Link
          href={exitHref}
          aria-label="Back to Spaces"
          data-testid="spaces-back"
          className="-ml-2 grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-white/5"
        >
          <ChevronDown className="h-6 w-6" strokeWidth={2.5} />
        </Link>
        {isLive ? (
          <span className="shrink-0 rounded bg-melori-danger px-1.5 py-0.5 text-[11px] font-bold tracking-[0.08em] text-white">
            LIVE
          </span>
        ) : (
          <span className="shrink-0 rounded bg-melori-elevated px-1.5 py-0.5 text-[11px] font-bold tracking-[0.08em] text-melori-muted">
            {space.status === "scheduled" ? "SOON" : "ENDED"}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-bold leading-tight text-melori-text">
            {space.title}
          </h1>
          <p className="truncate text-xs text-melori-muted tabular-nums">
            {listeners.length} listening · {stage.length} on stage · {hostName} · {format.label}
          </p>
        </div>
        <button
          type="button"
          onClick={handleShare}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-melori-border bg-melori-elevated transition hover:bg-white/10"
          aria-label="Share this space"
        >
          <Share2 className="h-[18px] w-[18px]" />
        </button>
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            className="grid h-10 w-10 place-items-center rounded-full hover:bg-white/5"
            aria-label="More room options"
            data-testid="spaces-more"
          >
            <MoreHorizontal className="h-6 w-6" />
          </button>
          {moreOpen && (
            <div className="absolute right-0 top-full z-30 mt-2 w-56 overflow-hidden rounded-xl border border-melori-border bg-melori-elevated shadow-xl">
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  void handleShare();
                }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-melori-text hover:bg-white/5"
              >
                <Copy className="h-4 w-4" />
                Copy room link
              </button>
              {user && !isHost && (
                <button
                  type="button"
                  data-testid="spaces-report-room"
                  onClick={() => {
                    setMoreOpen(false);
                    setReportTarget({ kind: "space" });
                    openSheet("report");
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-melori-text hover:bg-white/5"
                >
                  <Flag className="h-4 w-4" />
                  Report room
                </button>
              )}
              {isHost && (
                <div className="border-t border-melori-border">
                  <p className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-melori-muted">
                    Who can raise a hand
                  </p>
                  {(
                    [
                      { value: "everyone" as const, label: "Everyone" },
                      { value: "followed" as const, label: "People I follow" },
                      { value: "off" as const, label: "Nobody (I invite)" },
                    ]
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        setMoreOpen(false);
                        void setHandRaiseMode(opt.value);
                      }}
                      className="flex w-full items-center justify-between gap-3 px-4 py-2 text-sm text-melori-text hover:bg-white/5"
                    >
                      <span>{opt.label}</span>
                      {handRaiseMode === opt.value && (
                        <span className="text-xs text-melori-accent">✓</span>
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
                    openSheet("leave");
                  }}
                  className="flex w-full items-center gap-3 border-t border-melori-border px-4 py-2.5 text-sm text-melori-danger hover:bg-red-500/10"
                >
                  <Trash2 className="h-4 w-4" />
                  End room
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {shareToast && (
        <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top,0px)+3.5rem)] z-[95] flex justify-center px-4">
          <span
            role="status"
            className="rounded-full bg-melori-text px-4 py-1.5 text-xs font-semibold text-melori-void shadow-lg"
          >
            {shareToast}
          </span>
        </div>
      )}

      <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-3 overflow-hidden px-4 pb-2">
        {space.status === "scheduled" && (
          <div className="flex shrink-0 items-center justify-between gap-4 rounded-2xl border border-melori-purple/30 bg-melori-purple/10 p-4">
            <div>
              <p className="text-sm font-semibold text-melori-text">Scheduled to start</p>
              <p className="mt-1 text-xs text-melori-muted">
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
                className="rounded-full bg-melori-purple px-5 py-2.5 text-sm font-semibold text-white hover:brightness-110"
              >
                Go live now
              </button>
            )}
          </div>
        )}

        {/* Join genuinely failed (RLS, offline, banned). Say so and offer a
            retry rather than looping the auto-join into the same error. */}
        {user && joinFailed && (
          <button
            onClick={() => {
              autoJoinedRef.current = false;
              setJoinFailed(false);
              void handleJoin();
            }}
            data-testid="spaces-join-retry"
            className="w-full shrink-0 rounded-full border border-melori-border bg-melori-elevated py-3 text-[15px] font-bold text-melori-text"
          >
            Couldn&apos;t join. Tap to retry
          </button>
        )}

        <SpacesStage
          speakers={stage}
          hostId={hostId}
          levels={audioLevels}
          reactionBursts={targetedReactions}
          onSelect={setPersonTarget}
          onOpenSeat={canModerate && stageHasRoom ? () => openSheet("hands") : undefined}
          raisedHandCount={raisedHands.length}
        />

        <SpacesListeners
          listeners={listeners}
          onSelect={setPersonTarget}
          onShowAll={() => openSheet("listeners")}
        />

        <SpacesChat
          messages={chatMessages}
          viewerId={user?.id}
          canModerate={canModerate}
          stageIds={stageIds}
          onDelete={(id) => void deleteComment(id)}
          onReport={(message) => {
            setReportTarget({ kind: "chat", message });
            openSheet("report");
          }}
          composer={user && isJoined ? commentComposer : undefined}
        />
      </div>

      {/* Floating room-wide reaction bursts */}
      {reactions.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 safe-bottom-offset-32 z-30 flex justify-center gap-3">
          {reactions.map((r) => (
            <span key={r} className="animate-bounce text-3xl" style={{ animationDuration: "1.6s" }}>
              {r.slice(r.indexOf(":") + 1) || "❤️"}
            </span>
          ))}
        </div>
      )}

      {/* Someone raised a hand (instant via PubNub). */}
      {peerHandToast && canModerate && (
        <div className="pointer-events-none fixed inset-x-0 safe-bottom-offset-44 z-30 flex justify-center">
          <span
            className="rounded-full bg-melori-warning px-4 py-2 text-xs font-semibold text-melori-void shadow-lg"
            data-testid="toast-peer-hand"
          >
            {peerHandToast}
          </span>
        </div>
      )}

      {/* Bottom sheets: raised hands, leave, all listeners, report. */}
      {roomSheet && (
        <div
          className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
          onClick={closeSheet}
        >
          <section
            ref={sheetDialogRef}
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="spaces-sheet-heading"
            aria-describedby="spaces-sheet-description"
            data-testid={`spaces-${roomSheet}-sheet`}
            className="max-h-[min(36rem,calc(100dvh-2rem))] w-full max-w-md overflow-y-auto rounded-t-3xl border border-melori-border bg-melori-elevated p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-2xl"
          >
            {roomSheet === "hands" && (
              <>
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <h2 id="spaces-sheet-heading" className="text-base font-semibold text-melori-text">
                      Raised hands
                    </h2>
                    <p id="spaces-sheet-description" className="mt-0.5 text-xs text-melori-muted">
                      {stageHasRoom
                        ? "Oldest request first."
                        : `The stage is full (${SPACES_SPEAKER_LIMIT} speakers). Move someone to the audience first.`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeSheet}
                    data-sheet-initial-focus
                    className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-melori-muted hover:bg-white/10 hover:text-melori-text"
                  >
                    Done
                  </button>
                </div>
                {raisedHands.length === 0 ? (
                  <p className="rounded-lg bg-white/[0.03] px-3 py-3 text-sm text-melori-muted">
                    No hands up right now. You can also tap anyone listening and invite them up.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {raisedHands.map((p) => (
                      <li key={p.id} className="flex items-center gap-3 rounded-xl px-1 py-2" data-testid="spaces-hand-row">
                        <PersonAvatar participant={p} size={36} />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{nameOf(p)}</span>
                        <button
                          type="button"
                          onClick={() => p.user_id && void runHostAction(p.user_id, { role: "audience" }, "Hand lowered")}
                          className="min-h-9 shrink-0 rounded-full border border-melori-border px-3 text-xs font-semibold text-melori-muted hover:text-melori-text"
                        >
                          Not now
                        </button>
                        <button
                          type="button"
                          onClick={() => p.user_id && void invitePromote(p.user_id)}
                          disabled={!stageHasRoom}
                          className="min-h-9 shrink-0 rounded-full bg-melori-teal px-3 text-xs font-semibold text-melori-void transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Bring up
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            {roomSheet === "leave" && (
              <>
                <h2 id="spaces-sheet-heading" className="text-base font-semibold text-melori-text">
                  Leave the room?
                </h2>
                <p id="spaces-sheet-description" className="mt-1 text-sm text-melori-muted">
                  If you leave, a moderator or a speaker takes over as host and the room keeps
                  going. If nobody is on stage, the room ends.
                </p>
                <div className="mt-4 flex flex-col gap-2">
                  <button
                    type="button"
                    data-sheet-initial-focus
                    onClick={() => {
                      closeSheet();
                      void handleLeave();
                    }}
                    className={sheetButton}
                  >
                    Leave and hand off
                  </button>
                  <button
                    type="button"
                    data-testid="spaces-end-room"
                    onClick={() => {
                      closeSheet();
                      void handleEndSpace();
                    }}
                    className="min-h-11 w-full rounded-xl border border-red-500/30 bg-red-500/10 px-4 text-left text-sm font-semibold text-red-300"
                  >
                    End room for everyone
                  </button>
                  <button
                    type="button"
                    onClick={closeSheet}
                    className="min-h-11 w-full rounded-xl px-4 text-sm font-medium text-melori-muted hover:bg-white/5"
                  >
                    Stay
                  </button>
                </div>
              </>
            )}

            {roomSheet === "listeners" && (
              <>
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <h2 id="spaces-sheet-heading" className="text-base font-semibold text-melori-text">
                      {listeners.length} listening
                    </h2>
                    <p id="spaces-sheet-description" className="mt-0.5 text-xs text-melori-muted">
                      Tap someone to follow them{canModerate ? " or invite them to speak" : ""}.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeSheet}
                    data-sheet-initial-focus
                    className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-melori-muted hover:bg-white/10 hover:text-melori-text"
                  >
                    Done
                  </button>
                </div>
                <ul className="flex flex-col">
                  {listeners.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => {
                          closeSheet();
                          setPersonTarget(p);
                        }}
                        className="flex w-full items-center gap-3 rounded-xl px-1 py-2 text-left hover:bg-white/5"
                      >
                        <PersonAvatar participant={p} size={36} />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{nameOf(p)}</span>
                        {p.has_raised_hand && (
                          <Hand className="h-4 w-4 text-melori-warning" aria-label="Hand raised" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {roomSheet === "report" && (
              <>
                <h2 id="spaces-sheet-heading" className="text-base font-semibold text-melori-text">
                  {reportTarget?.kind === "chat" ? "Report this message" : "Report this room"}
                </h2>
                <p id="spaces-sheet-description" className="mt-1 text-sm text-melori-muted">
                  {reportTarget?.kind === "chat"
                    ? `From ${reportTarget.message.author_display || reportTarget.message.author_name || "a member"}. `
                    : ""}
                  What&apos;s wrong? Melori reviews every report.
                </p>
                <div className="mt-4 flex flex-col gap-2">
                  {(
                    [
                      ["harassment", "Harassment or hate"],
                      ["spam", "Spam or scams"],
                      ["sexual", "Sexual content"],
                      ["violence", "Threats or violence"],
                      ["other", "Something else"],
                    ] as const
                  ).map(([key, label], index) => (
                    <button
                      key={key}
                      type="button"
                      disabled={reportSending}
                      {...(index === 0 ? { "data-sheet-initial-focus": true } : {})}
                      onClick={() => void submitReport(key)}
                      className={`${sheetButton} disabled:opacity-50`}
                    >
                      {label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setReportTarget(null);
                      closeSheet();
                    }}
                    className="min-h-11 w-full rounded-xl px-4 text-sm font-medium text-melori-muted hover:bg-white/5"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {/* One sheet for any person you tap: follow, react, and for the host or
          a moderator, the stage controls. */}
      {personTarget && (() => {
        const target = withSpeaking.find((p) => p.user_id === personTarget.user_id) ?? personTarget;
        const targetId = target.user?.id ?? target.user_id;
        const isSelf = targetId === user?.id;
        const targetIsHost = targetId === hostId;
        const onStage = target.role === "host" || target.role === "speaker";
        const following = followedIds.has(targetId);
        const close = () => setPersonTarget(null);
        const Item = ({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) => (
          <button
            type="button"
            onClick={() => {
              onClick();
              close();
            }}
            className={`w-full rounded-xl px-3 py-3 text-left text-[15px] font-medium transition hover:bg-white/5 ${
              danger ? "text-red-400" : "text-melori-text"
            }`}
          >
            {label}
          </button>
        );
        return (
          <div
            className="fixed inset-0 z-[85] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
            onClick={close}
            role="dialog"
            aria-modal="true"
            aria-label={nameOf(target)}
            data-testid="spaces-person-sheet"
          >
            <div
              className="w-full max-w-md rounded-t-3xl border border-melori-border bg-melori-elevated p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:rounded-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 pb-3">
                <PersonAvatar participant={target} size={48} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-melori-text">{nameOf(target)}</p>
                  <p className="text-xs text-melori-muted">
                    {targetIsHost
                      ? "Host"
                      : target.badge === "mod"
                        ? "Moderator"
                        : onStage
                          ? "Speaker"
                          : target.has_raised_hand
                            ? "Listener · hand raised"
                            : "Listener"}
                  </p>
                </div>
                {user && !isSelf && (
                  <button
                    type="button"
                    onClick={() => toggleFollow(targetId)}
                    data-testid="spaces-follow"
                    className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition ${
                      following
                        ? "border border-melori-border text-melori-muted"
                        : "bg-melori-purple text-white hover:brightness-110"
                    }`}
                  >
                    {following ? "Following" : "Follow"}
                  </button>
                )}
              </div>
              {!isSelf && (
                <div className="flex items-center justify-between gap-1 border-y border-melori-border py-2">
                  {["❤️", "🔥", "👏", "🎵", "😂", "🙌"].map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => {
                        if (targetId) sendReactionTo(targetId, emoji);
                        close();
                      }}
                      className="grid min-h-[44px] min-w-[44px] place-items-center rounded-full text-2xl transition-transform hover:scale-125 hover:bg-white/5"
                      aria-label={`React ${emoji} to ${nameOf(target)}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
              {canModerate && !isSelf && !targetIsHost && (
                <div className="flex flex-col gap-0.5 pt-2">
                  {onStage ? (
                    <>
                      <Item
                        label={target.host_muted ? "Allow to unmute" : "Mute"}
                        onClick={() => void hostMute(targetId, !target.host_muted)}
                      />
                      <Item label="Move to audience" onClick={() => void hostDemote(targetId)} />
                    </>
                  ) : (
                    <Item
                      label={stageHasRoom ? "Invite to speak" : "Invite to speak (stage is full)"}
                      onClick={() => void invitePromote(targetId)}
                    />
                  )}
                  {isHost && (
                    <Item
                      label={target.badge === "mod" ? "Remove as moderator" : "Make moderator"}
                      onClick={() => void hostSetBadge(targetId, target.badge === "mod" ? null : "mod")}
                    />
                  )}
                  <Item danger label="Remove from room" onClick={() => void hostRemove(targetId)} />
                  {isHost && (
                    <Item danger label="Remove and ban from this room" onClick={() => void hostBan(targetId)} />
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Signed out: the room is visible read-only, with one call to action
          where the controls would be. */}
      {!user && (
        <div className="shrink-0 border-t border-melori-border bg-melori-void px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
          <button
            onClick={handleJoin}
            data-testid="spaces-signin-cta"
            className="mx-auto block w-full max-w-2xl rounded-full bg-melori-purple py-3.5 text-[16px] font-bold text-white active:opacity-80"
          >
            Sign in to join the conversation
          </button>
        </div>
      )}

      {isJoined && (
        <div className="shrink-0 border-t border-melori-border bg-melori-void pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2">
          {(reconnecting || micDenied) && (
            <p role="status" className="mx-auto max-w-2xl px-4 pb-1 text-center text-xs text-melori-warning">
              {reconnecting
                ? "Reconnecting to audio…"
                : "Microphone access was blocked. Allow it in your browser settings to speak."}
            </p>
          )}
          {activity && (
            <div
              key={activity.key}
              data-testid="spaces-activity"
              className="mx-auto flex max-w-2xl items-center gap-2 px-4 pb-1 text-sm animate-fade-in"
            >
              <span className="max-w-[35%] truncate font-semibold">{activity.actor}</span>
              <span className="shrink-0 text-melori-muted">reacted</span>
              <span className="shrink-0 text-lg leading-none">{activity.emoji}</span>
              <span className="shrink-0 text-melori-muted">to</span>
              <span className="truncate font-semibold">{activity.target}</span>
            </div>
          )}

          <div
            data-testid="spaces-control-bar"
            className="mx-auto flex min-h-[56px] max-w-2xl items-center gap-2 px-4"
          >
            {/* Leave quietly, bottom-left, away from the mic (Clubhouse). The
                host is asked whether to hand the room off or end it. */}
            <button
              type="button"
              data-testid="spaces-leave"
              onClick={() => (isHost ? openSheet("leave") : void handleLeave())}
              className="flex h-12 shrink-0 items-center gap-1.5 rounded-full pl-1 pr-3 text-red-300 transition hover:bg-red-500/10"
            >
              <span aria-hidden="true" className="text-base leading-none">
                ✌️
              </span>
              <span className="text-[15px] font-semibold">Leave quietly</span>
            </button>
            <span className="flex-1" aria-hidden="true" />

            {canModerate && (
              <button
                type="button"
                data-testid="spaces-hands-queue"
                onClick={() => openSheet("hands")}
                aria-label={`Raised hands (${raisedHands.length})`}
                title="Raised hands"
                className="relative grid h-12 w-12 shrink-0 place-items-center rounded-full border border-melori-border bg-melori-elevated text-melori-text transition hover:bg-white/10"
              >
                <Users className="h-6 w-6" />
                {raisedHands.length > 0 && (
                  <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-melori-pink px-1 text-[11px] font-bold text-white">
                    {raisedHands.length}
                  </span>
                )}
              </button>
            )}

            {/* Reactions for the whole room. */}
            <details className="group relative">
              <summary
                className="grid h-12 w-12 cursor-pointer list-none place-items-center rounded-full border border-melori-border bg-melori-elevated text-melori-text transition hover:bg-white/10"
                aria-label="Reactions"
              >
                <Smile className="h-6 w-6" />
              </summary>
              <div className="absolute bottom-full right-0 mb-2 flex gap-1 rounded-full border border-melori-border bg-melori-elevated px-2 py-2 shadow-xl">
                {["❤️", "🔥", "👏", "🎵", "😂", "🙌"].map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      sendReaction(emoji);
                      (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute(
                        "open",
                      );
                    }}
                    className="px-1 text-xl transition-transform hover:scale-125"
                    aria-label={`React ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </details>

            {/* Mic for anyone on stage. Tap toggles mute; press and hold talks
                while held, then restores the previous state. */}
            {canSpeakNow && (
              <button
                type="button"
                data-testid="spaces-mic"
                onClick={() => {
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
                aria-label={isMuted ? "Unmute (tap) or hold to talk" : "Mute (tap) or hold to talk"}
                title="Tap to toggle mute · Press and hold to talk"
                className={`grid h-12 w-12 shrink-0 select-none touch-none place-items-center rounded-full transition ${
                  isMuted
                    ? "border border-melori-border bg-melori-elevated text-melori-danger"
                    : "bg-melori-text text-melori-void"
                }`}
              >
                {isMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
              </button>
            )}

            {!isHost && !canSpeakNow && canRaiseHandNow && (
              <button
                type="button"
                onClick={toggleHand}
                data-testid="spaces-ask-to-speak"
                title={hasRaisedHand ? "Lower hand" : "Ask to speak"}
                aria-label={hasRaisedHand ? "Lower hand" : "Ask to speak"}
                aria-pressed={hasRaisedHand}
                className={`grid h-12 w-12 shrink-0 place-items-center rounded-full transition ${
                  hasRaisedHand
                    ? "bg-melori-warning text-melori-void"
                    : "border border-melori-border bg-melori-elevated text-melori-text hover:bg-white/10"
                }`}
              >
                <Hand className="h-6 w-6" />
              </button>
            )}

            {/* Hand-raising is off (or limited to people the host follows):
                say so instead of a missing control. */}
            {!isHost && !canSpeakNow && !canRaiseHandNow && (
              <span
                title={
                  handRaiseMode === "followed"
                    ? "The host is only taking requests from people they follow"
                    : "The host has turned off requests to speak"
                }
                className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white/5 text-melori-muted"
              >
                <Volume2 className="h-6 w-6" />
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// A person's photo, or their initials on their own color.
function PersonAvatar({ participant, size }: { participant: SpaceParticipant; size: number }) {
  const name = participant.user?.display_name || participant.user?.username || "Member";
  if (participant.user?.avatar_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={participant.user.avatar_url}
        alt=""
        style={{ width: size, height: size }}
        className="shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      style={{ width: size, height: size, backgroundColor: spacesAvatarColor(participant.user_id) }}
      className="grid shrink-0 place-items-center rounded-full text-sm font-bold text-white"
    >
      {spacesInitials(name)}
    </span>
  );
}
