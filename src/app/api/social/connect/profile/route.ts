import { NextRequest, NextResponse } from "next/server";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GENDERS = ["woman", "man", "nonbinary", "other"];

// GET /api/social/connect/profile — the caller's own dating profile (or null).
export async function GET(req: NextRequest) {
  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;
  const me = guard.membership.userId as string;

  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("dating_profiles")
    .select("*")
    .eq("user_id", me)
    .maybeSingle();

  return NextResponse.json(
    { profile: data ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// PUT /api/social/connect/profile — create or update (opt in to Connect).
// Body accepts: is_active, birthdate, gender, interested_in[], age_min, age_max,
// city, headline, prompts[], photos[].
export async function PUT(req: NextRequest) {
  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;
  const me = guard.membership.userId as string;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);

  // Validate + normalize the fields we accept (never trust the body wholesale).
  const patch: Record<string, unknown> = { user_id: me };

  if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
  if (typeof body.birthdate === "string" && body.birthdate)
    patch.birthdate = body.birthdate;
  if (typeof body.gender === "string" && GENDERS.includes(body.gender))
    patch.gender = body.gender;
  if (Array.isArray(body.interested_in)) {
    const clean = (body.interested_in as unknown[])
      .map(String)
      .filter((g) => GENDERS.includes(g));
    if (clean.length) patch.interested_in = clean;
  }
  const clampAge = (v: unknown) =>
    Math.min(Math.max(parseInt(String(v), 10) || 18, 18), 99);
  if (body.age_min != null) patch.age_min = clampAge(body.age_min);
  if (body.age_max != null) patch.age_max = clampAge(body.age_max);
  if (
    patch.age_min != null &&
    patch.age_max != null &&
    (patch.age_max as number) < (patch.age_min as number)
  ) {
    return NextResponse.json(
      { error: "age_max must be >= age_min" },
      { status: 400 },
    );
  }
  if (typeof body.city === "string") patch.city = body.city.slice(0, 120);
  if (typeof body.headline === "string")
    patch.headline = body.headline.slice(0, 160);
  if (Array.isArray(body.prompts)) patch.prompts = body.prompts.slice(0, 5);
  if (Array.isArray(body.photos))
    patch.photos = (body.photos as unknown[]).map(String).slice(0, 9);

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("dating_profiles")
    .upsert(patch, { onConflict: "user_id" })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ profile: data });
}
