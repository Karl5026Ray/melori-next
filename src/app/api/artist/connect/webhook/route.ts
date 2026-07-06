import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { syncPayoutRowFromAccount } from "@/lib/artist-payouts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/artist/connect/webhook
// Handles Stripe Connect `account.updated` events and mirrors the connected
// account's capability flags onto artist_payouts (matched by
// stripe_connect_account_id).
//
// Tolerant by design: if STRIPE_CONNECT_WEBHOOK_SECRET (or the Stripe key) is
// not set yet, we log and return 200 so Stripe doesn't retry-storm before the
// secret is wired in Vercel. Signature is verified once the secret is present.
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;

  if (!secret || !webhookSecret) {
    console.warn(
      "artist/connect/webhook: STRIPE_CONNECT_WEBHOOK_SECRET not configured; acknowledging without processing.",
    );
    return NextResponse.json({ received: true, skipped: true });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const rawBody = await req.text();
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "bad signature";
    console.error("artist/connect/webhook signature error:", msg);
    return NextResponse.json({ error: `Webhook error: ${msg}` }, { status: 400 });
  }

  try {
    if (event.type === "account.updated") {
      const account = event.data.object as Stripe.Account;
      await syncPayoutRowFromAccount(account, getSupabaseAdmin());
    }
  } catch (err) {
    // Log but still 200 so Stripe doesn't hammer retries for an application
    // error unrelated to signature verification.
    console.error("artist/connect/webhook processing error:", err);
  }

  return NextResponse.json({ received: true });
}
