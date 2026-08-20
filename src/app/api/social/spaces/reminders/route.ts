import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/social/spaces/reminders -> { spaceIds: string[] }
//
// Returns the space ids the caller has a reminder on, so the discover screen
// can render every bell in its correct state from one request instead of one
// per row.
//
// Signed-out callers get an empty list rather than a 401: discover is public,
// and a 401 here would put a red error in the console on every anonymous visit
// for what is a purely cosmetic piece of state.
export async function GET(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return NextResponse.json({ spaceIds: [] });

  const { data, error } = await getSupabaseAdmin()
    .from("space_reminders")
    .select("space_id")
    .eq("user_id", guard.membership.userId as string);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    spaceIds: (data ?? []).map((row) => row.space_id as string),
  });
}
