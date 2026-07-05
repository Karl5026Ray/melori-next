import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/social/messages — Send a message / reply in a conversation.
// Commenting/replying is participation and requires an active Superfan-or-better
// member. The sender is taken from the verified token, never the request body.
export async function POST(req: NextRequest) {
  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;
  const { membership } = guard;

  try {
    const body = await req.json();
    const conversationId = String(body.conversation_id ?? "").trim();
    const content = String(body.content ?? "").trim();
    if (!conversationId || !content) {
      return NextResponse.json(
        { error: "conversation_id and content are required" },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();

    // Membership + block enforcement in one pass. Fetch all conversation
    // members; refuse if the caller is not a participant, then check for
    // blocks in either direction with the other participants.
    const { data: members } = await supabase
      .from("conversation_members")
      .select("user_id")
      .eq("conversation_id", conversationId);
    const memberIds = (members ?? [])
      .map((m) => m.user_id as string)
      .filter((id): id is string => Boolean(id));

    if (!memberIds.includes(membership.userId!)) {
      return NextResponse.json(
        { error: "You are not a participant in this conversation." },
        { status: 403 },
      );
    }

    const otherIds = memberIds.filter((id) => id !== membership.userId);
    if (otherIds.length > 0) {
      const { data: blocks } = await supabase
        .from("member_blocks")
        .select("blocker_id, blocked_id")
        .or(
          `and(blocker_id.eq.${membership.userId},blocked_id.in.(${otherIds.join(",")})),` +
            `and(blocked_id.eq.${membership.userId},blocker_id.in.(${otherIds.join(",")}))`
        );
      if (blocks && blocks.length > 0) {
        return NextResponse.json(
          { error: "Messaging is unavailable between these members." },
          { status: 403 }
        );
      }
    }

    const { data, error } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        sender_id: membership.userId,
        content,
      })
      .select()
      .single();

    if (error) {
      console.error("Send message error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ message: data });
  } catch (err: any) {
    console.error("Send message exception:", err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to send message" },
      { status: 500 },
    );
  }
}
