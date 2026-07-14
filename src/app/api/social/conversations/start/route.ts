import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { findOrCreateDirectConversation } from "@/lib/direct-conversation";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/social/conversations/start
// Body: { recipient_id: string }
// Finds an existing 1:1 conversation between the caller and recipient, or
// creates one. Refuses if either party has blocked the other.
export async function POST(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const { membership } = guard;
  const me = membership.userId;
  if (!me) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const recipientId = String(body.recipient_id ?? "").trim();
  if (!recipientId) {
    return NextResponse.json({ error: "recipient_id required" }, { status: 400 });
  }
  if (recipientId === me) {
    return NextResponse.json({ error: "You can't message yourself" }, { status: 400 });
  }

  // Opening a conversation writes two rows and (usually) a new conversations
  // row. Cap at 3 quick / ~1 per 5s so a runaway client can't create hundreds
  // of empty 1:1 rows against every profile it finds.
  const rl = rateLimit(`social:conv-start:${me}`, 3, 0.2);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "You're starting conversations too quickly." },
      {
        status: 429,
        headers: { "Retry-After": Math.ceil(rl.retryAfterMs / 1000).toString() },
      },
    );
  }

  const supabase = getSupabaseAdmin();

  // Confirm the recipient actually exists before we open a conversation.
  // Otherwise a client passing a random UUID would leave a stray empty 1:1
  // in the database.
  const { data: recipient } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", recipientId)
    .maybeSingle();
  if (!recipient) {
    return NextResponse.json({ error: "Recipient not found" }, { status: 404 });
  }

  // Refuse if a block exists in either direction. We use `limit(1)` rather
  // than `maybeSingle()` because if both users blocked each other there are
  // two rows and `maybeSingle()` errors out — we just need to know at least
  // one exists.
  const { data: blocks } = await supabase
    .from("member_blocks")
    .select("blocker_id")
    .or(
      `and(blocker_id.eq.${me},blocked_id.eq.${recipientId}),` +
        `and(blocker_id.eq.${recipientId},blocked_id.eq.${me})`
    )
    .limit(1);
  if (blocks && blocks.length > 0) {
    return NextResponse.json(
      { error: "Messaging is unavailable between these members." },
      { status: 403 }
    );
  }

  // Find (or open) a TRUE 1:1 conversation. Previously this matched "any
  // conversation both users belong to" and would return a group chat both
  // users happened to share, misdirecting their DM into that group thread.
  // The helper requires the conversation to have EXACTLY two members before
  // reusing it.
  const result = await findOrCreateDirectConversation(supabase, me, recipientId);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  // Message-request gating (IG-style). A brand-new 1:1 opens as a REQUEST
  // (status='pending') so it lands in the recipient's Requests tab — unless the
  // recipient already follows the initiator, in which case they've shown intent
  // and the thread opens as a normal accepted conversation. Existing threads are
  // never downgraded.
  if (result.created) {
    const { data: recipFollowsMe } = await supabase
      .from("follows")
      .select("id")
      .eq("follower_id", recipientId)
      .eq("following_id", me)
      .maybeSingle();

    const status = recipFollowsMe ? "accepted" : "pending";
    await supabase
      .from("conversations")
      .update({ status, requested_by: me })
      .eq("id", result.id);

    return NextResponse.json({
      conversation_id: result.id,
      status,
      is_request: status === "pending",
    });
  }

  return NextResponse.json({ conversation_id: result.id, status: "accepted" });
}
