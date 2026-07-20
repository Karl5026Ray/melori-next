import { NextRequest, NextResponse } from "next/server";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/studio/services — requireArtist. Returns the caller's own
// services (photographer-scoped, matches the galleries list convention),
// ordered by sort_order then created_at.
export async function GET(req: NextRequest) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;

  const supabase = getSupabaseAdmin();
  const { data: services, error } = await supabase
    .from("photo_services")
    .select(
      "id, name, description, duration_minutes, price_cents, deposit_cents, deposit_percent, is_active, sort_order, contract_url, created_at, updated_at",
    )
    .eq("photographer_id", userId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("studio/services GET failed", error.message);
    return NextResponse.json(
      { error: "Could not load services" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    services: (services ?? []).map((s) => ({
      ...s,
      hasContract: Boolean(s.contract_url),
    })),
  });
}

// POST /api/studio/services — requireArtist. Creates a photo_services row
// owned by the caller.
export async function POST(req: NextRequest) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;

  let body: {
    name?: string;
    description?: string | null;
    durationMinutes?: number;
    priceCents?: number;
    depositCents?: number;
    depositPercent?: number | null;
    isActive?: boolean;
    sortOrder?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : null;

  const durationMinutes =
    Number.isInteger(body.durationMinutes) && (body.durationMinutes as number) > 0
      ? (body.durationMinutes as number)
      : 60;
  const priceCents =
    Number.isInteger(body.priceCents) && (body.priceCents as number) >= 0
      ? (body.priceCents as number)
      : 0;
  const depositCents =
    Number.isInteger(body.depositCents) && (body.depositCents as number) >= 0
      ? (body.depositCents as number)
      : 0;
  const depositPercent =
    Number.isInteger(body.depositPercent) &&
    (body.depositPercent as number) >= 0 &&
    (body.depositPercent as number) <= 100
      ? (body.depositPercent as number)
      : null;
  const isActive = typeof body.isActive === "boolean" ? body.isActive : true;
  const sortOrder = Number.isInteger(body.sortOrder) ? (body.sortOrder as number) : 0;

  const supabase = getSupabaseAdmin();
  const { data: created, error } = await supabase
    .from("photo_services")
    .insert({
      photographer_id: userId,
      name,
      description,
      duration_minutes: durationMinutes,
      price_cents: priceCents,
      deposit_cents: depositCents,
      deposit_percent: depositPercent,
      is_active: isActive,
      sort_order: sortOrder,
    })
    .select(
      "id, name, description, duration_minutes, price_cents, deposit_cents, deposit_percent, is_active, sort_order, contract_url, created_at, updated_at",
    )
    .single();

  if (error || !created) {
    console.error("studio/services insert failed", error?.message);
    return NextResponse.json(
      { error: "Could not create service" },
      { status: 500 },
    );
  }

  return NextResponse.json({ service: { ...created, hasContract: false } });
}
