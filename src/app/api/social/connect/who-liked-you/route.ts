import { NextRequest, NextResponse } from "next/server";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/social/connect/who-liked-you
// "See Who Liked You" — a paid-tier perk. Because match_likes RLS only lets a
// user read their OWN swipes, likers are invisible to everyone by default; this
// endpoint uses the service role to reveal them, and is gated to Superfan+.
//
// Returns people who liked/superliked the caller and whom the caller has NOT
// yet swiped (i.e. pending inbound interest → a match waiting to happen).
export async function GET(req: NextRequest) {
  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;
  const me = guard.membership.userId as string;

  const supabase = getSupabaseAdmin();

  // Everyone who liked me.
  const { data: inbound, error } = await supabase
    .from("match_likes")
    .select("liker_id, action, created_at")
    .eq("liked_id", me)
    .in("action", ["like", "superlike"])
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Remove anyone I've already swiped (already handled / matched) and blocks.
  const [{ data: mySwipes }, { data: blocks }] = await Promise.all([
    supabase.from("match_likes").select("liked_id").eq("liker_id", me),
    supabase
      .from("member_blocks")
      .select("blocker_id, blocked_id")
      .or(`blocker_id.eq.${me},blocked_id.eq.${me}`),
  ]);
  const handled = new Set<string>();
  for (const s of mySwipes ?? []) handled.add(s.liked_id as string);
  for (const b of blocks ?? []) {
    handled.add(b.blocker_id as string);
    handled.add(b.blocked_id as string);
  }

  const pending = (inbound ?? []).filter(
    (r) => !handled.has(r.liker_id as string),
  );

  if (pending.length === 0) {
    return NextResponse.json({ likers: [], count: 0 });
  }

  const likerIds = pending.map((p) => p.liker_id as string);
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name, username, avatar_url, verified, role")
    .in("id", likerIds);
  const byId = new Map((profiles ?? []).map((p) => [p.id as string, p]));

  const likers = pending.map((p) => ({
    userId: p.liker_id,
    action: p.action,
    createdAt: p.created_at,
    profile: byId.get(p.liker_id as string) ?? null,
  }));

  return NextResponse.json(
    { likers, count: likers.length },
    { headers: { "Cache-Control": "no-store" } },
  );
}
