"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { useCanParticipate } from "@/components/social/UpgradePrompt";
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
import { Space, SpaceParticipant, getRoomFormatConfig } from "@/types/social";
import { Badge } from "@/components/social/ui/Badge";
import { StageGrid } from "@/components/social/spaces/StageGrid";
import RoomChat from "@/components/social/rooms/RoomChat";
import {
  ArrowLeft,
  Share2,
  MoreHorizontal,
  LogOut,
  Mic,
  MicOff,
  Hand,
  Plus,
  Volume2,
  Copy,
  Flag,
  Trash2,
  VolumeX,
  UserMinus,
} from "lucide-react";
import Link from "next/link";

export default function SpaceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const canParticipate = useCanParticipate();
  const spaceId = params.spaceId as string;

  const [space, setSpace] = useState<Space | null>(null);
  const [participants, setParticipants] = useState<SpaceParticipant[]>([]);
  const [isJoined, setIsJoined] = useState(false);
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
  const [micDenied, setMicDenied] = useState(false);   const [reconnecting, setReconnecting] = useState(false);
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

  useEffect(() => {
    if (user && participants.length > 0) {
      const myParticipation = participants.find(
        (p) => p.user_id === user.id && !p.left_at
      );
      if (myParticipation) {
        setIsJoined(true);
        setIsMuted(myParticipation.is_muted);
        setHasRaisedHand(myParticipation.has_raised_hand);
      }
    }
  }, [user, participants]);
  
  const handleJoin = useCallback(async () => {
    if (!user) {
      router.push("/social/auth");
      return;
    }

    // Stage placement is gated on membership: the host and any paid/elevated
    // member (admin, artist, superfan) start on stage; free members join as
    // listeners in the audience and can raise a hand to be promoted. Preserve an
    // existing on-stage role on re-join so we never demote someone who was
    // already speaking (or a free member the host promoted to speaker).
    const isHostJoining = user.id === space?.host_id;
    const stageRoles = ["admin", "artist", "superfan"];
    const isElevated = stageRoles.includes((((user as any).role as string) || "").toLowerCase());
    const existing = participants.find((p) => p.user_id === user.id);
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

    const { error } = await supabase.from("space_participants").upsert(
      {
        space_id: spaceId,
        user_id: user.id,
        role: joinRole,
        is_muted: joinMuted,
        joined_at: new Date().toISOString(),
        left_at: null,
      },
      { onConflict: "space_id,user_id" }
    );

    if (error) {
      // Show the real reason (RLS, network, etc.) instead of pretending we joined.
      setShareToast(error.message || "Could not join this space");
      setTimeout(() => setShareToast(null), 2500);
      return;
    }
    setIsJoined(true);
    // Joining is a user gesture. Listeners/audience never press the mic button,
    // so unlock remote audio playback here so they can hear speakers.
    void agoraEnsureAudio();
    // Best-effort participant count bump. Doesn't gate the UX.
    void supabase
      .rpc("increment_space_participants", { space_id: spaceId })
      .then(({ error: rpcErr }) => {
        if (rpcErr) console.warn("increment_space_participants failed", rpcErr);
      });
  }, [user, spaceId, router, space, participants]);    useEffect(() => { if (isJoined) return; if (!user || !space) return; const elevated = ["admin", "artist", "superfan"].includes(((user as any).role || "").toLowerCase()); if (user.id === space.host_id || elevated) void handleJoin(); }, [isJoined, user, space, handleJoin]);

  const handleLeave = useCallback(async () => {
    if (!user) return;

    // Release the mic + leave the Agora channel first so the audio session
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
    router.push("/social/spaces");
  }, [user, spaceId, router]); 

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
    // Speaking is a vocal-conversation action → Superfan+ only. (The Agora token
    // endpoint enforces this server-side; free users cannot obtain a publisher
    // token even if this button were bypassed.)
    if (!canParticipate) {
      router.push("/membership");
      return;
    }
    // Keyboard/click activation is also a user gesture — unlock playback here
    // too so non-pointer paths still enable remote audio.
    void agoraEnsureAudio();
    await applyMute(!isMuted);
  }, [user, isMuted, canParticipate, router, applyMute]);

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
    if (!user || !canParticipate) return;
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
  }, [user, canParticipate, isMuted, applyMute]);

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
    if (!user) return;
    // Raising a hand requests the mic (to speak) → Superfan+ only.
    if (!canParticipate) {
      router.push("/membership");
      return;
    }
    const newHand = !hasRaisedHand;
    setHasRaisedHand(newHand);
    // Instant fan-out so the host/room sees the hand go up without waiting for
    // the Supabase Realtime round-trip. The DB write below stays the source of
    // truth (the host's promote flow reads `has_raised_hand`).
    void pubnubPublishSignal(spaceId, { type: "hand", raised: newHand });
    await supabase
      .from("space_participants")
      .update({ has_raised_hand: newHand })
      .eq("space_id", spaceId)
      .eq("user_id", user.id);
  }, [user, spaceId, hasRaisedHand, canParticipate, router]);

  const isHost = user?.id === space?.host_id;

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
      await supabase
        .from("space_participants")
        .update({ role: "speaker", has_raised_hand: false })
        .eq("space_id", spaceId)
        .eq("user_id", participantUserId);
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

  const handleEndSpace = useCallback(async () => {
    if (!isHost) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm("End this space for everyone?")
    ) {
      return;
    }
    try {
      await agoraLeave();
    } catch {
      /* noop */
    }
    await authFetch(`/api/social/spaces/${spaceId}/end`, { method: "POST", headers: { "Content-Type": "application/json" } });
    router.push("/social/spaces");
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
      void pubnubPublishSignal(spaceId, {
        type: "reaction",
        emoji,
        target: targetId,
      });
    },
    [spaceId, spawnTargetedReaction],
  );

  // ---- Agora audio lifecycle -----------------------------------------------
  // We (re)join whenever role changes. Audience → subscriber, speaker/host →
  // publisher. Option 1 (freemium): any signed-in user joins as a SUBSCRIBER to
  // LISTEN for free; only speakers/hosts publish, and the token endpoint gates
  // publisher tokens to Superfan+ so free users can't obtain one.
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
          onReconnecting: () => setReconnecting(true),         onReconnected: () => setReconnecting(false),         onError: (err) => {
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
            // with no eligible successor). Bounce out.
            if (payload?.event === "space-ended") {
              router.push("/social/spaces");
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
  const raisedHands = participants.filter(
    (p) => p.has_raised_hand && p.role === "audience"
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
        <Link href="/social/spaces" className="text-melori-purple hover:underline">
          Back to Spaces
        </Link>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full animate-fade-in">
      <div className="border-b border-melori-border p-4 md:p-6 flex items-center justify-between bg-melori-void/95 backdrop-blur z-10 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/social/spaces"
            className="p-2 hover:bg-melori-elevated rounded-lg transition shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-lg truncate">{space.title}</h2>
              {(() => {
                const format = getRoomFormatConfig(space.room_format);
                return (
                  <Badge variant={format.variant} className="shrink-0">
                    {format.label}
                  </Badge>
                );
              })()}
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
            <p className="text-xs text-melori-muted truncate">{space.topic}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 relative">
          <button
            type="button"
            onClick={handleShare}
            className="p-2.5 hover:bg-melori-elevated rounded-full transition"
            title="Share"
            aria-label="Share this space"
          >
            <Share2 className="w-4 h-4 text-melori-muted" />
          </button>
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            className="p-2.5 hover:bg-melori-elevated rounded-full transition"
            title="More"
          >
            <MoreHorizontal className="w-4 h-4 text-melori-muted" />
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
                <button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    void handleEndSpace();
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition"
                >
                  <Trash2 className="w-4 h-4" />
                  End space
                </button>
              )}
            </div>
          )}
          {shareToast && (
            <span className="absolute right-0 -bottom-9 rounded-full bg-melori-purple/90 text-white text-xs font-medium px-3 py-1.5 shadow-lg">
              {shareToast}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-8">
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
          {!isJoined ? (
            <div className="text-center py-12">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-melori-purple/20 to-melori-pink/20 flex items-center justify-center mx-auto mb-4">
                <Volume2 className="w-10 h-10 text-melori-purple" />
              </div>
              <h3 className="text-xl font-bold mb-2">{space.title}</h3>
              <p className="text-melori-muted mb-6">
                {space.participant_count} people listening
              </p>
              <button
                onClick={handleJoin}
                className="btn-primary px-8 py-4 rounded-full font-bold text-lg shadow-lg"
              >
                Join Space
              </button>
            </div>
          ) : (
            <>
              <div className="mb-8">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xs font-semibold text-melori-muted uppercase tracking-wider">
                    On Stage
                  </h3>
                  {isHost && (
                    <span className="text-xs text-melori-purple bg-melori-purple/10 px-2 py-1 rounded-lg">
                      Host
                    </span>
                  )}
                </div>
                {reconnecting && (<div className="mb-3 px-4 py-2 rounded-lg bg-yellow-500/15 border border-yellow-500/40 text-yellow-200 text-sm text-center">Reconnecting to audio…</div>)}<StageGrid participants={speakers} onReactToParticipant={setReactTarget} reactionBursts={targetedReactions} />

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

              <div>
                <h3 className="text-xs font-semibold text-melori-muted uppercase tracking-wider mb-4">
                  Audience ({audience.length})
                </h3>
                {reconnecting && (<div className="mb-3 px-4 py-2 rounded-lg bg-yellow-500/15 border border-yellow-500/40 text-yellow-200 text-sm text-center">Reconnecting to audio…</div>)}<StageGrid participants={audience} size="sm" onReactToParticipant={setReactTarget} reactionBursts={targetedReactions} />
              </div>
            </>
          )}

          {/* Shared room chat (auto-scroll, new-message pill, grouping, sticky
              composer). Bounded height so its internal scroll + composer behave
              inside the page's vertical flow. Public reads, Superfan+ posts. */}
          <div className="mt-6 flex h-[70vh] flex-col overflow-hidden rounded-2xl border border-melori-border bg-melori-elevated/40">
            <RoomChat spaceId={spaceId} accent="purple" className="flex-1" />
          </div>
        </div>
      </div>

      {/* Floating reaction bursts */}
      {reactions.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-32 z-30 flex justify-center gap-3">
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
        <div className="pointer-events-none fixed inset-x-0 bottom-44 z-30 flex justify-center">
          <span
            className="rounded-full bg-melori-warning/90 text-melori-void text-xs font-semibold px-4 py-2 shadow-lg"
            data-testid="toast-peer-hand"
          >
            {peerHandToast}
          </span>
        </div>
      )}

      {/* Per-person reaction picker: tap an avatar to react to that person. */}
      {reactTarget && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center"
          onClick={() => setReactTarget(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`React to ${reactTarget.user?.display_name ?? "participant"}`}
        >
          <div
            className="w-full max-w-sm rounded-t-2xl border border-melori-border bg-melori-void p-5 shadow-xl sm:rounded-2xl animate-fade-in"
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

      {isJoined && (
        <div className="border-t border-melori-border p-4 md:p-6 bg-melori-void/95 backdrop-blur shrink-0">
          {/* Control bar: the mic sits ALONE, centered and prominent. The Leave
             button is pinned to the bottom-left and the secondary controls
             (raise-hand / End Space + reactions) to the bottom-right, so
             nothing flanks the mic. */}
          <div className="max-w-2xl mx-auto relative flex items-center justify-center min-h-[64px]">
            {/* Leave — bottom-left corner. */}
            <button
              onClick={handleLeave}
              className="absolute left-0 top-1/2 -translate-y-1/2 px-4 py-3 min-h-[44px] rounded-full bg-melori-elevated border border-melori-border text-sm font-medium hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 transition flex items-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Leave Quietly</span>
            </button>

            {/* Mic button — centered focal control. Only speakers (canParticipate)
               see it; listeners get the reactions control only.
                 - Tap: toggle mute (classic behavior).
                 - Press & hold: push-to-talk. Unmutes for as long as you're
                   holding it, then restores the previous mute state on
                   release. Works with mouse and touch. */}
            {canParticipate && (
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
                className={`p-5 rounded-full border shadow-lg transition select-none touch-none ${
                  isMuted
                    ? "bg-red-500/20 text-red-400 border-red-500/30"
                    : "bg-melori-purple text-white border-melori-purple"
                }`}
              >
                {isMuted ? (
                  <MicOff className="w-7 h-7" />
                ) : (
                  <Mic className="w-7 h-7" />
                )}
              </button>
            )}

            {/* Right corner: raise-hand / End Space + quick reactions. */}
            <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-2">
              {!isHost && (
                <button
                  onClick={toggleHand}
                  aria-label="Raise hand"
                  className={`p-3 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full border transition ${
                    hasRaisedHand
                      ? "bg-melori-warning/20 text-melori-warning border-melori-warning/30"
                      : "bg-melori-elevated text-melori-muted border-melori-border"
                  }`}
                >
                  <Hand className="w-5 h-5" />
                </button>
              )}

              {isHost && (
                <button
                  type="button"
                  onClick={handleEndSpace}
                  className="px-4 py-3 min-h-[44px] rounded-full bg-red-500/20 text-red-400 border border-red-500/30 text-sm font-medium hover:bg-red-500/30 transition"
                >
                  End Space
                </button>
              )}

              {/* Quick reactions (global, center-screen burst). Emoji picker on click. */}
              <div className="relative">
                <details className="group">
                  <summary className="list-none cursor-pointer p-3 min-w-[44px] min-h-[44px] rounded-full bg-melori-elevated border border-melori-border text-melori-muted hover:text-melori-text transition flex items-center justify-center">
                    <Plus className="w-5 h-5" />
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
