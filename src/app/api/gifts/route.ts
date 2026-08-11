import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Authenticated catalog read. Gift prices, media paths, and pack values are
// always server-read; the client only selects an id at checkout/send time.
export async function GET(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;

  const supabase = getSupabaseAdmin();
  const [{ data: gifts, error: giftsError }, { data: packs, error: packsError }] =
    await Promise.all([
      supabase
        .from("gifts")
        .select("id, slug, name, tier, asset_url, duration_ms, price_coins")
        .eq("active", true)
        .order("sort_order", { ascending: true }),
      supabase
        .from("coin_packs")
        .select("id, name, coin_amount, bonus_label, price_usd_cents")
        .eq("active", true)
        .order("sort_order", { ascending: true }),
    ]);

  if (giftsError || packsError) {
    console.error("gifts catalog read failed", giftsError ?? packsError);
    return NextResponse.json({ error: "Could not load gifts" }, { status: 500 });
  }
  return NextResponse.json(
    { gifts: gifts ?? [], packs: packs ?? [] },
    { headers: { "Cache-Control": "no-store" } },
  );
}
