import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/social/spaces/[spaceId]/heartbeat
// Bumps last_activity_at so the reap_idle_spaces cron doesn't kill a live room.
// Also usable as a page-visible ping every ~60s from the client.
export async function POST(
  req: NextRequest,
  { params }: { params: { spaceId: string } },
) {
  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("spaces")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", params.spaceId)
    .eq("status", "live");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
