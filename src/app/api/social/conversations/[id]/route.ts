import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";
import { isUuid } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/social/conversations/[id]
// Returns the conversation's request status + the OTHER participant + whether
// a block exists in either direction. Runs under service_role after verifying
// the caller is a member, because:
//   - the `conversations` SELECT RLS policy is currently self-referential and
//     matches nothing, and
//   - `member_blocks` has RLS enabled with no SELECT policy,
// so the browser (anon) client cannot read either table. Centralizing the read
// here keeps the chat page correct regardless of those policies.
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { userId } = await getRequestMembership(req);
  if (!userId) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const conversationId = params.id;
  if (!isUuid(conversationId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Verify membership.
  const { data: mine } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!mine) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: conv } = await supabase
    .from("conversations")
    .select("id, status, requested_by, created_at, updated_at")
    .eq("id", conversationId)
    .maybeSingle();

  // The other participant (1:1).
  const { data: others } = await supabase
    .from("conversation_members")
    .select(
      "user:profiles(id, username, display_name, avatar_url, role, bio, verified, followers_count, following_count)",
    )
    .eq("conversation_id", conversationId)
    .neq("user_id", userId)
    .limit(1);
  const otherUser = others?.[0]?.user ?? null;

  // Block in either direction.
  let blocked = false;
  const otherId = (otherUser as { id?: string } | null)?.id;
  if (otherId) {
    const { data: blk } = await supabase
      .from("member_blocks")
      .select("blocker_id")
      .or(
        `and(blocker_id.eq.${userId},blocked_id.eq.${otherId}),and(blocker_id.eq.${otherId},blocked_id.eq.${userId})`,
      )
      .limit(1);
    blocked = !!blk && blk.length > 0;
  }

  return NextResponse.json({
    conversation: conv,
    other_user: otherUser,
    blocked,
  });
}
