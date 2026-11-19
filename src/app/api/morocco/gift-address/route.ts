import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { validateGiftAddress } from "@/lib/moroccoGift";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// /api/morocco/gift-address — the OPTIONAL mailing address a Morocco trip
// supporter can leave after paying (/morocco/thank-you). Public: supporters
// have no Melori account. Write-only — there is no GET; addresses are read by
// Karl in Supabase, never served back. Table is service-role only (migration 104).

export async function POST(req: NextRequest) {
  const rl = rateLimit(`morocco-gift:${clientIp(req)}`, 5, 1 / 60);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many tries. Please wait a minute." },
      { status: 429, headers: { "Retry-After": Math.ceil(rl.retryAfterMs / 1000).toString() } },
    );
  }

  const body = await req.json().catch(() => ({}));
  if (body && typeof body.company === "string" && body.company.trim() !== "") {
    return NextResponse.json({ ok: true }); // honeypot
  }

  const parsed = validateGiftAddress(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const { error } = await getSupabaseAdmin()
      .from("morocco_gift_addresses")
      .upsert(
        { ...parsed.value, updated_at: new Date().toISOString() },
        { onConflict: "stripe_session_id" },
      );
    if (error) throw error;
  } catch (err) {
    console.error("morocco gift-address error:", err);
    return NextResponse.json(
      { error: "Could not save your address. Please try again, or text Karl." },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
