// /social/spaces/[spaceId] — a Spaces room.
//
// The room UI itself lives in <RoomScreen>, which this route shares with
// /social/cinema/[roomId]. All this page does is own the URL and make sure the
// room being opened actually belongs at this one: a Cinema room reached
// through a Spaces link is redirected to its own route rather than rendered
// here. That keeps the two products' URLs honest without breaking any link
// that was shared while Cinema still lived under /social/spaces.

import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { CINEMA_ROOM_FORMAT } from "@/lib/cinema";
import { RoomScreen } from "@/components/social/rooms/RoomScreen";

// The format lookup has to happen per request — a room's format is fixed at
// creation, but which room a given id refers to obviously isn't.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SpaceRoomPage(props: {
  params: Promise<{ spaceId: string }>;
}) {
  const { spaceId } = await props.params;

  const { data } = await supabase
    .from("spaces")
    .select("room_format")
    .eq("id", spaceId)
    .maybeSingle();

  if (data?.room_format === CINEMA_ROOM_FORMAT) {
    redirect(`/social/cinema/${spaceId}`);
  }

  // A missing row falls through on purpose. RoomScreen already renders a
  // proper "room not found" state, and a transient read failure should not
  // turn into a hard 404 for a room that exists.
  return <RoomScreen spaceId={spaceId} />;
}
