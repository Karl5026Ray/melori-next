import { NextRequest, NextResponse } from "next/server";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/membership";
import { deleteCalendarEvent } from "@/lib/google-calendar";
import { getResend, MELORI_FROM, MELORI_REPLY_TO } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES = ["pending", "confirmed", "cancelled", "completed"] as const;
type Status = (typeof VALID_STATUSES)[number];

function formatWhen(startsAtIso: string, timezone: string): string {
  try {
    return new Date(startsAtIso).toLocaleString("en-US", {
      timeZone: timezone,
      dateStyle: "full",
      timeStyle: "short",
    });
  } catch {
    return startsAtIso;
  }
}

// PATCH /api/studio/bookings/[id] — owner/admin only. Body { status }.
// Transitions to confirmed/cancelled/completed. Cancel does a best-effort
// Google Calendar event delete + emails the client; none of that failing
// blocks the status change from saving.
export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;
  const callerIsAdmin = isAdmin(guard.membership.profile);

  const { id: bookingId } = await props.params;
  const supabase = getSupabaseAdmin();

  const { data: booking, error: loadError } = await supabase
    .from("photo_bookings")
    .select(
      "id, photographer_id, service_id, client_name, client_email, starts_at, status, google_event_id, photo_services(name)",
    )
    .eq("id", bookingId)
    .maybeSingle();

  if (loadError || !booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }
  if (booking.photographer_id !== userId && !callerIsAdmin) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  let body: { status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const nextStatus = body.status as Status | undefined;
  if (!nextStatus || !VALID_STATUSES.includes(nextStatus)) {
    return NextResponse.json(
      { error: `status must be one of ${VALID_STATUSES.join(", ")}` },
      { status: 400 },
    );
  }

  const { data: updated, error: updateError } = await supabase
    .from("photo_bookings")
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq("id", bookingId)
    .select(
      "id, service_id, client_name, client_email, client_phone, starts_at, ends_at, status, notes, deposit_cents, deposit_paid, google_event_id",
    )
    .single();

  if (updateError || !updated) {
    console.error("studio/bookings/[id] PATCH failed", updateError?.message);
    return NextResponse.json({ error: "Could not update booking" }, { status: 500 });
  }

  // Cancel: best-effort remove the Google Calendar event + notify the client.
  // Neither failure should block the status change we already committed.
  if (nextStatus === "cancelled") {
    if (booking.google_event_id) {
      try {
        await deleteCalendarEvent(booking.photographer_id as string, booking.google_event_id as string);
      } catch (err) {
        console.warn("studio/bookings/[id] deleteCalendarEvent failed", err);
      }
    }

    try {
      const resend = getResend();
      if (resend) {
        const { data: settings } = await supabase
          .from("photographer_settings")
          .select("timezone")
          .eq("photographer_id", booking.photographer_id as string)
          .maybeSingle();
        const tz = (settings?.timezone as string) || "America/Chicago";
        const service = Array.isArray(booking.photo_services)
          ? booking.photo_services[0]
          : booking.photo_services;
        const when = formatWhen(booking.starts_at as string, tz);

        await resend.emails.send({
          from: MELORI_FROM,
          to: [booking.client_email as string],
          replyTo: MELORI_REPLY_TO,
          subject: "Your photo session has been cancelled",
          html: `<p>Hi ${booking.client_name},</p><p>Your ${service?.name ?? "photography"} session on ${when} has been cancelled. Please reach out if you'd like to rebook.</p><p>— Karl Ray Photography</p>`,
        });
      }
    } catch (err) {
      console.warn("studio/bookings/[id] cancel email failed", err);
    }
  }

  return NextResponse.json({ booking: updated });
}
