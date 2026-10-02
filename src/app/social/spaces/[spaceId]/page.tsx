// Audio Spaces room route.
//
// Renders Spaces' own room screen (SpacesRoomScreen). Since 2 Oct 2026 Spaces
// and Cinema share no room code. This route also bounces a Cinema or Concert
// room to its own URL, so an old link, a share, or a stale tile still lands
// the viewer in the right product.

import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { CINEMA_ROOM_FORMAT } from "@/lib/cinema";
import { CONCERT_BATTLE_ROOM_FORMAT } from "@/lib/concertBattle";
import SpacesRoomScreen from "@/components/social/spaces/SpacesRoomScreen";

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
  // through to SpacesRoomScreen, which owns the real not-found / ended states —
  // guessing here would strand people on the wrong route during a blip.
  if (data?.room_format === CINEMA_ROOM_FORMAT) {
    redirect(`/social/cinema/${spaceId}`);
  }
  if (data?.room_format === CONCERT_BATTLE_ROOM_FORMAT) {
    redirect(`/social/concert/${spaceId}`);
  }

  return <SpacesRoomScreen spaceId={spaceId} />;
}
