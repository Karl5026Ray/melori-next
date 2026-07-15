import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { buildDailyBatch } from "@/lib/dating";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/social/connect/matches-feed — the curated daily music matches.
// Returns 3-8 cards ranked by Harmony Score, each with explanation, photo, and
// a prompt preview. If the caller has no active dating profile, `needs_onboarding`
// is true so the client can show the opt-in CTA.
export async function GET(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const me = guard.membership.userId!;
  const supabase = getSupabaseAdmin();

  const { data: profile } = await supabase
    .from("dating_profiles")
    .select("is_active")
    .eq("profile_id", me)
    .maybeSingle();

  if (!profile || !(profile as { is_active?: boolean }).is_active) {
    return NextResponse.json({ needs_onboarding: true, cards: [] });
  }

  const cards = await buildDailyBatch(supabase, me, { limit: 8 });
  return NextResponse.json({ needs_onboarding: false, cards });
}
