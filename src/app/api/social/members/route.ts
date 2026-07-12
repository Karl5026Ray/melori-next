import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/social/members?q=
// Superfan+ member directory for the "Send a Wave" picker. Excludes the caller.
export async function GET(req: NextRequest) {
  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;

  const rawQ = new URL(req.url).searchParams.get("q") ?? "";
  const q = rawQ.replace(/[,()\\%_"']/g, "").slice(0, 60);

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url, role, verified")
    .neq("id", guard.membership.userId)
    .order("display_name", { ascending: true })
    .limit(20);

  if (q) {
    query = query.or(`display_name.ilike.%${q}%,username.ilike.%${q}%`);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ members: data ?? [] });
}
