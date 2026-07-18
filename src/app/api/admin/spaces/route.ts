import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAdmin, isAdminGuardFailure } from "@/lib/admin-panel";
import { isPubNubConfigured, getChannelOccupancy } from "@/lib/pubnubServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/spaces?status=live|scheduled|all
//
// Admin-only listing of Spaces for the moderation panel, so an admin can see
// every live/dormant room and shut it down. Returns host display info plus the
// live PubNub occupancy (when configured) so a dormant room — live in the DB
// but with a ghost/stuck presence — is visible and actionable.
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
      host:profiles(id, display_name, avatar_url, role, verified)
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

  // Enrich live rooms with true PubNub occupancy so dormant/ghost rooms stand
  // out. Best-effort and gentle: only for the rooms shown, sequential, and any
  // read failure just reports null (unknown) rather than failing the list.
  const pubnubOn = isPubNubConfigured();
  const enriched = [];
  for (const s of spaces) {
    let occupancy: number | null = null;
    if (pubnubOn && s.status === "live") {
      try {
        occupancy = await getChannelOccupancy(s.id);
      } catch {
        occupancy = null;
      }
    }
    enriched.push({ ...s, occupancy });
  }

  return NextResponse.json({ ok: true, spaces: enriched });
}
