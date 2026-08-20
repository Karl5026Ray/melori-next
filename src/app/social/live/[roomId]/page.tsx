"use client";

// MM Faces — a single live video room. Fetches the room (a `spaces` row with a
// live_* room_format), resolves the viewer's tier, and hands off to the
// LiveRoom engine. Superfan-or-better is required to join (same gate as MM
// Spaces); the token endpoint enforces this server-side too.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { useCanParticipate } from "@/components/social/UpgradePrompt";
import { isArtistSubscriber } from "@/lib/membership";
import LiveRoom, { type LiveMode } from "@/components/social/faces/LiveRoom";
import type { VideoTier } from "@/lib/livekitVideoClient";
import { Loader2 } from "lucide-react";

interface RoomRow {
  id: string;
  title: string;
  topic: string | null;
  room_format: string | null;
  status: string;
  host_id: string;
  duration_minutes: number | null;
  max_capacity: number | null;
  host_settings: { max_on_camera?: number } | null;
  host?: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
}

export default function LiveRoomPage() {
  const params = useParams();
  const roomId = params.roomId as string;
  const { user, isLoading: authLoading } = useAuth();
  const canParticipate = useCanParticipate();

  const [room, setRoom] = useState<RoomRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Whether a real Supabase session exists when no profile is loaded. null =
  // not yet checked. Prevents flashing the "Sign in to join" wall at a
  // signed-in user (host or guest) whose profile row hasn't hydrated yet — the
  // intermittent bounce this page used to cause after Go Live / on refresh.
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    const fetchRoom = async () => {
      const { data, error: err } = await supabase
        .from("spaces")
        .select(
          `id, title, topic, room_format, status, host_id, duration_minutes,
           max_capacity, host_settings,
           host:profiles(id, display_name, avatar_url)`,
        )
        .eq("id", roomId)
        .maybeSingle();
      if (!active) return;
      if (err || !data) {
        setError("This live room could not be found.");
      } else if (data.status !== "live") {
        setError("This live room has ended.");
        setRoom(data as unknown as RoomRow);
      } else {
        setError(null);
        setRoom(data as unknown as RoomRow);
      }
      setLoading(false);
    };

    fetchRoom();

    // Server-authoritative host auto-promotion transfers spaces.host_id and
    // flips a participant's role when the host leaves. Refetch the room on any
    // participant change so the new host's client picks up host_id (→ host
    // controls) live, and everyone sees a graceful "ended" state if the room
    // was closed for lack of a successor.
    const channel = supabase
      .channel(`live_room:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "space_participants",
          filter: `space_id=eq.${roomId}`,
        },
        () => {
          void fetchRoom();
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  // Resolve the caller's real auth state when no profile is in context. Only
  // after auth has finished loading do we ask Supabase whether a session
  // actually exists, so a not-yet-hydrated user is treated as "still resolving"
  // rather than "signed out".
  useEffect(() => {
    if (user) {
      setHasSession(true);
      return;
    }
    if (authLoading) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setHasSession(!!data.session);
    });
    return () => {
      active = false;
    };
  }, [user, authLoading]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-brand-background py-24">
        <Loader2 className="h-6 w-6 animate-spin text-brand-primary" />
      </div>
    );
  }

  if (error || !room || room.status !== "live") {
    return (
      <div className="flex flex-1 items-center justify-center bg-brand-background px-4 py-24">
        <div className="w-full max-w-md rounded-2xl border border-brand-border bg-brand-surface p-8 text-center">
          <h1 className="text-xl font-bold text-text-primary">
            {error ?? "Room unavailable"}
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            The live may have wrapped up. Explore other rooms or start your own.
          </p>
          <Link
            href="/social/live"
            className="mt-5 inline-block rounded-full bg-brand-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-primary-dark"
          >
            Back to MM Faces
          </Link>
        </div>
      </div>
    );
  }

  if (!user) {
    // No profile loaded. If auth is still resolving OR a real session exists
    // (authenticated, profile just hasn't hydrated), keep showing the loader —
    // do NOT flash the sign-in wall, which is what intermittently bounced
    // signed-in hosts/joiners. Only show sign-in once we've confirmed there is
    // genuinely no session.
    if (authLoading || hasSession !== false) {
      return (
        <div className="flex flex-1 items-center justify-center bg-brand-background py-24">
          <Loader2 className="h-6 w-6 animate-spin text-brand-primary" />
        </div>
      );
    }
    return (
      <div className="flex flex-1 items-center justify-center bg-brand-background px-4 py-24">
        <div className="w-full max-w-md rounded-2xl border border-brand-border bg-brand-surface p-8 text-center">
          <h1 className="text-xl font-bold text-text-primary">Sign in to join</h1>
          <p className="mt-2 text-sm text-text-secondary">
            You need to be signed in to join a live room.
          </p>
          <Link
            href={`/social/auth?next=${encodeURIComponent(`/social/live/${roomId}`)}`}
            className="mt-5 inline-block rounded-full bg-brand-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-primary-dark"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const isHost = user.id === room.host_id;
  // Option 1 (freemium): ANY signed-in user may WATCH a live room. Going on
  // camera / speaking is the paid perk, enforced by the token endpoint and by
  // hiding the publish controls for non-Superfans (canPublish below).
  const tier: VideoTier = isArtistSubscriber(user) ? "artist" : "free";
  const hostName =
    room.host?.display_name || (isHost ? "You" : "Host") || "Host";

  const mode: LiveMode =
    room.room_format === "live_duo"
      ? "live_duo"
      : room.room_format === "live_group"
        ? "live_group"
        : "live_solo";
  const maxOnCamera =
    room.host_settings?.max_on_camera ??
    room.max_capacity ??
    (mode === "live_duo" ? 2 : mode === "live_group" ? 9 : 1);

  return (
    <LiveRoom
      spaceId={room.id}
      hostId={room.host_id}
      title={room.title}
      hostName={hostName}
      hostAvatar={room.host?.avatar_url}
      tier={tier}
      durationMinutes={room.duration_minutes}
      mode={mode}
      maxOnCamera={maxOnCamera}
      canPublish={isHost || canParticipate}
    />
  );
}
