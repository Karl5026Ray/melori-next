import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";
import { findOrCreateDirectConversation } from "@/lib/direct-conversation";

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

  const supabase = getSupabaseAdmin();

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

  return NextResponse.json({ conversation_id: result.id });
}
