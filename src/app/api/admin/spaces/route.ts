import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAdmin, isAdminGuardFailure } from "@/lib/admin-panel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/spaces?status=live|scheduled|all
//
// Admin-only listing of Spaces for the moderation panel, so an admin can see
// every live/dormant room and shut it down. Returns host display info plus how
// many people the database has in each live room (open space_participants
// rows), so a room that is live but empty stands out.
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (isAdminGuardFailure(admin)) return admin;

  const url = new URL(req.url);
  const status = (url.searchParams.get("status") ?? "live").toLowerCase();

  const supabase = getSupabaseAdmin();

  let query = supabase
    .from("spaces")
    .select(
      `
      id, title, topic, type, room_format, status, host_id,
      created_at, last_activity_at, scheduled_at, ended_at, hearts_count,
      host:profiles!spaces_host_id_fkey(id, display_name, avatar_url, role, verified)
    `,
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (status === "live" || status === "scheduled") {
    query = query.eq("status", status);
  } else if (status !== "all") {
    // Unknown filter → default to live rather than leaking everything.
    query = query.eq("status", "live");
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const spaces = data ?? [];

  // One query for every live room shown; a failure reports null (unknown)
  // rather than failing the list.
  const liveIds = spaces.filter((s) => s.status === "live").map((s) => s.id);
  const counts = new Map<string, number>();
  let countsOk = true;
  if (liveIds.length > 0) {
    const { data: rows, error: countErr } = await supabase
      .from("space_participants")
      .select("space_id")
      .in("space_id", liveIds)
      .is("left_at", null);
    if (countErr) countsOk = false;
    for (const r of rows ?? []) {
      counts.set(r.space_id, (counts.get(r.space_id) ?? 0) + 1);
    }
  }
  const enriched = spaces.map((s) => ({
    ...s,
    occupancy: s.status === "live" && countsOk ? counts.get(s.id) ?? 0 : null,
  }));

  return NextResponse.json({ ok: true, spaces: enriched });
}
