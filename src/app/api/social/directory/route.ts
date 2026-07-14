import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/social/directory?q=<search>&limit=<n>
// Returns a browsable list of Melori members the caller can start a
// conversation with. Excludes the caller and anyone in a block relationship
// with them (either direction). This is what makes Messages feel alive instead
// of a dormant add — any signed-in user can find people to talk to.
export async function GET(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const me = guard.membership.userId!;

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? "30", 10) || 30, 1),
    50,
  );

  const supabase = getSupabaseAdmin();

  // Everyone the caller has blocked, and everyone who has blocked the caller —
  // hide both directions from the directory.
  const { data: blockRows } = await supabase
    .from("member_blocks")
    .select("blocker_id, blocked_id")
    .or(`blocker_id.eq.${me},blocked_id.eq.${me}`);
  const hidden = new Set<string>([me]);
  for (const b of blockRows ?? []) {
    hidden.add(b.blocker_id as string);
    hidden.add(b.blocked_id as string);
  }

  let query = supabase
    .from("profiles")
    .select("id, display_name, username, avatar_url, role, verified, bio")
    .neq("id", me)
    // Only surface active, non-deleted accounts.
    .or("status.is.null,status.eq.active")
    .order("verified", { ascending: false })
    .order("followers_count", { ascending: false })
    .limit(limit + hidden.size); // over-fetch so post-filtering still fills the page

  if (q) {
    // Case-insensitive match on display name or username.
    const safe = q.replace(/[%,()]/g, " ");
    query = query.or(`display_name.ilike.%${safe}%,username.ilike.%${safe}%`);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const users = (data ?? [])
    .filter((u) => !hidden.has(u.id as string))
    .slice(0, limit);

  return NextResponse.json({ users });
}
