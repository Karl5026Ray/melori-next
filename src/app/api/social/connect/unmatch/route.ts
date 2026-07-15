import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { isUuid } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/social/connect/unmatch — soft-unmatch a match.
//   Body: { match_id }
// Sets status='unmatched' and unmatched_by=me. Messages are DELIBERATELY
// preserved (not deleted) so a subsequent report retains evidence — closing the
// gap Bumble had to patch where unmatch was used to hide abuse.
export async function POST(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const me = guard.membership.userId!;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const matchId = typeof body.match_id === "string" ? body.match_id.trim() : "";
  if (!isUuid(matchId)) {
    return NextResponse.json({ error: "Invalid match_id" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: match } = await supabase
    .from("dating_matches")
    .select("id, user_a, user_b, status")
    .eq("id", matchId)
    .maybeSingle();
  if (!match) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }
  const m = match as { id: string; user_a: string; user_b: string };
  if (m.user_a !== me && m.user_b !== me) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  const { error } = await supabase
    .from("dating_matches")
    .update({
      status: "unmatched",
      unmatched_by: me,
      unmatched_at: new Date().toISOString(),
    })
    .eq("id", matchId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
