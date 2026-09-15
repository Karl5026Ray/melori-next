import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";
import { rateLimit } from "@/lib/rate-limit";
import { isUuid } from "@/lib/validators";
import { findOrCreateDirectConversation } from "@/lib/direct-conversation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/social/spaces/[spaceId]/whisper
//
// Opens a private side conversation between a Cinema room's host (or a
// moderator) and someone in the room, and hands back the conversation it
// belongs to.
//
// WHAT THIS ROUTE DOES AND DOES NOT DO
// It only decides WHETHER these two people may start whispering, and returns
// the thread. It never writes a message. Sending and replying go through the
// existing POST /api/social/messages, which already carries the rate limit,
// the block check, the length cap and content moderation — duplicating that
// here would be a second, weaker path to the same table.
//
// WHY HOST/MODERATOR ONLY
// A whisper is the room's "a quiet word with you" channel, not a private
// messaging surface between strangers who happen to be in the same room.
// Only someone running the room may open one; the other person can reply
// freely once it exists, because by then it is simply their DM thread.
//
// WHY THE THREAD IS A NORMAL DM
// A whisper opens or continues the pair's ordinary 1:1 conversation, so it
// persists, appears in both inboxes, and inherits blocking, moderation and
// the email digest. That is a deliberate product choice, and it has a real
// consequence worth stating plainly: a whisper OUTLIVES the room it was sent
// in. Nothing here makes it ephemeral.

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  const { spaceId: raw } = await params;
  const spaceId = String(raw ?? "").trim();
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId is required" }, { status: 400 });
  }

  const { userId: callerId } = await getRequestMembership(req);
  if (!callerId) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  // Opening a whisper creates a conversation row, so it is rate limited on its
  // own account rather than relying on the message route's limit.
  const rl = rateLimit(`social:whisper:${callerId}`, 5, 0.5);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Slow down — too many whispers started at once." },
      { status: 429 },
    );
  }

  let body: { target_user_id?: unknown };
  try {
    body = (await req.json()) as { target_user_id?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const targetId = String(body.target_user_id ?? "").trim();
  if (!isUuid(targetId)) {
    return NextResponse.json(
      { error: "target_user_id must be a user id" },
      { status: 400 },
    );
  }
  if (targetId === callerId) {
    return NextResponse.json(
      { error: "You cannot whisper to yourself" },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();

  const { data: space, error: spaceErr } = await supabase
    .from("spaces")
    .select("id, host_id, status, room_format")
    .eq("id", spaceId)
    .maybeSingle();

  if (spaceErr) {
    return NextResponse.json({ error: spaceErr.message }, { status: 500 });
  }
  if (!space) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  if (space.room_format !== "cinema") {
    return NextResponse.json(
      { error: "Whispers are a Cinema room feature" },
      { status: 409 },
    );
  }
  if (space.status === "ended") {
    return NextResponse.json({ error: "This room has ended" }, { status: 409 });
  }

  // --- Authority: the caller must be running this room, right now ----------
  let callerIsMod = space.host_id === callerId;
  if (!callerIsMod) {
    const { data: callerRow } = await supabase
      .from("space_participants")
      .select("role, badge, left_at")
      .eq("space_id", spaceId)
      .eq("user_id", callerId)
      .is("left_at", null)
      .maybeSingle();
    const row = callerRow as { role?: string | null; badge?: string | null } | null;
    callerIsMod =
      row?.role === "host" || row?.badge === "mod" || row?.badge === "cohost";
  }
  if (!callerIsMod) {
    return NextResponse.json(
      { error: "Only the host or a moderator can start a whisper" },
      { status: 403 },
    );
  }

  // --- The other person has to actually be in the room ---------------------
  const { data: targetRow } = await supabase
    .from("space_participants")
    .select("user_id, left_at")
    .eq("space_id", spaceId)
    .eq("user_id", targetId)
    .is("left_at", null)
    .maybeSingle();
  if (!targetRow) {
    return NextResponse.json(
      { error: "That person is not in this room" },
      { status: 404 },
    );
  }

  // --- Room bans -----------------------------------------------------------
  // The DM system enforces GLOBAL blocks but knows nothing about per-room
  // bans, so a room's own moderation decision has to be honoured here. Checked
  // in both directions: a host should not be able to open a line to someone
  // they banned, and a banned moderator should not keep room powers.
  const { data: bans } = await supabase
    .from("space_bans")
    .select("user_id")
    .eq("space_id", spaceId)
    .in("user_id", [callerId, targetId]);
  if (bans && bans.length > 0) {
    return NextResponse.json(
      { error: "Whispers are unavailable between these members in this room." },
      { status: 403 },
    );
  }

  // --- Global blocks -------------------------------------------------------
  // Checked before creating a conversation so a blocked pair never ends up
  // with an empty thread sitting in their inboxes.
  const { data: blocks } = await supabase
    .from("member_blocks")
    .select("blocker_id, blocked_id")
    .or(
      `and(blocker_id.eq.${callerId},blocked_id.eq.${targetId}),` +
        `and(blocker_id.eq.${targetId},blocked_id.eq.${callerId})`,
    );
  if (blocks && blocks.length > 0) {
    return NextResponse.json(
      { error: "Messaging is unavailable between these members." },
      { status: 403 },
    );
  }

  const conversation = await findOrCreateDirectConversation(
    supabase,
    callerId,
    targetId,
  );
  if ("error" in conversation) {
    return NextResponse.json({ error: conversation.error }, { status: 500 });
  }

  // A brand-new 1:1 normally opens as a message REQUEST unless the recipient
  // already follows the sender. Inside a room the host is already running,
  // that gate is nonsense — the two people are in the same room and one of
  // them is hosting it — so a room whisper is accepted on creation.
  if (conversation.created) {
    await supabase
      .from("conversations")
      .update({ status: "accepted" })
      .eq("id", conversation.id);
  }

  // Recent history, oldest last, so the sidebar opens with context rather than
  // an empty panel when these two have spoken before.
  const { data: recent } = await supabase
    .from("messages")
    .select("id, sender_id, content, created_at")
    .eq("conversation_id", conversation.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  return NextResponse.json({
    conversation_id: conversation.id,
    created: conversation.created,
    messages: (recent ?? []).slice().reverse(),
  });
}
