import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { approvedOrigin } from "@/lib/approved-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  amount?: number;
  name?: string;
  email?: string;
  message?: string;
}

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    return NextResponse.json(
      { error: "Donations are not configured yet. Please try again later." },
      { status: 503 }
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const amount = Number(body?.amount);
  if (!amount || isNaN(amount) || amount < 1) {
    return NextResponse.json(
      { error: "Amount must be at least $1." },
      { status: 400 }
    );
  }
  if (amount > 10000) {
    return NextResponse.json(
      { error: "Please contact us for donations over $10,000." },
      { status: 400 }
    );
  }

  // Locked to approved hosts — see src/lib/approved-origin.ts.
  const origin = approvedOrigin(req);

  const stripe = new Stripe(secret);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: Math.round(amount * 100),
            product_data: {
              name: "Donation to Melori Music",
              description: "Supports independent artists on Melori.",
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/donate/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/donate`,
      customer_email: body.email?.trim() || undefined,
      metadata: {
        donor_name: body.name?.trim()?.slice(0, 200) || "",
        donor_message: body.message?.trim()?.slice(0, 500) || "",
        source: "melorimusic.org/donate",
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Stripe error";
    console.error("donate/checkout error", msg);
    return NextResponse.json(
      { error: "Could not start checkout. Please try again." },
      { status: 500 }
    );
  }
}
