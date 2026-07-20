import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/booking/public-services — PUBLIC, no auth. Lists active services
// for the /book flow's service picker. Deliberately narrower field set than
// /api/studio/services (no contract_url, ids of the photographer, etc.).
export async function GET() {
  const supabase = getSupabaseAdmin();
  const { data: services, error } = await supabase
    .from("photo_services")
    .select(
      "id, name, description, duration_minutes, price_cents, deposit_cents, deposit_percent",
    )
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("booking/public-services GET failed", error.message);
    return NextResponse.json({ error: "Could not load services" }, { status: 500 });
  }

  return NextResponse.json({ services: services ?? [] });
}
