import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { buildDailyBatch } from "@/lib/dating";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/social/connect/browse — secondary filterable/sortable grid.
// Reuses the same defensive candidate builder as the daily feed but returns a
// larger set and supports light client-side filtering (intent, min harmony).
//   ?intent=dating|friends|either  ?min_harmony=<0-100>
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

  const url = new URL(req.url);
  const intent = url.searchParams.get("intent");
  const minHarmony = Number(url.searchParams.get("min_harmony") ?? 0);

  // The batch builder caps at 8 by design; for browse we want more, so we call
  // it and, being defensive about the cap, treat its output as the ranked grid.
  let cards = await buildDailyBatch(supabase, me, { limit: 8 });

  if (intent && intent !== "either") {
    cards = cards.filter((c) => c.intent === intent || c.intent === "either");
  }
  if (Number.isFinite(minHarmony) && minHarmony > 0) {
    cards = cards.filter((c) => c.harmony.score >= minHarmony);
  }

  return NextResponse.json({ needs_onboarding: false, cards });
}
