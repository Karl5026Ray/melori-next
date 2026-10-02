import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";
import { isUuid } from "@/lib/validators";
import { canDeleteRoomComment } from "@/lib/cinemaStage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DELETE /api/social/spaces/[spaceId]/comments/[commentId]
//
// Removes one room chat message. Allowed for the message's author, the room's
// host, or a badged moderator / co-host of that room — decided from the DB,
// never from client claims. Every open room drops the line through the
// realtime DELETE event useRoomComments listens for.
export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ spaceId: string; commentId: string }> },
) {
  const { spaceId, commentId } = await props.params;
  if (!isUuid(spaceId) || !isUuid(commentId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const { userId: callerId } = await getRequestMembership(req);
  if (!callerId) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();

  const [{ data: comment }, { data: space }, { data: callerRow }] = await Promise.all([
    supabase
      .from("space_comments")
      .select("id, user_id, space_id")
      .eq("id", commentId)
      .eq("space_id", spaceId)
      .maybeSingle(),
    supabase.from("spaces").select("id, host_id").eq("id", spaceId).maybeSingle(),
    supabase
      .from("space_participants")
      .select("badge")
      .eq("space_id", spaceId)
      .eq("user_id", callerId)
      .is("left_at", null)
      .maybeSingle(),
  ]);

  if (!space) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  // Already gone (another moderator got there first) is success, not an error.
  if (!comment) return NextResponse.json({ ok: true });

  const allowed = canDeleteRoomComment({
    callerId,
    authorId: (comment.user_id as string | null) ?? null,
    hostId: space.host_id as string,
    callerBadge: (callerRow?.badge as string | null) ?? null,
  });
  if (!allowed) {
    return NextResponse.json(
      { error: "Only the host, a moderator or the author can delete this message" },
      { status: 403 },
    );
  }

  const { error } = await supabase
    .from("space_comments")
    .delete()
    .eq("id", commentId)
    .eq("space_id", spaceId);
  if (error) {
    console.error("Space comment delete error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
