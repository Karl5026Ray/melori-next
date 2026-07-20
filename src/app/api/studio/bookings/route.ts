import { NextRequest, NextResponse } from "next/server";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/studio/bookings — requireArtist. Lists the caller's own bookings,
// most recent starts_at first, with the service name joined in for display.
export async function GET(req: NextRequest) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;

  const supabase = getSupabaseAdmin();
  const { data: bookings, error } = await supabase
    .from("photo_bookings")
    .select(
      "id, service_id, client_name, client_email, client_phone, starts_at, ends_at, status, notes, deposit_cents, deposit_paid, stripe_session_id, google_event_id, created_at, photo_services(name)",
    )
    .eq("photographer_id", userId)
    .order("starts_at", { ascending: false });

  if (error) {
    console.error("studio/bookings GET failed", error.message);
    return NextResponse.json({ error: "Could not load bookings" }, { status: 500 });
  }

  const mapped = (bookings ?? []).map((b) => {
    const service = Array.isArray(b.photo_services)
      ? b.photo_services[0]
      : b.photo_services;
    return {
      id: b.id,
      serviceId: b.service_id,
      serviceName: service?.name ?? null,
      clientName: b.client_name,
      clientEmail: b.client_email,
      clientPhone: b.client_phone,
      startsAt: b.starts_at,
      endsAt: b.ends_at,
      status: b.status,
      notes: b.notes,
      depositCents: b.deposit_cents,
      depositPaid: b.deposit_paid,
      hasGoogleEvent: Boolean(b.google_event_id),
      createdAt: b.created_at,
    };
  });

  return NextResponse.json({ bookings: mapped });
}
