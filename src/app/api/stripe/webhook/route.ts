import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stripe requires the raw, unmodified request body to verify the signature.
// The Next.js App Router gives us the untouched body via req.text(), so there
// is no body-parser interfering with signature verification here.

interface FulfillLine {
  id: string;
  name: string;
  size: string;
  qty: number;
  unit: number;
}

function reassembleCart(metadata: Stripe.Metadata | null): FulfillLine[] {
  if (!metadata) return [];
  let json = "";
  for (let k = 0; metadata[`cart_${k}`] !== undefined; k++) {
    json += metadata[`cart_${k}`];
  }
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as FulfillLine[]) : [];
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_STORE_WEBHOOK_SECRET;

  if (!secret || !webhookSecret) {
    console.error("stripe/webhook: missing STRIPE keys");
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const rawBody = await req.text();
  const stripe = new Stripe(secret);

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "bad signature";
    console.error("stripe/webhook signature error:", msg);
    return NextResponse.json({ error: `Webhook error: ${msg}` }, { status: 400 });
  }

  // Acknowledge quickly; only act on the events we care about.
  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;

      // Only fulfill sessions that originated from the store.
      if (session.metadata?.source === "melorimusic.org/store") {
        await fulfillStoreOrder(session);
      }
    }
  } catch (err) {
    // Log but still return 200 so Stripe does not hammer retries for a
    // non-signature application error; failures are visible in logs.
    console.error("stripe/webhook fulfillment error:", err);
  }

  return NextResponse.json({ received: true });
}

async function fulfillStoreOrder(session: Stripe.Checkout.Session) {
  const supabase = createServiceClient();
  const sessionId = session.id;

  // Idempotency: if this session is already recorded, do nothing.
  const { data: existing } = await supabase
    .from("orders")
    .select("id")
    .eq("stripe_session_id", sessionId)
    .maybeSingle();
  if (existing) return;

  const lines = reassembleCart(session.metadata);
  const totalAmount = (session.amount_total ?? 0) / 100; // dollars, numeric column
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  // Create the order row.
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .insert({
      user_id: null,
      stripe_session_id: sessionId,
      stripe_payment_intent_id: paymentIntentId,
      total_amount: totalAmount,
      status: "paid",
    })
    .select("id")
    .single();

  if (orderErr || !order) {
    throw new Error(`order insert failed: ${orderErr?.message}`);
  }

  // Line items + inventory updates.
  for (const line of lines) {
    await supabase.from("store_order_items").insert({
      order_id: order.id,
      product_id: line.id,
      product_name: line.name,
      size: line.size || "",
      quantity: line.qty,
      unit_price: line.unit,
    });

    // Decrement inventory / increment sold_count atomically.
    await supabase.rpc("record_store_sale", {
      p_product_id: line.id,
      p_qty: line.qty,
    });
  }
}
