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
} from "@/lib/agoraClient";
import { Space, SpaceParticipant } from "@/types/social";
import { StageGrid } from "@/components/social/spaces/StageGrid";
import SpaceCommentSection from "@/components/social/spaces/SpaceCommentSection";
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
  const [micDenied, setMicDenied] = useState(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

    const { error } = await supabase.from("space_participants").upsert(
      {
        space_id: spaceId,
        user_id: user.id,
        role: "audience",
        is_muted: true,
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
    // Best-effort participant count bump. Doesn't gate the UX.
    void supabase
      .rpc("increment_space_participants", { space_id: spaceId })
      .then(({ error: rpcErr }) => {
        if (rpcErr) console.warn("increment_space_participants failed", rpcErr);
      });
  }, [user, spaceId, router]);

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

  // Central helper: change mute state locally + on Agora + in the DB.
  const applyMute = useCallback(
    async (nextMuted: boolean) => {
      if (!user) return;
      try {
        await agoraSetMuted(nextMuted);
      } catch (err) {
        console.warn("agora mute failed", err);
      }
      await supabase
        .from("space_participants")
        .update({ is_muted: nextMuted })
        .eq("space_id", spaceId)
        .eq("user_id", user.id);
      setIsMuted(nextMuted);
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
    await applyMute(!isMuted);
  }, [user, isMuted, canParticipate, router, applyMute]);

  // Press-and-hold-to-talk (PTT). While the mic button is held down we
  // unmute; on release we return to whatever mute state the user had before.
  // Short taps still fall through to `toggleMute` (see button onClick).
  const pttPrevMutedRef = useRef<boolean | null>(null);
  const pttHeldRef = useRef(false);
  const pttStartedAtRef = useRef(0);

  const startPTT = useCallback(() => {
    if (!user || !canParticipate) return;
    if (pttHeldRef.current) return;
    pttHeldRef.current = true;
    pttStartedAtRef.current = Date.now();
    pttPrevMutedRef.current = isMuted;
    if (isMuted) void applyMute(false);
  }, [user, canParticipate, isMuted, applyMute]);

  const endPTT = useCallback(
    (opts: { asClick?: boolean } = {}) => {
      if (!pttHeldRef.current) return false;
      const heldMs = Date.now() - pttStartedAtRef.current;
      pttHeldRef.current = false;
      const prevMuted = pttPrevMutedRef.current;
      pttPrevMutedRef.current = null;

      // If the press was quick (< 350ms), treat it as a tap so the user gets
      // the familiar toggle-mute behavior. Otherwise, restore prior state.
      const wasQuickTap = heldMs < 350;
      if (wasQuickTap) {
        // Undo the auto-unmute we did on press, then let toggle run.
        if (prevMuted === false) void applyMute(false);
        else void applyMute(true);
        if (opts.asClick) void toggleMute();
        return true;
      }
      // Long press: restore whatever mute state we came from.
      if (prevMuted !== null) void applyMute(prevMuted);
      return true;
    },
    [applyMute, toggleMute],
  );

  const toggleHand = useCallback(async () => {
    if (!user) return;
    // Raising a hand requests the mic (to speak) → Superfan+ only.
    if (!canParticipate) {
      router.push("/membership");
      return;
    }
    const newHand = !hasRaisedHand;
    await supabase
      .from("space_participants")
      .update({ has_raised_hand: newHand })
      .eq("space_id", spaceId)
      .eq("user_id", user.id);
    setHasRaisedHand(newHand);
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
    await supabase
      .from("spaces")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", spaceId);
    router.push("/social/spaces");
  }, [isHost, spaceId, router]);

  // Lightweight in-room reactions (host + audience). Purely visual — burst
  // an emoji into a floating list that fades after ~2s.
  const sendReaction = useCallback((emoji: string) => {
    setReactions((prev) => [...prev, `${Date.now()}:${emoji}`]);
    setTimeout(() => {
      setReactions((prev) => prev.slice(1));
    }, 2000);
  }, []);

  // ---- Agora audio lifecycle -----------------------------------------------
  // We (re)join whenever role changes. Audience → subscriber, speaker/host →
  // publisher. Superfan+ only (server enforces on token endpoint).
  useEffect(() => {
    if (!isJoined || !user || !space?.agora_channel || !canParticipate) return;

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
          channel: space.agora_channel!,
          role,
          spaceId,
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

  // Component unmount → leave Agora cleanly.
  useEffect(() => {
    return () => {
      void agoraLeave();
    };
  }, []);

  const speakers = participants.filter(
    (p) => p.role === "host" || p.role === "speaker"
  );
  const audience = participants.filter((p) => p.role === "audience");
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
            <h2 className="font-bold text-lg truncate">{space.title}</h2>
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
                <StageGrid participants={speakers} />

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
                <StageGrid participants={audience} size="sm" />
              </div>
            </>
          )}

          {/* Per-space comment thread. Public reads, Superfan+ posts. */}
          <SpaceCommentSection spaceId={spaceId} />
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

      {isJoined && (
        <div className="border-t border-melori-border p-4 md:p-6 bg-melori-void/95 backdrop-blur shrink-0">
          <div className="max-w-2xl mx-auto flex items-center justify-between">
            <button
              onClick={handleLeave}
              className="px-6 py-3 rounded-full bg-melori-elevated border border-melori-border text-sm font-medium hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 transition flex items-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              Leave Quietly
            </button>

            <div className="flex items-center gap-3">
              {/* Mic button.
                 - Tap: toggle mute (classic behavior).
                 - Press & hold: push-to-talk. Unmutes for as long as you're
                   holding it, then restores the previous mute state on
                   release. Works with mouse and touch. */}
              <button
                type="button"
                onClick={(e) => {
                  // If a long-press was in progress, endPTT already handled it.
                  if (endPTT({ asClick: false })) {
                    e.preventDefault();
                    return;
                  }
                  void toggleMute();
                }}
                onMouseDown={startPTT}
                onMouseUp={() => endPTT()}
                onMouseLeave={() => endPTT()}
                onTouchStart={(e) => {
                  e.preventDefault();
                  startPTT();
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  endPTT();
                }}
                onTouchCancel={() => endPTT()}
                aria-label={
                  isMuted
                    ? "Unmute (tap) or hold to talk"
                    : "Mute (tap) or hold to talk"
                }
                title="Tap to toggle mute · Press and hold to talk"
                className={`p-3 rounded-full border border-melori-border transition select-none touch-none ${
                  isMuted
                    ? "bg-red-500/20 text-red-400"
                    : "bg-melori-elevated text-melori-muted"
                }`}
              >
                {isMuted ? (
                  <MicOff className="w-5 h-5" />
                ) : (
                  <Mic className="w-5 h-5" />
                )}
              </button>

              {!isHost && (
                <button
                  onClick={toggleHand}
                  className={`p-3 rounded-full border transition ${
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
                  className="px-4 py-3 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 text-sm font-medium hover:bg-red-500/30 transition"
                >
                  End Space
                </button>
              )}

              {/* Quick reactions. Renders an emoji picker menu on click. */}
              <div className="relative">
                <details className="group">
                  <summary className="list-none cursor-pointer p-3 rounded-full bg-melori-elevated border border-melori-border text-melori-muted hover:text-melori-text transition flex items-center justify-center">
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
