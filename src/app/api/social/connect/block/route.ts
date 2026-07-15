import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { isUuid } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/social/connect/block — block a member from within the dating layer.
//   Body: { target }
// Reuses the platform-level member_blocks table (so the block composes across
// all of Melori Social) AND soft-unmatches any active dating match between the
// two, immediately cutting off dating messaging.
export async function POST(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const me = guard.membership.userId!;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const target = typeof body.target === "string" ? body.target.trim() : "";
  if (!isUuid(target)) {
    return NextResponse.json({ error: "Invalid target" }, { status: 400 });
  }
  if (target === me) {
    return NextResponse.json({ error: "You can't block yourself" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Platform block (idempotent).
  const { error: blockErr } = await supabase
    .from("member_blocks")
    .upsert({ blocker_id: me, blocked_id: target });
  if (blockErr) {
    return NextResponse.json({ error: blockErr.message }, { status: 500 });
  }

  // Soft-unmatch any active match between us (canonical pair ordering).
  const a = me < target ? me : target;
  const b = me < target ? target : me;
  await supabase
    .from("dating_matches")
    .update({
      status: "unmatched",
      unmatched_by: me,
      unmatched_at: new Date().toISOString(),
    })
    .eq("user_a", a)
    .eq("user_b", b)
    .eq("status", "active");

  return NextResponse.json({ ok: true, blocked: true });
}
