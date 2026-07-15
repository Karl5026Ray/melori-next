import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { ageFromDob } from "@/lib/dating";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/social/connect/profile — my dating profile + prompts + photos + prefs
// POST /api/social/connect/profile — create/update my dating profile.
//   Enforces 18+ (from dob) and requires explicit sensitive-data consent before
//   the profile can go active. The caller is always the verified token user.
const INTENTS = ["dating", "friends", "either"];

export async function GET(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const me = guard.membership.userId!;
  const supabase = getSupabaseAdmin();

  const [profileRes, promptsRes, photosRes, prefsRes] = await Promise.all([
    supabase.from("dating_profiles").select("*").eq("profile_id", me).maybeSingle(),
    supabase
      .from("dating_profile_prompts")
      .select("id, prompt_id, answer, sort_order")
      .eq("profile_id", me)
      .order("sort_order", { ascending: true }),
    supabase
      .from("dating_profile_photos")
      .select("id, image_url, sort_order")
      .eq("profile_id", me)
      .order("sort_order", { ascending: true }),
    supabase.from("dating_preferences").select("dealbreakers").eq("profile_id", me).maybeSingle(),
  ]);

  return NextResponse.json({
    profile: profileRes.data ?? null,
    prompts: promptsRes.data ?? [],
    photos: photosRes.data ?? [],
    preferences: prefsRes.data?.dealbreakers ?? {},
  });
}

async function upsertProfile(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const me = guard.membership.userId!;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const dob = typeof body.dob === "string" ? body.dob.trim() : "";
  if (!dob) {
    return NextResponse.json({ error: "Date of birth is required" }, { status: 400 });
  }
  const age = ageFromDob(dob);
  if (age == null || age < 18) {
    return NextResponse.json(
      { error: "You must be at least 18 to use Melori Connect" },
      { status: 403 },
    );
  }

  const wantsActive = body.is_active === true;
  const consent = body.consent_sensitive === true;
  // A member can only go active after explicitly consenting to sensitive-data
  // processing (orientation, dating intent).
  if (wantsActive && !consent) {
    return NextResponse.json(
      { error: "Consent to dating data processing is required to activate" },
      { status: 400 },
    );
  }

  const intent = INTENTS.includes(String(body.intent)) ? String(body.intent) : "either";
  const seeking = Array.isArray(body.seeking_gender)
    ? (body.seeking_gender as unknown[]).map((s) => String(s)).filter(Boolean).slice(0, 10)
    : [];
  const ageMin = Number.isFinite(Number(body.age_min))
    ? Math.min(Math.max(Math.trunc(Number(body.age_min)), 18), 120)
    : 18;
  const ageMax = Number.isFinite(Number(body.age_max))
    ? Math.min(Math.max(Math.trunc(Number(body.age_max)), 18), 120)
    : 99;
  const maxDistance = Number.isFinite(Number(body.max_distance_km))
    ? Math.min(Math.max(Math.trunc(Number(body.max_distance_km)), 1), 20000)
    : 160;

  const row = {
    profile_id: me,
    dob,
    over_18: true,
    is_active: wantsActive,
    intent,
    shown_gender: typeof body.shown_gender === "string" ? body.shown_gender.slice(0, 40) : null,
    seeking_gender: seeking,
    age_min: Math.min(ageMin, ageMax),
    age_max: Math.max(ageMin, ageMax),
    max_distance_km: maxDistance,
    bio_override:
      typeof body.bio_override === "string" ? body.bio_override.slice(0, 1000) : null,
    consent_sensitive: consent,
    updated_at: new Date().toISOString(),
  };

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("dating_profiles")
    .upsert(row, { onConflict: "profile_id" })
    .select("*")
    .maybeSingle();

  if (error) {
    // The 18+ DB trigger raises on under-age; surface it cleanly.
    const under = /18 years old/i.test(error.message);
    return NextResponse.json(
      { error: under ? "You must be at least 18 to use Melori Connect" : error.message },
      { status: under ? 403 : 500 },
    );
  }

  // Optional photo selection (ids into existing media, e.g. profile_gallery URLs).
  if (Array.isArray(body.photos)) {
    const photos = (body.photos as unknown[])
      .map((p) => (typeof p === "string" ? p : (p as { image_url?: string })?.image_url))
      .filter((u): u is string => typeof u === "string" && u.length > 0)
      .slice(0, 9);
    await supabase.from("dating_profile_photos").delete().eq("profile_id", me);
    if (photos.length > 0) {
      await supabase.from("dating_profile_photos").insert(
        photos.map((image_url, i) => ({ profile_id: me, image_url, sort_order: i })),
      );
    }
  }

  // Optional preferences bag.
  if (body.dealbreakers && typeof body.dealbreakers === "object") {
    await supabase
      .from("dating_preferences")
      .upsert(
        { profile_id: me, dealbreakers: body.dealbreakers, updated_at: new Date().toISOString() },
        { onConflict: "profile_id" },
      );
  }

  return NextResponse.json({ ok: true, profile: data });
}

export async function POST(req: NextRequest) {
  return upsertProfile(req);
}

export async function PUT(req: NextRequest) {
  return upsertProfile(req);
}
