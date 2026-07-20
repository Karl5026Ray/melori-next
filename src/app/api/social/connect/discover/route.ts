import { NextRequest, NextResponse } from "next/server";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/social/connect/discover?limit=<n>
// The swipe stack. Returns active dating candidates the caller hasn't swiped
// yet and isn't blocked with, each annotated with a compatibility score
// (music-taste + preference blend) and sorted best-first.
//
// Gated to Superfan+ — Connect is a paid-tier feature.
export async function GET(req: NextRequest) {
  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;
  const me = guard.membership.userId as string;

  const limit = Math.min(
    Math.max(
      parseInt(new URL(req.url).searchParams.get("limit") ?? "20", 10) || 20,
      1,
    ),
    30,
  );

  const supabase = getSupabaseAdmin();

  // Caller must have opted into Connect (have a dating profile).
  const { data: mine } = await supabase
    .from("dating_profiles")
    .select("user_id, gender, interested_in, age_min, age_max")
    .eq("user_id", me)
    .maybeSingle();
  if (!mine) {
    return NextResponse.json(
      { needsProfile: true, candidates: [] },
      { status: 200 },
    );
  }

  // Exclude: myself, anyone I've already swiped, and block relationships.
  const [{ data: swiped }, { data: blocks }] = await Promise.all([
    supabase.from("match_likes").select("liked_id").eq("liker_id", me),
    supabase
      .from("member_blocks")
      .select("blocker_id, blocked_id")
      .or(`blocker_id.eq.${me},blocked_id.eq.${me}`),
  ]);
  const excluded = new Set<string>([me]);
  for (const s of swiped ?? []) excluded.add(s.liked_id as string);
  for (const b of blocks ?? []) {
    excluded.add(b.blocker_id as string);
    excluded.add(b.blocked_id as string);
  }

  // Pull active candidates joined to their profile card fields. We also read
  // each candidate's `interested_in` so we can enforce MUTUAL gender matching
  // below (never selected out to the client — used only for filtering).
  const { data: rows, error } = await supabase
    .from("dating_profiles")
    .select(
      `user_id, headline, birthdate, gender, interested_in, city, photos, videos, prompts,
       profile:profiles!dating_profiles_user_id_fkey(
         id, display_name, username, avatar_url, verified, role, bio
       )`,
    )
    .eq("is_active", true)
    .limit(limit + excluded.size + 200);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Gender preference filtering (mutual + bidirectional):
  //   - I only see candidates whose gender is in MY `interested_in`, so a man
  //     seeking women sees women and a woman seeking men sees men.
  //   - The candidate must also be interested in MY gender, so I never surface
  //     to someone who isn't looking for me. This is what keeps women shown to
  //     men and men shown to women.
  // A missing/empty `interested_in` on either side is treated as "open to all"
  // so legacy profiles without a stated preference aren't silently hidden.
  const myGender = (mine.gender as string | null) ?? null;
  const myInterest = Array.isArray(mine.interested_in)
    ? (mine.interested_in as string[])
    : [];
  const genderMatch = (candGender: string | null, candInterest: unknown) => {
    const ci = Array.isArray(candInterest) ? (candInterest as string[]) : [];
    // Do I want this candidate's gender?
    const iWantThem =
      myInterest.length === 0 || (candGender != null && myInterest.includes(candGender));
    // Does this candidate want my gender?
    const theyWantMe =
      ci.length === 0 || (myGender != null && ci.includes(myGender));
    return iWantThem && theyWantMe;
  };

  const candidates = (rows ?? []).filter(
    (r) =>
      !excluded.has(r.user_id as string) &&
      genderMatch(r.gender as string | null, r.interested_in),
  );

  // Score each candidate (music-taste + prefs) via the DB function.
  const scored = await Promise.all(
    candidates.slice(0, limit + 10).map(async (c) => {
      const { data: score } = await supabase.rpc("compatibility_score", {
        a: me,
        b: c.user_id,
      });
      const age = c.birthdate
        ? Math.floor(
            (Date.now() - new Date(c.birthdate as string).getTime()) /
              (365.25 * 24 * 3600 * 1000),
          )
        : null;
      return {
        userId: c.user_id,
        headline: c.headline,
        age,
        gender: c.gender,
        city: c.city,
        photos: c.photos ?? [],
        videos: c.videos ?? [],
        prompts: c.prompts ?? [],
        profile: c.profile,
        compatibility: typeof score === "number" ? score : 0,
      };
    }),
  );

  scored.sort((a, b) => b.compatibility - a.compatibility);

  return NextResponse.json(
    { candidates: scored.slice(0, limit) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
