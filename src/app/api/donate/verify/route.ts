import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    const resendKey = process.env.RESEND_API_KEY;
    const email = session.customer_details?.email || session.customer_email;
    if (paid && resendKey && email) {
      try {
        const { Resend } = await import("resend");
        const resend = new Resend(resendKey);
        await resend.emails.send({
          from: "Melori Music <support@melorimusic.org>",
          to: [email],
          replyTo: "karlrayphotography@gmail.com",
          subject: "Thank you for supporting Melori Music",
          html: `<p>Thank you for your generous donation of $${amount.toFixed(
            2
          )}.</p><p>Your support helps us pay independent artists and build a better home for their music.</p><p>— Karl Ray, Melori Music</p>`,
        });
      } catch (e) {
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
