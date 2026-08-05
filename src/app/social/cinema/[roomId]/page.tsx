// /social/cinema/[roomId] — a Cinema room.
//
// Cinema's own front door. Before this route existed, a Cinema room was served
// from /social/spaces/[spaceId], so every Cinema link read as a Spaces link
// and the two formats shared one URL space. They no longer do.
//
// The room UI is <RoomScreen>, shared with the Spaces route; what differs is
// the URL, the format guard below, and what RoomScreen renders once it knows
// the room is Cinema (the shared screen, the host/guest video seats).

import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { CINEMA_ROOM_FORMAT } from "@/lib/cinema";
import { RoomScreen } from "@/components/social/rooms/RoomScreen";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CinemaRoomPage(props: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await props.params;

  const { data } = await supabase
    .from("spaces")
    .select("room_format")
    .eq("id", roomId)
    .maybeSingle();

  // The mirror of the guard on the Spaces route: a non-Cinema room reached
  // through a Cinema URL belongs under /social/spaces. Only redirect when the
  // row actually came back — a failed read should not bounce someone out of a
  // Cinema room and into Spaces, which is the exact confusion this split is
  // meant to end.
  if (data && data.room_format !== CINEMA_ROOM_FORMAT) {
    redirect(`/social/spaces/${roomId}`);
  }

  return <RoomScreen spaceId={roomId} />;
}
