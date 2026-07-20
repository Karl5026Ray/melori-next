import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { computeAvailableSlots } from "@/lib/booking-availability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/booking/slots?serviceId=&date= — PUBLIC, no auth. Computes open
// booking slots for the requested local calendar date in the photographer's
// timezone. Works fully even if Google Calendar isn't connected — it just
// subtracts existing photo_bookings in that case.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const serviceId = searchParams.get("serviceId");
  const dateStr = searchParams.get("date"); // "YYYY-MM-DD"

  if (!serviceId) {
    return NextResponse.json({ error: "serviceId is required" }, { status: 400 });
  }
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return NextResponse.json(
      { error: "date is required (YYYY-MM-DD)" },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();
  const { data: service, error } = await supabase
    .from("photo_services")
    .select("id, photographer_id, duration_minutes, is_active")
    .eq("id", serviceId)
    .maybeSingle();

  if (error || !service) {
    return NextResponse.json({ error: "Service not found" }, { status: 404 });
  }
  if (!service.is_active) {
    return NextResponse.json({ error: "Service is not available" }, { status: 404 });
  }

  try {
    const slots = await computeAvailableSlots({
      photographerId: service.photographer_id as string,
      dateStr,
      durationMinutes: service.duration_minutes as number,
    });
    return NextResponse.json({ slots });
  } catch (err) {
    console.error("booking/slots GET failed", err);
    return NextResponse.json({ error: "Could not load availability" }, { status: 500 });
  }
}
