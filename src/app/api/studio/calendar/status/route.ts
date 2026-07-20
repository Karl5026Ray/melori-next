import { NextRequest, NextResponse } from "next/server";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isCalendarConfigured } from "@/lib/google-calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/studio/calendar/status — requireArtist. Returns whether the
// caller has a connected Google Calendar, plus which calendar id is synced.
// Also reports `configured` so the UI can tell "not connected" apart from
// "Karl hasn't set the Google env vars yet" without needing a 503.
export async function GET(req: NextRequest) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("calendar_connections")
    .select("calendar_id, scope, created_at")
    .eq("photographer_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[calendar/status] lookup failed", error.message);
    return NextResponse.json(
      { error: "Could not load calendar status" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    connected: Boolean(data),
    calendarId: data?.calendar_id ?? null,
    configured: isCalendarConfigured(),
  });
}
