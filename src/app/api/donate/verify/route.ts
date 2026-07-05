import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// In-process cache of sessions we've already emailed. Keeps refreshes of the
// success page from spamming the donor with duplicate thank-yous. Not perfect
// (survives only until the serverless instance is recycled), but drastically
// reduces the duplicate rate. Proper idempotency will require a persisted
// `donation_emails_sent` table.
const emailedSessions = new Set<string>();

export async function GET(req: NextRequest) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json(
      { ok: false, error: "Missing session_id" },
      { status: 400 }
    );
  }

  const stripe = new Stripe(secret);

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const paid =
      session.payment_status === "paid" ||
      session.payment_status === "no_payment_required";
    const amount = session.amount_total ? session.amount_total / 100 : 0;

    // Best-effort thank-you email (Resend connector currently unreliable).
    // Only fires for donations that originated from this app's own donate
    // page — previously ANY paid Stripe session id (subscriptions, store
    // checkouts) that happened to be passed in would trigger a donation
    // thank-you email. Also throttled by an in-process cache so refreshing
    // the success page doesn't send a second email.
    const resendKey = process.env.RESEND_API_KEY;
    const email = session.customer_details?.email || session.customer_email;
    const isDonation =
      session.metadata?.source === "melorimusic.org/donate";
    if (
      paid &&
      isDonation &&
      resendKey &&
      email &&
      !emailedSessions.has(sessionId)
    ) {
      emailedSessions.add(sessionId);
      // Cap the set so a very long-lived instance doesn't grow forever.
      if (emailedSessions.size > 5000) {
        const first = emailedSessions.values().next().value;
        if (first) emailedSessions.delete(first);
      }
      try {
        const { Resend } = await import("resend");
        const resend = new Resend(resendKey);
        await resend.emails.send({
          from: "Melori Music <support@melorimusic.org>",
          to: [email],
          replyTo: "karlrayphotography@gmail.com",
          subject: "Thank you for supporting Melori Music",
          html: `<p>Thank you for your generous donation of $${amount.toFixed(
            2,
          )}.</p><p>Your support helps us pay independent artists and build a better home for their music.</p><p>— Karl Ray, Melori Music</p>`,
        });
      } catch (e) {
        // If the send fails, drop the guard so the user can retry.
        emailedSessions.delete(sessionId);
        console.error("donate/verify email error", e);
      }
    }

    return NextResponse.json({
      ok: paid,
      amount,
      email: email || null,
    });
  } catch (err) {
    console.error("donate/verify error", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
