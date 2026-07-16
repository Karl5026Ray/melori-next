import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/presence/heartbeat
// -------------------------------------------------------------------------
// Site-wide member presence. Any signed-in member pings this on a light
// interval (and on mount) while an app page is open; we stamp
// profiles.last_seen_at = now() so the Melori Mirror "Online now" row can show
// who is genuinely online right now, not just who is hosting a live room.
//
// Runs on the admin client (bypasses the per-row profiles RLS, which only lets
// a member update their OWN row anyway) and only ever touches the caller's row.
export async function POST(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const callerId = guard.membership.userId!;

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("profiles")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", callerId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
