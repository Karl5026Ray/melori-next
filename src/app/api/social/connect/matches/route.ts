import { NextRequest, NextResponse } from "next/server";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/social/connect/matches
// The Matches tab: every mutual match for the caller, newest first, with the
// other person's profile and the conversation id so they can jump into chat.
export async function GET(req: NextRequest) {
  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;
  const me = guard.membership.userId as string;

  const supabase = getSupabaseAdmin();

  const { data: rows, error } = await supabase
    .from("matches")
    .select(
      `id, user_a, user_b, conversation_id, created_at,
       a:profiles!matches_user_a_fkey(id, display_name, username, avatar_url, verified, role),
       b:profiles!matches_user_b_fkey(id, display_name, username, avatar_url, verified, role)`,
    )
    .or(`user_a.eq.${me},user_b.eq.${me}`)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const matches = (rows ?? []).map((m) => {
    const other = (m.user_a as string) === me ? m.b : m.a;
    return {
      matchId: m.id,
      conversationId: m.conversation_id,
      createdAt: m.created_at,
      profile: other,
    };
  });

  return NextResponse.json(
    { matches },
    { headers: { "Cache-Control": "no-store" } },
  );
}
