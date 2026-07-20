import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";
import { approvedOrigin } from "@/lib/approved-origin";
import { isSlotStillFree } from "@/lib/booking-availability";
import { createCalendarEvent } from "@/lib/google-calendar";
import { getResend, MELORI_FROM, MELORI_REPLY_TO } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Karl's own profile id — used as the confirmation-alert recipient. Admin
// per PHOTOG_MODULE_SPEC.md.
const PHOTOGRAPHER_ALERT_EMAIL = "karlrayphotography@gmail.com";

interface CreateBody {
  serviceId?: string;
  startsAt?: string;
  clientName?: string;
  clientEmail?: string;
  clientPhone?: string;
  notes?: string;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

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

// POST /api/booking/create — PUBLIC (guest allowed; attaches the caller's
// user id if a bearer token is present). Body:
// { serviceId, startsAt, clientName, clientEmail, clientPhone?, notes? }.
//
// Re-validates the slot server-side (never trusts the client), inserts the
// booking, best-effort writes a Google Calendar event (skips cleanly if not
// connected/configured), sends confirmation emails, and — ONLY if the
// service has a deposit configured — starts a Stripe Checkout session. The
// $0/no-deposit path is the default and must fully work without Stripe or
// Google being configured at all.
export async function POST(req: NextRequest) {
  let body: CreateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const serviceId = typeof body.serviceId === "string" ? body.serviceId : "";
  const startsAt = typeof body.startsAt === "string" ? body.startsAt : "";
  const clientName = typeof body.clientName === "string" ? body.clientName.trim() : "";
  const clientEmail = typeof body.clientEmail === "string" ? body.clientEmail.trim() : "";
  const clientPhone =
    typeof body.clientPhone === "string" && body.clientPhone.trim()
      ? body.clientPhone.trim()
      : null;
  const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;

  if (!serviceId || !startsAt) {
    return NextResponse.json(
      { error: "serviceId and startsAt are required" },
      { status: 400 },
    );
  }
  if (!clientName) {
    return NextResponse.json({ error: "clientName is required" }, { status: 400 });
  }
  if (!clientEmail || !isValidEmail(clientEmail)) {
    return NextResponse.json({ error: "A valid clientEmail is required" }, { status: 400 });
  }
  if (Number.isNaN(new Date(startsAt).getTime())) {
    return NextResponse.json({ error: "Invalid startsAt" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: service, error: serviceError } = await supabase
    .from("photo_services")
    .select("id, photographer_id, name, duration_minutes, deposit_cents, deposit_percent, price_cents, is_active")
    .eq("id", serviceId)
    .maybeSingle();

  if (serviceError || !service || !service.is_active) {
    return NextResponse.json({ error: "Service not found" }, { status: 404 });
  }

  const photographerId = service.photographer_id as string;
  const durationMinutes = service.duration_minutes as number;

  // NEVER trust the client's chosen slot — re-run the exact same
  // availability check server-side.
  const { free, endsAtIso } = await isSlotStillFree({
    photographerId,
    startsAtIso: startsAt,
    durationMinutes,
  });
  if (!free) {
    return NextResponse.json(
      { error: "That time is no longer available. Please pick another slot." },
      { status: 409 },
    );
  }

  // Attach the caller's user id if signed in — guest booking is allowed.
  const membership = await getRequestMembership(req).catch(() => null);
  const clientUserId = membership?.userId ?? null;

  // Deposit scaffold: fixed cents takes priority, then percent-of-price.
  let depositCents = 0;
  if (Number.isInteger(service.deposit_cents) && (service.deposit_cents as number) > 0) {
    depositCents = service.deposit_cents as number;
  } else if (
    Number.isInteger(service.deposit_percent) &&
    (service.deposit_percent as number) > 0 &&
    Number.isInteger(service.price_cents)
  ) {
    depositCents = Math.round(
      ((service.price_cents as number) * (service.deposit_percent as number)) / 100,
    );
  }

  const requiresDeposit = depositCents > 0;
  const initialStatus = requiresDeposit ? "pending" : "confirmed";

  const { data: booking, error: insertError } = await supabase
    .from("photo_bookings")
    .insert({
      photographer_id: photographerId,
      service_id: service.id,
      client_user_id: clientUserId,
      client_name: clientName,
      client_email: clientEmail,
      client_phone: clientPhone,
      starts_at: startsAt,
      ends_at: endsAtIso,
      status: initialStatus,
      notes,
      deposit_cents: depositCents,
      deposit_paid: false,
    })
    .select("id, starts_at, ends_at, status, deposit_cents")
    .single();

  if (insertError || !booking) {
    console.error("booking/create insert failed", insertError?.message);
    return NextResponse.json({ error: "Could not create booking" }, { status: 500 });
  }

  // Best-effort Google Calendar write-back. createCalendarEvent already
  // fails gracefully (returns null + logs) when not configured/connected —
  // never let this block the booking.
  try {
    const eventId = await createCalendarEvent(photographerId, {
      summary: `Shoot: ${service.name} — ${clientName}`,
      description: [
        `Client: ${clientName} (${clientEmail}${clientPhone ? `, ${clientPhone}` : ""})`,
        notes ? `Notes: ${notes}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      start: booking.starts_at as string,
      end: booking.ends_at as string,
      attendeeEmail: clientEmail,
    });
    if (eventId) {
      await supabase
        .from("photo_bookings")
        .update({ google_event_id: eventId })
        .eq("id", booking.id);
    }
  } catch (err) {
    console.warn("booking/create createCalendarEvent failed", err);
  }

  // Confirmation emails — best-effort, never blocks the booking response.
  try {
    const resend = getResend();
    if (resend) {
      const { data: settings } = await supabase
        .from("photographer_settings")
        .select("timezone")
        .eq("photographer_id", photographerId)
        .maybeSingle();
      const tz = (settings?.timezone as string) || "America/Chicago";
      const when = formatWhen(booking.starts_at as string, tz);
      const statusLine = requiresDeposit
        ? "Your booking is reserved pending a deposit payment."
        : "Your booking is confirmed.";

      await resend.emails.send({
        from: MELORI_FROM,
        to: [clientEmail],
        replyTo: MELORI_REPLY_TO,
        subject: `Booking received: ${service.name}`,
        html: `<p>Hi ${clientName},</p><p>Thanks for booking a <strong>${service.name}</strong> session on <strong>${when}</strong>. ${statusLine}</p><p>Location details to follow. Reply to this email with any questions.</p><p>— Karl Ray Photography</p>`,
      });

      await resend.emails.send({
        from: MELORI_FROM,
        to: [PHOTOGRAPHER_ALERT_EMAIL],
        replyTo: MELORI_REPLY_TO,
        subject: `New booking: ${service.name} — ${clientName}`,
        html: `<p>New ${service.name} booking from ${clientName} (${clientEmail}${clientPhone ? `, ${clientPhone}` : ""}) for ${when}.</p>${notes ? `<p>Notes: ${notes}</p>` : ""}<p>Status: ${initialStatus}</p>`,
      });
    }
  } catch (err) {
    console.warn("booking/create confirmation emails failed", err);
  }

  if (!requiresDeposit) {
    return NextResponse.json({ bookingId: booking.id, checkoutUrl: null });
  }

  // Deposit path — wired but deferred; the $0 path above is the default.
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    // No Stripe configured: keep the booking pending rather than failing the
    // whole request — Karl can confirm manually.
    console.warn("booking/create: deposit required but STRIPE_SECRET_KEY missing");
    return NextResponse.json({ bookingId: booking.id, checkoutUrl: null });
  }

  try {
    const origin = approvedOrigin(req);
    const stripe = new Stripe(secret);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: depositCents,
            product_data: {
              name: `Deposit — ${service.name}`,
            },
          },
        },
      ],
      customer_email: clientEmail,
      success_url: `${origin}/book/success?bookingId=${booking.id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/book?serviceId=${service.id}`,
      metadata: {
        type: "photo_deposit",
        bookingId: String(booking.id),
        photographer_id: photographerId,
      },
    });

    await supabase
      .from("photo_bookings")
      .update({ stripe_session_id: session.id })
      .eq("id", booking.id);

    return NextResponse.json({ bookingId: booking.id, checkoutUrl: session.url });
  } catch (err) {
    console.error("booking/create stripe checkout failed", err);
    // Booking already exists as pending; client can still see success page
    // and Karl can follow up manually.
    return NextResponse.json({ bookingId: booking.id, checkoutUrl: null });
  }
}
