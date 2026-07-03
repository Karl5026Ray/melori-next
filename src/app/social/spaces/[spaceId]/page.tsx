"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { useCanParticipate } from "@/components/social/UpgradePrompt";
import { Space, SpaceParticipant } from "@/types/social";
import { StageGrid } from "@/components/social/spaces/StageGrid";
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

    if (!error) {
      setIsJoined(true);
      await supabase.rpc("increment_space_participants", { space_id: spaceId });
    }
  }, [user, spaceId, router]);

  const handleLeave = useCallback(async () => {
    if (!user) return;

    await supabase
      .from("space_participants")
      .update({ left_at: new Date().toISOString() })
      .eq("space_id", spaceId)
      .eq("user_id", user.id);

    setIsJoined(false);
    await supabase.rpc("decrement_space_participants", { space_id: spaceId });
    router.push("/social/spaces");
  }, [user, spaceId, router]);

  const toggleMute = useCallback(async () => {
    if (!user) return;
    // Speaking is a vocal-conversation action → Superfan+ only. (The Agora token
    // endpoint enforces this server-side; free users cannot obtain a publisher
    // token even if this button were bypassed.)
    if (!canParticipate) {
      router.push("/membership");
      return;
    }
    const newMuted = !isMuted;
    await supabase
      .from("space_participants")
      .update({ is_muted: newMuted })
      .eq("space_id", spaceId)
      .eq("user_id", user.id);
    setIsMuted(newMuted);
  }, [user, spaceId, isMuted, canParticipate, router]);

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
        <div className="flex items-center gap-2">
          <button
            className="p-2.5 hover:bg-melori-elevated rounded-full transition"
            title="Share"
          >
            <Share2 className="w-4 h-4 text-melori-muted" />
          </button>
          <button
            className="p-2.5 hover:bg-melori-elevated rounded-full transition"
            title="More"
          >
            <MoreHorizontal className="w-4 h-4 text-melori-muted" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-2xl mx-auto">
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
              </div>

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
                        {isHost && (
                          <button className="text-[10px] bg-melori-purple/20 text-melori-purple px-2 py-1 rounded-full hover:bg-melori-purple/30 transition">
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
        </div>
      </div>

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
              <button
                onClick={toggleMute}
                className={`p-3 rounded-full border border-melori-border transition ${
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
                <button className="px-4 py-3 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 text-sm font-medium hover:bg-red-500/30 transition">
                  End Space
                </button>
              )}

              <button className="p-3 rounded-full bg-melori-elevated border border-melori-border text-melori-muted hover:text-melori-text transition">
                <Plus className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
