// Cinema room route.
//
// Cinema rooms are `spaces` rows with room_format='cinema' and render Cinema's
// own screen, CinemaRoomScreen. Since 2 Oct 2026 Cinema and Spaces share no
// room code; they share only plumbing (tables, moderation and ban routes,
// LiveKit, PubNub). A watch party lives at /social/cinema/<id> and never
// presents itself as a Space.

import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { CINEMA_ROOM_FORMAT } from "@/lib/cinema";
import CinemaRoomScreen from "@/components/social/cinema/CinemaRoomScreen";

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

  return <CinemaRoomScreen spaceId={roomId} />;
}
