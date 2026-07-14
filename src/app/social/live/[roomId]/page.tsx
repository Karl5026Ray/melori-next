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
  const { user } = useAuth();
  const canParticipate = useCanParticipate();

  const [room, setRoom] = useState<RoomRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
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
        setRoom(data as unknown as RoomRow);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [roomId]);

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
    return (
      <div className="flex flex-1 items-center justify-center bg-brand-background px-4 py-24">
        <div className="w-full max-w-md rounded-2xl border border-brand-border bg-brand-surface p-8 text-center">
          <h1 className="text-xl font-bold text-text-primary">Sign in to join</h1>
          <p className="mt-2 text-sm text-text-secondary">
            You need to be signed in to join a live room.
          </p>
          <Link
            href="/social/auth"
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
    (mode === "live_duo" ? 2 : mode === "live_group" ? 8 : 1);

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
