import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;
  const { membership } = guard;

  const body = await req.json().catch(() => ({}));
  const blockedId = String(body.blocked_id ?? "").trim();
  const unblock = body.unblock === true;

  if (!blockedId) {
    return NextResponse.json({ error: "blocked_id required" }, { status: 400 });
  }
  if (blockedId === membership.userId) {
    return NextResponse.json({ error: "You can't block yourself" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  if (unblock) {
    const { error } = await supabase
      .from("member_blocks")
      .delete()
      .eq("blocker_id", membership.userId)
      .eq("blocked_id", blockedId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, blocked: false });
  }

  const { error } = await supabase
    .from("member_blocks")
    .upsert({ blocker_id: membership.userId, blocked_id: blockedId });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, blocked: true });
}
