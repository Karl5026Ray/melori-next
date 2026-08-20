// Audio Spaces room route.
//
// The screen itself lives in RoomScreen, shared with /social/cinema/[roomId].
// This route's only added job is to bounce a Cinema room to its own URL, so an
// old link, a share, or a stale tile still lands the viewer in Cinema instead
// of presenting a watch party as part of Spaces.

import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { CINEMA_ROOM_FORMAT } from "@/lib/cinema";
import { CONCERT_BATTLE_ROOM_FORMAT } from "@/lib/concertBattle";
import RoomScreen from "@/components/social/rooms/RoomScreen";

// Queries Supabase per request; must not be statically prerendered, and must
// not serve a cached format for a room whose row can change.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SpaceRoomPage({
  params,
}: {
  params: Promise<{ spaceId: string }>;
}) {
  const { spaceId } = await params;

  const { data } = await supabase
    .from("spaces")
    .select("room_format")
    .eq("id", spaceId)
    .maybeSingle();

  // Only redirect on a row we actually read. A failed or empty read falls
  // through to RoomScreen, which owns the real not-found / ended states —
  // guessing here would strand people on the wrong route during a blip.
  if (data?.room_format === CINEMA_ROOM_FORMAT) {
    redirect(`/social/cinema/${spaceId}`);
  }
  if (data?.room_format === CONCERT_BATTLE_ROOM_FORMAT) {
    redirect(`/social/concert/${spaceId}`);
  }

  return <RoomScreen spaceId={spaceId} />;
}
