import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/membership";
import { approvedOrigin } from "@/lib/approved-origin";
import { getResend, MELORI_FROM, MELORI_REPLY_TO } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// POST /api/studio/bookings/[id]/balance — owner/admin only. Creates a Stripe
// Checkout Session for the REMAINING balance on a booking (service price minus
// the deposit already charged) and emails the client a secure pay link. The
// webhook (type === "photo_balance") marks balance_paid on completion.
//
// Optional body { amountCents } lets Karl override the balance amount — useful
// for the tiered 321 package (extra hours) or the wedding (extra albums), where
// the true balance can exceed price - deposit. When omitted we default to
// (service.price_cents - deposit_cents), clamped at >= 0.
export async function POST(
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
      "id, photographer_id, status, client_name, client_email, deposit_cents, balance_paid, service_id, photo_services(name, price_cents)",
    )
    .eq("id", bookingId)
    .maybeSingle();

  if (loadError || !booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }
  if (booking.photographer_id !== userId && !callerIsAdmin) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }
  if (booking.status === "cancelled") {
    return NextResponse.json(
      { error: "This booking is cancelled." },
      { status: 400 },
    );
  }
  if (booking.balance_paid) {
    return NextResponse.json(
      { error: "The balance for this booking is already paid." },
      { status: 400 },
    );
  }

  const service = Array.isArray(booking.photo_services)
    ? booking.photo_services[0]
    : booking.photo_services;
  const serviceName = (service?.name as string) ?? "Photography session";
  const priceCents = Number.isInteger(service?.price_cents)
    ? (service?.price_cents as number)
    : 0;
  const depositCents = Number.isInteger(booking.deposit_cents)
    ? (booking.deposit_cents as number)
    : 0;

  // Allow an explicit override; otherwise default to price - deposit.
  let body: { amountCents?: number } = {};
  try {
    body = await req.json();
  } catch {
    // no body is fine — use the default
  }
  let balanceCents =
    Number.isInteger(body.amountCents) && (body.amountCents as number) > 0
      ? (body.amountCents as number)
      : Math.max(priceCents - depositCents, 0);

  if (balanceCents <= 0) {
    return NextResponse.json(
      { error: "There is no remaining balance to charge." },
      { status: 400 },
    );
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    return NextResponse.json(
      { error: "Payments are not configured." },
      { status: 503 },
    );
  }

  let checkoutUrl: string;
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
            unit_amount: balanceCents,
            product_data: { name: `Balance — ${serviceName}` },
          },
        },
      ],
      customer_email: (booking.client_email as string) || undefined,
      success_url: `${origin}/book/success?bookingId=${booking.id}&balance=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/pricing`,
      metadata: {
        type: "photo_balance",
        bookingId: String(booking.id),
        photographer_id: String(booking.photographer_id),
      },
    });
    if (!session.url) throw new Error("Stripe returned no checkout URL");
    checkoutUrl = session.url;

    await supabase
      .from("photo_bookings")
      .update({
        balance_cents: balanceCents,
        balance_session_id: session.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", booking.id);
  } catch (err) {
    console.error("studio/bookings/[id]/balance stripe error", err);
    return NextResponse.json(
      { error: "Could not create the balance payment link." },
      { status: 500 },
    );
  }

  // Email the client the secure pay link — best-effort, never blocks the
  // response (Karl still gets the link back to send manually if email fails).
  let emailed = false;
  try {
    const resend = getResend();
    if (resend && booking.client_email) {
      await resend.emails.send({
        from: MELORI_FROM,
        to: [booking.client_email as string],
        replyTo: MELORI_REPLY_TO,
        subject: `Balance due for your ${serviceName}`,
        html: `<p>Hi ${booking.client_name},</p><p>The remaining balance for your <strong>${serviceName}</strong> is <strong>${formatMoney(balanceCents)}</strong>. You can pay securely here:</p><p><a href="${checkoutUrl}">Pay your balance</a></p><p>Thank you!<br/>— Karl Ray Photography</p>`,
      });
      emailed = true;
    }
  } catch (err) {
    console.warn("studio/bookings/[id]/balance email failed", err);
  }

  return NextResponse.json({
    ok: true,
    checkoutUrl,
    balanceCents,
    emailed,
  });
}
