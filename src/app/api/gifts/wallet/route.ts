import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;

  const { data, error } = await getSupabaseAdmin()
    .from("wallets")
    .select("balance_coins")
    .eq("user_id", guard.membership.userId!)
    .maybeSingle();
  if (error) {
    console.error("gift wallet read failed", error);
    return NextResponse.json({ error: "Could not load wallet" }, { status: 500 });
  }
  return NextResponse.json(
    { balance: data?.balance_coins ?? 0 },
    { headers: { "Cache-Control": "no-store" } },
  );
}
