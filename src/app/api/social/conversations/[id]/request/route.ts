import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { isUuid } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/social/conversations/[id]/request
// Body: { action: "accept" | "decline" }
// Only the RECIPIENT of a pending message request (i.e. a member who is not the
// initiator) may accept or decline it.
//  - accept  -> status becomes 'accepted'; thread moves to the primary inbox.
//  - decline -> status becomes 'declined'; thread is hidden from the recipient.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const me = guard.membership.userId!;

  const conversationId = params.id;
  if (!isUuid(conversationId)) {
    return NextResponse.json({ error: "Invalid conversation id" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "").trim();
  if (action !== "accept" && action !== "decline") {
    return NextResponse.json(
      { error: "action must be 'accept' or 'decline'" },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();

  // The caller must be a member of the conversation.
  const { data: membership } = await supabase
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", me)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json(
      { error: "You are not a participant in this conversation." },
      { status: 403 },
    );
  }

  const { data: convo } = await supabase
    .from("conversations")
    .select("id, status, requested_by")
    .eq("id", conversationId)
    .maybeSingle();
  if (!convo) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // Only the recipient (not the initiator) can act on a request. If the initiator
  // is the caller, there is nothing to accept.
  if (convo.requested_by === me) {
    return NextResponse.json(
      { error: "You started this request; only the recipient can respond." },
      { status: 403 },
    );
  }

  const status = action === "accept" ? "accepted" : "declined";
  const { error } = await supabase
    .from("conversations")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", conversationId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status });
}
