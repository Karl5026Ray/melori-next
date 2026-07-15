import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/social/conversations/[id]/read
// Marks the conversation as read for the caller. Anyone signed in and a member
// can update their own last_read_at (used for unread badges + read receipts).
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { userId } = await getRequestMembership(req);
  if (!userId) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("conversation_members")
    .update({ last_read_at: new Date().toISOString() })
    .eq("conversation_id", params.id)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}
