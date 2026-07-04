import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/social/conversations/start
// Body: { recipient_id: string }
// Finds an existing 1:1 conversation between the caller and recipient, or
// creates one. Refuses if either party has blocked the other.
export async function POST(req: NextRequest) {
  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;
  const { membership } = guard;
  const me = membership.userId;

  const body = await req.json().catch(() => ({}));
  const recipientId = String(body.recipient_id ?? "").trim();
  if (!recipientId) {
    return NextResponse.json({ error: "recipient_id required" }, { status: 400 });
  }
  if (recipientId === me) {
    return NextResponse.json({ error: "You can't message yourself" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Refuse if a block exists in either direction.
  const { data: block } = await supabase
    .from("member_blocks")
    .select("blocker_id")
    .or(
      `and(blocker_id.eq.${me},blocked_id.eq.${recipientId}),` +
        `and(blocker_id.eq.${recipientId},blocked_id.eq.${me})`
    )
    .maybeSingle();
  if (block) {
    return NextResponse.json(
      { error: "Messaging is unavailable between these members." },
      { status: 403 }
    );
  }

  // Find an existing 1:1 conversation both users belong to.
  const { data: myRows } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", me);
  const myConversationIds = (myRows ?? []).map((r) => r.conversation_id as string);

  let conversationId: string | null = null;
  if (myConversationIds.length > 0) {
    const { data: shared } = await supabase
      .from("conversation_members")
      .select("conversation_id")
      .eq("user_id", recipientId)
      .in("conversation_id", myConversationIds)
      .limit(1);
    if (shared && shared.length > 0) {
      conversationId = shared[0].conversation_id as string;
    }
  }

  // Otherwise create a new conversation with both members.
  if (!conversationId) {
    const { data: convo, error: convoErr } = await supabase
      .from("conversations")
      .insert({})
      .select("id")
      .single();
    if (convoErr || !convo) {
      return NextResponse.json(
        { error: convoErr?.message ?? "Could not create conversation" },
        { status: 500 }
      );
    }
    conversationId = convo.id as string;
    const { error: memErr } = await supabase.from("conversation_members").insert([
      { conversation_id: conversationId, user_id: me },
      { conversation_id: conversationId, user_id: recipientId },
    ]);
    if (memErr) {
      return NextResponse.json({ error: memErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ conversation_id: conversationId });
}
