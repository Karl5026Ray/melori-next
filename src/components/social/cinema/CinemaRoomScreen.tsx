"use client";

// MM Cinema live room: /social/cinema/[roomId].
//
// Cinema's own screen. Until 2 Oct 2026 one RoomScreen served both Cinema and
// Spaces; Karl asked for the two to share no room code, so Spaces now has
// spaces/SpacesRoomScreen.tsx and this file only knows about Cinema.
//
// A Cinema room is still a `spaces` row with room_format='cinema', so the two
// products share plumbing (tables, moderation and ban routes, LiveKit,
// PubNub) but no screen code. Cinema is audio-only since 1 Oct 2026: the
// shared screen on top, three seats (host + two guests, capped by
// src/lib/cinemaStage.ts), the listeners, and a persistent chat.

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { useCanParticipate, useCanRequestStage } from "@/components/social/SignInPrompt";
import { canSpeak, handRaiseAllowed } from "@/lib/spacesStage";
import { authFetch, authHeaders } from "@/lib/authClient";
import {
  ensureVideoAudio,
  joinVideoRoom,
  leaveVideoRoom,
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
import { useRoomComments, type ChatComment } from "@/components/social/rooms/useRoomComments";
import CinemaStage from "@/components/social/cinema/CinemaStage";
import CinemaVoiceCircles from "@/components/social/cinema/CinemaVoiceCircles";
import CinemaChat from "@/components/social/cinema/CinemaChat";
import CinemaRoomCanvas from "@/components/social/cinema/CinemaRoomCanvas";
import { CinemaScreen } from "@/components/social/cinema/CinemaScreen";
import { buildCinemaAudioSeats } from "@/lib/cinemaStage";
import { roomExitHref, roomExitLabel, roomHref } from "@/lib/cinema";
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
  UserPlus,
  Users,
} from "lucide-react";
import Link from "next/link";

export default function RoomScreen({ spaceId }: { spaceId: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const canParticipate = useCanParticipate();
  // Clubhouse parity: raising a hand is gated on being signed in ONLY (no
  // Superfan requirement) — see src/lib/spacesStage.ts. Speaking itself is
  // gated separately below on the caller's own participant role, which only
  // changes once the host promotes them.
  const canRequestStage = useCanRequestStage();

  const [space, setSpace] = useState<Space | null>(null);
  // This screen is Cinema's alone; the Cinema route redirects every other
  // format to its own product before this renders.
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
  // Identity -> 0..1 microphone level, sampled from LiveKit. Drives the volume
  // rings on Cinema's audio seats and voice circles.
  const [cinemaAudioLevels, setCinemaAudioLevels] = useState<Record<string, number>>({});
  // Cinema's two bottom sheets: the raised-hands queue (host / moderators) and
  // the host's leave choice (hand off vs end for everyone). One state so they
  // can never both be open, sharing one focus-contained dialog below.
  const [cinemaSheet, setCinemaSheet] = useState<null | "hands" | "leave" | "report">(null);
  // What the report sheet is about: the room, or one chat message.
  const [reportTarget, setReportTarget] = useState<
    { kind: "space" } | { kind: "chat"; message: ChatComment } | null
  >(null);
  const [reportSending, setReportSending] = useState(false);
  const cinemaSheetReturnFocusRef = useRef<HTMLElement | null>(null);
  const cinemaSheetDialogRef = useRef<HTMLElement>(null);
  const openCinemaSheet = useCallback((sheet: "hands" | "leave" | "report") => {
    cinemaSheetReturnFocusRef.current =
      typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
    setCinemaSheet(sheet);
  }, []);
  const closeCinemaSheet = useCallback(() => setCinemaSheet(null), []);
  // This must live with the rest of the component hooks, before the loading,
  // error, and ended-room returns below. A room initially loads without a
  // space, then renders the Cinema controls after the query resolves.
  useEffect(() => {
    if (!cinemaSheet) return;
    const dialog = cinemaSheetDialogRef.current;
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
      dialog.querySelector<HTMLElement>("[data-cinema-dialog-initial-focus]")?.focus();
    const focusFrame = window.requestAnimationFrame(focusInitialControl);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCinemaSheet();
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
      cinemaSheetReturnFocusRef.current?.focus?.();
    };
  }, [cinemaSheet, closeCinemaSheet]);
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
  // Where to come back to after a sign-in detour. Routed by format so a Cinema
  // viewer who signs in returns to the Cinema URL directly, instead of taking a
  // visible bounce through /social/spaces on the way back to their own room.
  const roomPath = roomHref({ id: spaceId, room_format: space?.room_format });
  const [isMuted, setIsMuted] = useState(true);
  const [hasRaisedHand, setHasRaisedHand] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [shareToast, setShareToast] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [reactions, setReactions] = useState<string[]>([]);
  // Targeted reaction bursts, keyed by the target participant's user id. Each
  // value is a list of unique burst keys ("<ts>-<seq>:<emoji>"). Rendered over
  // that person's seat or circle, separate from the center-screen bursts.
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
  // reacts.
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
      // Cinema's stage is three seats the host fills by hand (see
      // src/lib/cinemaStage.ts), so membership tier never auto-seats anyone
      // there: an artist or superfan walking in must not take a guest seat.
      const elevatedTakesStage = isElevated && space?.room_format !== "cinema";
      const joinRole = isHostJoining
        ? "host"
        : keepsStage
          ? existing!.role
          : elevatedTakesStage
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
      void ensureVideoAudio();
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
      await leaveVideoRoom();
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
  // "followed" hand-raise mode: only people the host follows may raise a hand.
  // The raise-hand route re-checks this server-side.
  const [hostFollowsMe, setHostFollowsMe] = useState(false);
  const hostIdForMode = space?.host_id ?? null;
  useEffect(() => {
    if (!user || !hostIdForMode || hostIdForMode === user.id || handRaiseMode !== "followed") {
      setHostFollowsMe(false);
      return;
    }
    let cancelled = false;
    void supabase
      .from("follows")
      .select("id")
      .eq("follower_id", hostIdForMode)
      .eq("following_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setHostFollowsMe(Boolean(data));
      });
    return () => {
      cancelled = true;
    };
  }, [user, hostIdForMode, handRaiseMode]);
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
        await setCinemaMicEnabled(!nextMuted);
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
    void ensureVideoAudio();
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
    void ensureVideoAudio();
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
  // One comment subscription feeds both presentations. Cinema renders the
  // transient overlay while this page owns its only composer in the stable dock.
  const {
    comments: roomComments,
    sendComment,
    deleteComment,
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

  // `confirmed` is passed by callers that already asked in their own UI (the
  // Cinema leave sheet), so the host is not asked twice.
  const handleEndSpace = useCallback(async (confirmed = false) => {
    if (!isHost) return;
    if (
      !confirmed &&
      typeof window !== "undefined" &&
      !window.confirm("End this space for everyone?")
    ) {
      return;
    }
    try {
      await leaveVideoRoom();
    } catch {
      /* noop */
    }
    await authFetch(`/api/social/spaces/${spaceId}/end`, { method: "POST", headers: { "Content-Type": "application/json" } });
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
  // spawnReaction but keyed by the target user id so the seat can render each
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

  // Follow or unfollow the host from the room menu. Optimistic, rolled back
  // with a toast if the request fails.
  const toggleHostFollow = useCallback(
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
            throw new Error(data?.error ?? "Could not update follow");
          }
          setShareToast(following ? "Unfollowed" : "Following");
          setTimeout(() => setShareToast(null), 1800);
        } catch (e) {
          flip(following);
          setShareToast(e instanceof Error ? e.message : "Could not update follow");
          setTimeout(() => setShareToast(null), 2500);
        }
      })();
    },
    [user, followedIds],
  );

  // Load whether the viewer already follows the host (follows are publicly
  // readable). It used to be seeded empty, so the menu always said "follow".
  const hostIdForFollow = space?.host_id ?? null;
  useEffect(() => {
    if (!user || !hostIdForFollow || hostIdForFollow === user.id) return;
    let cancelled = false;
    void supabase
      .from("follows")
      .select("following_id")
      .eq("follower_id", user.id)
      .eq("following_id", hostIdForFollow)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setFollowedIds((prev) => {
          const next = new Set(prev);
          if (data) next.add(hostIdForFollow);
          else next.delete(hostIdForFollow);
          return next;
        });
      });
    return () => {
      cancelled = true;
    };
  }, [user, hostIdForFollow]);

  // Report the room or one chat message: the moderation queue, plus an email
  // to Karl (see /api/social/report). Replaced an alert() that sent nothing.
  const submitReport = useCallback(
    async (reason: string) => {
      if (!reportTarget || reportSending) return;
      setReportSending(true);
      const body =
        reportTarget.kind === "space"
          ? { content_type: "space", content_id: spaceId, reported_user: space?.host_id ?? undefined, reason }
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
        setCinemaSheet(null);
        setTimeout(() => setShareToast(null), 2500);
      }
    },
    [reportTarget, reportSending, spaceId, space?.host_id],
  );

  // Cinema's one RTC connection. Cinema is audio-only (1 Oct 2026): the host
  // and the two seated guests publish a microphone, everyone else listens. The
  // camera is never requested, so no permission prompt for it ever appears.
  useEffect(() => {
    if (!isJoined || !user || !space) return;
    const myPart = participants.find((participant) => participant.user_id === user.id && !participant.left_at);
    if (!myPart) return;
    const role: "publisher" | "subscriber" =
      myPart.role === "host" || myPart.role === "speaker" ? "publisher" : "subscriber";
    let cancelled = false;

    void joinVideoRoom({
      spaceId,
      role,
      roomMode: "cinema",
      autoEnableCamera: false,
      autoEnableMicrophone: !myPart.is_muted && !myPart.host_muted,
      spaceType: space.type,
      onActiveSpeakersChange: (identities) => {
        if (!cancelled) setSpeakingIds(new Set(identities));
      },
      // Continuous loudness for the voice circles' volume rings. The sampler
      // only emits on a meaningful change, so a quiet room does not re-render.
      onAudioLevels: (levels) => {
        if (!cancelled) setCinemaAudioLevels(levels);
      },
      onReconnecting: () => !cancelled && setReconnecting(true),
      onReconnected: () => !cancelled && setReconnecting(false),
      onRoomEnded: () => {
        if (cancelled) return;
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
      .catch((err) => {
        if (/NotAllowedError|Permission|permission denied/i.test((err as Error).message ?? "")) {
          setMicDenied(true);
        }
      });

    return () => {
      cancelled = true;
      void leaveVideoRoom();
    };
    // A role transition (brought on stage / moved to the audience)
    // intentionally reconnects this one room with a fresh, server-authorized
    // publish grant.
  }, [
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
        await leaveVideoRoom();
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
      void ensureVideoAudio();
    };
    document.addEventListener("pointerdown", unlock, { once: true });
    document.addEventListener("click", unlock, { once: true });
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("click", unlock);
    };
  }, []);

  // Drive is_speaking from the real-time client set (authoritative: every client
  // hears the whole room via ActiveSpeakersChanged), so the ring shows for
  // everyone who is speaking and clears when they stop — not stuck on a stale DB
  // value. The rings still gate on mute, so muted users never show one.
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
  // Cinema's stage: [host, guest, guest] from the same `role` column Spaces
  // uses. Speakers beyond the two-guest cap (rooms from before the cap) stay
  // visible with the listeners rather than vanishing with a live microphone.
  const { seats: cinemaSeats } = buildCinemaAudioSeats(withSpeaking, hostId);
  const cinemaSeatUserIds = new Set(
    cinemaSeats
      .map((seat) => seat?.user_id)
      .filter((participantId): participantId is string => Boolean(participantId)),
  );
  const cinemaAudience = withSpeaking.filter(
    (participant) => !cinemaSeatUserIds.has(participant.user_id),
  );
  const myParticipant =
    participants.find((participant) => participant.user_id === user?.id && !participant.left_at) ?? null;
  // Host plus badged moderators run the stage (the participants route grants
  // them the same promote / demote / mute), and may delete chat lines.
  const canModerateRoom =
    isHost || myParticipant?.badge === "mod" || myParticipant?.badge === "cohost";
  const cinemaGuestSeatsOpen = cinemaSeats.slice(1).filter((seat) => !seat).length;

  // Tapping a seat: an empty one opens the hands queue for whoever runs the
  // stage; a person opens the host's moderation sheet, or a reaction picker.
  const selectCinemaSeat = (participant: SpaceParticipant | null) => {
    if (!participant) {
      if (canModerateRoom) openCinemaSheet("hands");
      return;
    }
    if (isHost && participant.user_id !== user?.id) {
      setModTarget(participant);
      return;
    }
    setReactTarget(participant);
  };

  // The one composer for every room format, so there is a single send path.
  // Spaces docks it in the control bar; Cinema puts it at the foot of the chat
  // panel under the stage, where the conversation it belongs to is visible.
  const commentComposer = (
    <form
      onSubmit={submitComment}
      data-testid="cinema-composer"
      className={`flex-1 min-w-0 flex items-center gap-1.5 pl-4 pr-1.5 rounded-full bg-melori-void/70 focus-within:bg-melori-void transition ${
        "h-10"
      }`}
    >
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Say something to the room"
        aria-label="Write a comment"
        enterKeyHint="send"
        maxLength={2000}
        className="flex-1 min-w-0 bg-transparent text-[15px] placeholder:text-melori-muted focus:outline-none"
      />
      <button
        type="submit"
        disabled={!draft.trim() || sendingComment}
        aria-label="Send comment"
        className="w-9 h-9 shrink-0 flex items-center justify-center rounded-full bg-melori-purple text-white transition disabled:opacity-30 disabled:cursor-not-allowed hover:brightness-110"
      >
        <Send className="w-[18px] h-[18px]" />
      </button>
    </form>
  );

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
    <div className="cinema-room-shell flex h-[100dvh] max-h-[100dvh] min-h-0 flex-1 flex-col overflow-hidden bg-melori-void animate-fade-in">
      <div className="flex-1 flex flex-col min-h-0 bg-melori-void overflow-hidden">

        {/* One header line (the look Karl picked from the prototype): back,
            live state, the title with the head count and host under it,
            share, and the room menu. Every pixel saved here goes to the
            screen and the chat. */}
        <div
          className="mx-auto flex w-full max-w-2xl shrink-0 items-center gap-2.5 px-4 pb-1.5 pt-1"
          data-testid="cinema-room-header"
        >
          <Link
            href={exitHref}
            aria-label={roomExitLabel(space?.room_format)}
            className="-ml-2 grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-white/5"
          >
            <ChevronDown className="h-6 w-6" strokeWidth={2.5} />
          </Link>
          {space.status === "live" ? (
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
              {cinemaAudience.length} listening · {cinemaSeatUserIds.size} on stage ·{" "}
              {hostProfile?.display_name ?? "Host"}
            </p>
          </div>
          {!user && (
            <Link
              href={exitHref}
              data-testid="spaces-back"
              className="shrink-0 rounded-full border border-melori-border bg-melori-elevated px-3 py-2 text-sm font-medium"
            >
              Back
            </Link>
          )}
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
                {!isHost && hostId && user && (
                  <button
                    type="button"
                    onClick={() => {
                      setMoreOpen(false);
                      toggleHostFollow(hostId);
                    }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-melori-text hover:bg-white/5"
                  >
                    <UserPlus className="h-4 w-4" />
                    {followsHost ? "Unfollow host" : "Follow host"}
                  </button>
                )}
                {user && !isHost && (
                  <button
                    type="button"
                    data-testid="cinema-report-room"
                    onClick={() => {
                      setMoreOpen(false);
                      setReportTarget({ kind: "space" });
                      openCinemaSheet("report");
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
                      openCinemaSheet("leave");
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

      <div className="relative flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-hidden px-4 pb-2 md:px-8">
        <div className="mx-auto flex h-full min-h-0 w-full max-w-2xl flex-col">
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
              {cinemaSheet && (
                <div
                  className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
                  onClick={closeCinemaSheet}
                >
                <section
                  ref={cinemaSheetDialogRef}
                  tabIndex={-1}
                  onClick={(event) => event.stopPropagation()}
                  className="max-h-[min(34rem,calc(100dvh-2rem))] w-full max-w-md overflow-y-auto rounded-t-3xl border border-cinema-border bg-melori-elevated p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-2xl"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="cinema-sheet-heading"
                  aria-describedby="cinema-sheet-description"
                  data-testid={`cinema-${cinemaSheet}-sheet`}
                >
                  {cinemaSheet === "hands" ? (
                    <>
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <h2 id="cinema-sheet-heading" className="text-base font-semibold text-melori-text">
                            Raised hands
                          </h2>
                          <p id="cinema-sheet-description" className="mt-0.5 text-xs text-melori-muted">
                            {cinemaGuestSeatsOpen > 0
                              ? `${cinemaGuestSeatsOpen} open ${cinemaGuestSeatsOpen === 1 ? "seat" : "seats"} on stage. Oldest request first.`
                              : "The stage is full. Move a guest to the audience first."}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={closeCinemaSheet}
                          data-cinema-dialog-initial-focus
                          className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-white/70 hover:bg-white/10 hover:text-white"
                        >
                          Done
                        </button>
                      </div>
                      {raisedHands.length === 0 ? (
                        <p className="rounded-lg bg-white/[0.03] px-3 py-3 text-sm text-melori-muted">
                          No hands up right now.
                        </p>
                      ) : (
                        <ul className="flex flex-col gap-1">
                          {raisedHands.map((p) => (
                            <li
                              key={p.id}
                              className="flex items-center gap-3 rounded-xl px-2 py-2"
                              data-testid="cinema-hand-row"
                            >
                              <img
                                src={p.user?.avatar_url || "/favicon.png"}
                                alt=""
                                className="h-9 w-9 shrink-0 rounded-full object-cover"
                              />
                              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                                {p.user?.display_name ?? "Listener"}
                              </span>
                              <button
                                type="button"
                                onClick={() => p.user_id && void invitePromote(p.user_id)}
                                disabled={cinemaGuestSeatsOpen === 0}
                                className="min-h-9 shrink-0 rounded-full bg-melori-teal px-3 text-xs font-semibold text-melori-void transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                Bring up
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  ) : cinemaSheet === "report" ? (
                    <>
                      <h2 id="cinema-sheet-heading" className="text-base font-semibold text-melori-text">
                        {reportTarget?.kind === "chat" ? "Report this message" : "Report this room"}
                      </h2>
                      <p id="cinema-sheet-description" className="mt-1 text-sm text-melori-muted">
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
                            {...(index === 0 ? { "data-cinema-dialog-initial-focus": true } : {})}
                            onClick={() => void submitReport(key)}
                            className="min-h-11 rounded-xl border border-melori-border bg-melori-void px-4 text-left text-sm font-semibold disabled:opacity-50"
                          >
                            {label}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => {
                            setReportTarget(null);
                            closeCinemaSheet();
                          }}
                          className="min-h-11 rounded-xl px-4 text-sm font-medium text-melori-muted hover:bg-white/5"
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <h2 id="cinema-sheet-heading" className="text-base font-semibold text-melori-text">
                        Leave the room?
                      </h2>
                      <p id="cinema-sheet-description" className="mt-1 text-sm text-melori-muted">
                        If you leave, a moderator or a guest on stage takes over as host and
                        the room keeps going. If nobody is on stage, the room ends.
                      </p>
                      <div className="mt-4 flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            closeCinemaSheet();
                            void handleLeave();
                          }}
                          data-cinema-dialog-initial-focus
                          className="min-h-11 rounded-xl border border-melori-border bg-melori-void px-4 text-left text-sm font-semibold"
                        >
                          Leave and hand off
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            closeCinemaSheet();
                            void handleEndSpace(true);
                          }}
                          data-testid="cinema-end-room"
                          className="min-h-11 rounded-xl border border-red-500/30 bg-red-500/10 px-4 text-left text-sm font-semibold text-red-300"
                        >
                          End room for everyone
                        </button>
                        <button
                          type="button"
                          onClick={closeCinemaSheet}
                          className="min-h-11 rounded-xl px-4 text-sm font-medium text-melori-muted hover:bg-white/5"
                        >
                          Stay
                        </button>
                      </div>
                    </>
                  )}
                </section>
                </div>
              )}

                <CinemaRoomCanvas
                  screen={<CinemaScreen spaceId={spaceId} isHost={isHost} viewportBound />}
                  seats={
                    <CinemaStage
                      seats={cinemaSeats}
                      levels={cinemaAudioLevels}
                      viewerIsHost={canModerateRoom}
                      onSelectSeat={selectCinemaSeat}
                      reactionBursts={targetedReactions}
                    />
                  }
                  audience={
                    <CinemaVoiceCircles
                      compact
                      audience={cinemaAudience}
                      levels={cinemaAudioLevels}
                      onReactToParticipant={isHost ? setModTarget : setReactTarget}
                      reactionBursts={targetedReactions}
                    />
                  }
                  chat={
                    <CinemaChat
                      comments={roomComments}
                      viewerId={user?.id}
                      canModerate={canModerateRoom}
                      stageIds={cinemaSeatUserIds}
                      onDelete={(id) => void deleteComment(id)}
                      onReport={(message) => {
                        setReportTarget({ kind: "chat", message });
                        openCinemaSheet("report");
                      }}
                      composer={user && isJoined ? commentComposer : undefined}
                    />
                  }
                />

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
                    {modTarget.role !== "host" && (
                      <Item
                        label={
                          modTarget.badge === "mod"
                            ? "Remove moderator 🎸"
                            : "Make moderator 🎸"
                        }
                        onClick={() =>
                          void hostSetBadge(
                            targetId,
                            modTarget.badge === "mod" ? null : "mod",
                          )
                        }
                      />
                    )}
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
                    {modTarget.role !== "host" && (
                      <Item
                        danger
                        label="Remove and ban from this room"
                        onClick={() => void hostBan(targetId)}
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
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center"
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

      {/* Cinema owns the mobile safe area and suppresses the global MobileTabBar.
          Other room formats keep their dock clear of that fixed navigation. */}
      {/* Signed out: the room above renders read-only — faces, title, live
          comments. The dock slot carries the single call to action instead of
          a composer nobody can use, so the sign-in ask sits exactly where the
          thing it unlocks will appear, and the participant grid is never
          pushed down the screen to make room for it. */}
      {!user && (
        <div className="shrink-0 border-t border-melori-border bg-melori-void pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className="max-w-2xl mx-auto px-4 md:px-6 pt-3">
            <button
              onClick={handleJoin}
              data-testid="spaces-signin-cta"
              className="w-full rounded-full bg-melori-purple py-3.5 text-[16px] font-bold text-white active:opacity-80"
            >
              Sign in to join the conversation
            </button>
          </div>
        </div>
      )}

      {isJoined && (
        <div className="shrink-0 border-t border-melori-border bg-melori-void pt-1 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">

          {/* Cinema's room is one non-scrolling viewport, so its connection and
              microphone notices ride on the dock rather than below the fold. */}
          {(reconnecting || micDenied) && (
            <p
              role="status"
              className="max-w-2xl mx-auto px-4 md:px-6 pt-2 text-center text-xs text-yellow-200"
            >
              {reconnecting
                ? "Reconnecting to audio…"
                : "Microphone access was blocked. Allow it in your browser settings to speak."}
            </p>
          )}

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
            data-testid="cinema-control-dock"
            className="max-w-2xl mx-auto px-4 md:px-6 flex items-center gap-2 pt-1.5 min-h-[56px]"
          >
            {/* Cinema: leave quietly sits bottom-left, away from the mic, as in
               Clubhouse. Listeners and guests just go; the host is asked
               whether to hand the room off or end it for everyone. */}
              <button
                type="button"
                data-testid="cinema-leave"
                onClick={() => (isHost ? openCinemaSheet("leave") : void handleLeave())}
                className="h-12 pl-1 pr-3 shrink-0 flex items-center gap-1.5 rounded-full text-red-300 hover:bg-red-500/10 transition"
              >
                <span aria-hidden="true" className="text-base leading-none">
                  ✌️
                </span>
                <span className="text-[15px] font-semibold">Leave quietly</span>
              </button>
            <span className="flex-1" aria-hidden="true" />
            {canModerateRoom && (
              <button
                type="button"
                data-testid="cinema-hands-queue"
                onClick={() => openCinemaSheet("hands")}
                aria-label={`Raised hands (${raisedHands.length})`}
                title="Raised hands"
                className="relative w-12 h-12 shrink-0 flex items-center justify-center rounded-full bg-melori-void/60 text-melori-text hover:bg-melori-void transition"
              >
                <Users className="w-6 h-6" />
                {raisedHands.length > 0 && (
                  <span className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-melori-pink px-1 text-[11px] font-bold text-white">
                    {raisedHands.length}
                  </span>
                )}
              </button>
            )}
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
                data-testid="cinema-mic"
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
                    ? "border border-melori-border bg-melori-elevated text-melori-danger"
                    : "bg-melori-text text-melori-void"
                }`}
              >
                {isMuted ? (
                  <MicOff className="w-6 h-6" />
                ) : (
                  <Mic className="w-6 h-6" />
                )}
              </button>
            )}

            {/* Ask to speak. Hidden for the host, for anyone already on stage
               (they don't need to ask), and whenever the host has set
               hand_raise_mode to "off", or to "followed" and does not follow you --
               see spacesStage.ts). The label is carried by aria + title rather
               than visible text so the comment field keeps the width. */}
            {!isHost && !canSpeakNow && canRaiseHandNow && (
              <button
                type="button"
                onClick={toggleHand}
                data-testid="cinema-raise-hand"
                title={hasRaisedHand ? "Lower hand" : "Ask to speak"}
                aria-label={hasRaisedHand ? "Lower hand" : "Ask to speak"}
                aria-pressed={hasRaisedHand}
                className={`w-12 h-12 shrink-0 flex items-center justify-center rounded-full transition ${
                  hasRaisedHand
                    ? "bg-melori-warning/20 text-melori-warning"
                    : "border border-melori-border bg-melori-elevated text-melori-text hover:bg-white/10"
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


            {/* Right cluster: room-wide reactions. Reactions aimed at ONE
               person come from tapping their seat or circle. */}
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
