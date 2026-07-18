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

  // --- Seamless identity carry-over from the main social profile -----------
  // Connect reuses the same `profiles` row for name/avatar, but the dating
  // profile's own fields (birthdate, city, photos) otherwise start blank. On
  // first join — i.e. when no dating_profiles row exists yet — pre-fill any
  // field the caller didn't supply from the member's existing profile so the
  // Connect card isn't an empty slate. We also keep birthday + city in sync
  // across both surfaces below.
  const { data: existing } = await supabase
    .from("dating_profiles")
    .select("user_id")
    .eq("user_id", me)
    .maybeSingle();

  const { data: mainProfile } = await supabase
    .from("profiles")
    .select("birth_date, city")
    .eq("id", me)
    .maybeSingle();

  if (!existing) {
    // First-time join: seed unset fields from the main profile.
    if (patch.birthdate == null && mainProfile?.birth_date)
      patch.birthdate = mainProfile.birth_date;
    if (patch.city == null && mainProfile?.city)
      patch.city = mainProfile.city;
    if (patch.photos == null) {
      const { data: gallery } = await supabase
        .from("profile_gallery")
        .select("image_url, media_type, sort_order")
        .eq("profile_id", me)
        .order("sort_order", { ascending: true })
        .limit(9);
      const photos = (gallery ?? [])
        .filter((g) => (g.media_type ?? "photo") === "photo" && g.image_url)
        .map((g) => g.image_url as string);
      if (photos.length) patch.photos = photos;
    }
  }

  const { data, error } = await supabase
    .from("dating_profiles")
    .upsert(patch, { onConflict: "user_id" })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // --- Two-way backfill to the main profile -------------------------------
  // If the member set a birthday/city on their Connect profile but their main
  // profile has none, copy it up so both surfaces agree and the birthday-hide
  // toggle governs a single source of truth. We never overwrite an existing
  // main-profile value here.
  const backfill: Record<string, unknown> = {};
  if (patch.birthdate && !mainProfile?.birth_date)
    backfill.birth_date = patch.birthdate;
  if (patch.city && !mainProfile?.city) backfill.city = patch.city;
  if (Object.keys(backfill).length) {
    await supabase.from("profiles").update(backfill).eq("id", me);
  }

  return NextResponse.json({ profile: data });
}
