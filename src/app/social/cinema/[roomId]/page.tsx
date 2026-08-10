// Cinema room route.
//
// Cinema rooms are `spaces` rows with room_format='cinema' and render the same
// RoomScreen as audio Spaces — the room engine, roles, raise-hand queue,
// moderation, bans, camera slots (migration 054) and teardown stay shared.
// What this route buys is a URL that matches the product: a watch party is
// reached at /social/cinema/<id> and never presents itself as a Space.

import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { CINEMA_ROOM_FORMAT } from "@/lib/cinema";
import RoomScreen from "@/components/social/rooms/RoomScreen";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CinemaRoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;

  const { data } = await supabase
    .from("spaces")
    .select("room_format")
    .eq("id", roomId)
    .maybeSingle();

  // Mirror of the guard on the Spaces route, and deliberately conditional on
  // `data` existing. If the read fails we render Cinema anyway rather than
  // redirecting — bouncing someone out of a Cinema room into Spaces on a
  // transient error is the exact confusion this split exists to end.
  if (data && data.room_format !== CINEMA_ROOM_FORMAT) {
    redirect(`/social/spaces/${roomId}`);
  }

  return <RoomScreen spaceId={roomId} />;
}
