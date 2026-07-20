import { NextRequest, NextResponse } from "next/server";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/studio/availability — requireArtist. Returns the caller's weekly
// availability rules.
export async function GET(req: NextRequest) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;

  const supabase = getSupabaseAdmin();
  const { data: rules, error } = await supabase
    .from("photo_availability")
    .select("id, weekday, start_minute, end_minute, is_active")
    .eq("photographer_id", userId)
    .order("weekday", { ascending: true })
    .order("start_minute", { ascending: true });

  if (error) {
    console.error("studio/availability GET failed", error.message);
    return NextResponse.json({ error: "Could not load availability" }, { status: 500 });
  }

  return NextResponse.json({ rules: rules ?? [] });
}

interface RuleInput {
  weekday?: number;
  startMinute?: number;
  endMinute?: number;
  isActive?: boolean;
}

// PUT /api/studio/availability — requireArtist. Replaces the caller's full
// set of weekly availability rules with the provided list (simplest mental
// model for a weekly editor UI — no partial PATCH semantics needed here).
export async function PUT(req: NextRequest) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;

  let body: { rules?: RuleInput[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const rawRules = Array.isArray(body.rules) ? body.rules : [];
  const cleanRules = rawRules
    .filter(
      (r) =>
        Number.isInteger(r.weekday) &&
        (r.weekday as number) >= 0 &&
        (r.weekday as number) <= 6 &&
        Number.isInteger(r.startMinute) &&
        Number.isInteger(r.endMinute) &&
        (r.startMinute as number) >= 0 &&
        (r.endMinute as number) <= 1440 &&
        (r.startMinute as number) < (r.endMinute as number),
    )
    .map((r) => ({
      photographer_id: userId,
      weekday: r.weekday as number,
      start_minute: r.startMinute as number,
      end_minute: r.endMinute as number,
      is_active: typeof r.isActive === "boolean" ? r.isActive : true,
    }));

  const supabase = getSupabaseAdmin();

  const { error: deleteError } = await supabase
    .from("photo_availability")
    .delete()
    .eq("photographer_id", userId);

  if (deleteError) {
    console.error("studio/availability PUT delete failed", deleteError.message);
    return NextResponse.json({ error: "Could not save availability" }, { status: 500 });
  }

  if (cleanRules.length > 0) {
    const { error: insertError } = await supabase
      .from("photo_availability")
      .insert(cleanRules);
    if (insertError) {
      console.error("studio/availability PUT insert failed", insertError.message);
      return NextResponse.json({ error: "Could not save availability" }, { status: 500 });
    }
  }

  const { data: rules } = await supabase
    .from("photo_availability")
    .select("id, weekday, start_minute, end_minute, is_active")
    .eq("photographer_id", userId)
    .order("weekday", { ascending: true })
    .order("start_minute", { ascending: true });

  return NextResponse.json({ rules: rules ?? [] });
}
