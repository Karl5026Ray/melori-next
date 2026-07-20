import { NextRequest, NextResponse } from "next/server";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/studio/calendar/disconnect — requireArtist. Deletes the caller's
// calendar_connections row. Idempotent: succeeds even if no connection exists.
export async function POST(req: NextRequest) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;

  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("calendar_connections")
    .delete()
    .eq("photographer_id", userId);

  if (error) {
    console.error("[calendar/disconnect] delete failed", error.message);
    return NextResponse.json(
      { error: "Could not disconnect calendar" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
