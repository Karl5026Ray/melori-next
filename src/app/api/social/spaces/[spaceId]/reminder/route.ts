import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-member "notify me when this starts" toggle for a scheduled room, set
// from the MM Cinema discover screen's STARTING SOON bell.
//
// requireAuth, NOT requireSuperfan: setting a reminder is a read-side intent,
// and Melori's participation gate only restricts *writing into a room* —
// posting, commenting, DMing, taking a stage seat. Making a free member upgrade
// before they can be told a screening exists would gate the top of the funnel,
// which is the opposite of what discover is for.
//
// Storage is a plain intent row (migration 050). Delivery runs separately on
// the existing Resend + cron path and stamps notified_at.

/** POST — set a reminder. Idempotent: pressing the bell twice is not an error. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;

  const { spaceId: raw } = await params;
  const spaceId = String(raw ?? "").trim();
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId is required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Only scheduled rooms can be reminded about. A live room needs no reminder
  // and an ended one can never fire, so accepting either would create rows the
  // send job must then filter out forever.
  const { data: space, error: fetchErr } = await supabase
    .from("spaces")
    .select("id, status")
    .eq("id", spaceId)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!space) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  if (space.status !== "scheduled") {
    return NextResponse.json(
      { error: "Only scheduled rooms can be reminded about" },
      { status: 409 },
    );
  }

  // onConflict on the (space_id, user_id) unique constraint makes a repeated
  // press a no-op rather than a 23505.
  const { error: upsertErr } = await supabase
    .from("space_reminders")
    .upsert(
      { space_id: spaceId, user_id: userId },
      { onConflict: "space_id,user_id", ignoreDuplicates: true },
    );

  if (upsertErr) {
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  return NextResponse.json({ reminded: true });
}

/** DELETE — clear the reminder. Also idempotent. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;

  const { spaceId: raw } = await params;
  const spaceId = String(raw ?? "").trim();
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId is required" }, { status: 400 });
  }

  const { error } = await getSupabaseAdmin()
    .from("space_reminders")
    .delete()
    .eq("space_id", spaceId)
    .eq("user_id", userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ reminded: false });
}
