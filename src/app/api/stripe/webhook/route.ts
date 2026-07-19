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

      // Fulfill by the source tag stamped at checkout time.
      const source = session.metadata?.source;
      if (source === "melorimusic.org/store") {
        await fulfillStoreOrder(session);
      } else if (source === "melorimusic.org/gallery") {
        await fulfillGalleryPurchase(session);
      } else if (source === "melorimusic.org/artist-purchase") {
        await fulfillMusicPurchase(session);
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

  // Prefer client_reference_id (set at checkout when the buyer was signed in),
  // fall back to the copy we stashed in metadata for defense-in-depth.
  const buyerUserId =
    session.client_reference_id ||
    (typeof session.metadata?.user_id === "string"
      ? session.metadata.user_id
      : null) ||
    null;

  // Create the order row.
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .insert({
      user_id: buyerUserId,
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

  // Line items + inventory updates. We surface any failure so it appears in
  // logs — previously errors from either call were silently discarded, letting
  // inventory drift out of sync with paid orders.
  for (const line of lines) {
    const { error: itemErr } = await supabase.from("store_order_items").insert({
      order_id: order.id,
      product_id: line.id,
      product_name: line.name,
      size: line.size || "",
      quantity: line.qty,
      unit_price: line.unit,
    });
    if (itemErr) {
      console.error(
        `stripe/webhook order_item insert failed order=${order.id} product=${line.id}:`,
        itemErr.message,
      );
    }

    // Decrement inventory / increment sold_count atomically.
    const { error: rpcErr } = await supabase.rpc("record_store_sale", {
      p_product_id: line.id,
      p_qty: line.qty,
    });
    if (rpcErr) {
      console.error(
        `stripe/webhook record_store_sale failed order=${order.id} product=${line.id}:`,
        rpcErr.message,
      );
    }
  }
}

// Gallery digital-download fulfillment. Idempotent on stripe_session_id (unique
// column): a duplicate webhook delivery inserts nothing. The /gallery/download
// route reads the row this creates to authorize the signed original URL.
async function fulfillGalleryPurchase(session: Stripe.Checkout.Session) {
  const supabase = createServiceClient();
  const sessionId = session.id;

  const { data: existing } = await supabase
    .from("photo_gallery_purchases")
    .select("id")
    .eq("stripe_session_id", sessionId)
    .maybeSingle();
  if (existing) return;

  const imageId = session.metadata?.image_id;
  const galleryId = session.metadata?.gallery_id;
  if (!imageId || !galleryId) {
    console.error("stripe/webhook gallery purchase missing metadata ids");
    return;
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  const buyerUserId =
    session.client_reference_id ||
    (typeof session.metadata?.user_id === "string"
      ? session.metadata.user_id
      : null) ||
    null;

  const buyerEmail =
    session.customer_details?.email || session.customer_email || null;

  const { error: insErr } = await supabase
    .from("photo_gallery_purchases")
    .insert({
      image_id: imageId,
      gallery_id: galleryId,
      buyer_user_id: buyerUserId,
      buyer_email: buyerEmail,
      stripe_session_id: sessionId,
      stripe_payment_intent_id: paymentIntentId,
      amount_cents: session.amount_total ?? null,
      status: "paid",
    });

  if (insErr) {
    // Unique-violation from a race with a concurrent delivery is benign.
    if (insErr.code === "23505") return;
    throw new Error(`gallery purchase insert failed: ${insErr.message}`);
  }
}

// Records a paid album/single-track purchase. Writing the row is what grants
// the buyer download access (verified by /api/music/download). Idempotent on
// the Stripe session id.
async function fulfillMusicPurchase(session: Stripe.Checkout.Session) {
  const supabase = createServiceClient();
  const sessionId = session.id;

  const { data: existing } = await supabase
    .from("music_purchases")
    .select("id")
    .eq("stripe_session_id", sessionId)
    .maybeSingle();
  if (existing) return;

  const meta = session.metadata ?? {};
  const releaseId = meta.release_id ? Number(meta.release_id) : null;
  const trackId = meta.track_id ? Number(meta.track_id) : null;
  if (!releaseId && !trackId) {
    console.error("stripe/webhook music purchase missing release_id/track_id");
    return;
  }
  const artistId = meta.artist_id ? Number(meta.artist_id) : null;

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  const buyerUserId =
    session.client_reference_id ||
    (typeof meta.user_id === "string" ? meta.user_id : null) ||
    null;

  const buyerEmail =
    session.customer_details?.email || session.customer_email || null;

  const { error: insErr } = await supabase.from("music_purchases").insert({
    buyer_user_id: buyerUserId,
    buyer_email: buyerEmail,
    release_id: releaseId,
    track_id: trackId,
    artist_id: artistId,
    item_name: typeof meta.item_name === "string" ? meta.item_name : "",
    amount_cents: session.amount_total ?? null,
    stripe_session_id: sessionId,
    stripe_payment_intent_id: paymentIntentId,
    connected_account_id:
      typeof meta.connected_account_id === "string"
        ? meta.connected_account_id
        : null,
    status: "paid",
  });

  if (insErr) {
    if (insErr.code === "23505") return; // benign race
    throw new Error(`music purchase insert failed: ${insErr.message}`);
  }
}
