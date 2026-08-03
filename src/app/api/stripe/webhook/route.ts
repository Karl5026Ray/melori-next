import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase";
import { executeSplitPayouts } from "@/lib/split-payouts";
import type { MusicItemKind } from "@/lib/music-items";

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
      } else if (session.metadata?.type === "photo_deposit") {
        await fulfillPhotoDeposit(session);
      } else if (session.metadata?.type === "photo_balance") {
        await fulfillPhotoBalance(session);
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

// Records a paid music purchase — legacy release/track OR an artist-uploaded
// studio track/album. Writing the row is what grants the buyer download access
// (verified by /api/music/download). Idempotent on the Stripe session id.
//
// When the checkout carried a transfer_group, the charge settled on the Melori
// platform account because collaborator splits are configured; the payout
// fan-out happens here, after the real Stripe fee is known.
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
  const studioTrackId = meta.studio_track_id || null;
  const studioAlbumId = meta.studio_album_id || null;
  if (!releaseId && !trackId && !studioTrackId && !studioAlbumId) {
    console.error("stripe/webhook music purchase missing item id metadata");
    return;
  }
  const artistId = meta.artist_id ? Number(meta.artist_id) : null;
  const ownerProfileId = meta.owner_profile_id || null;
  const transferGroup = meta.transfer_group || null;

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

  const itemName = typeof meta.item_name === "string" ? meta.item_name : "";
  const amountCents = session.amount_total ?? 0;
  const currency = session.currency || "usd";

  const { data: inserted, error: insErr } = await supabase
    .from("music_purchases")
    .insert({
      buyer_user_id: buyerUserId,
      buyer_email: buyerEmail,
      release_id: releaseId,
      track_id: trackId,
      studio_track_id: studioTrackId,
      studio_album_id: studioAlbumId,
      artist_id: artistId,
      seller_profile_id: ownerProfileId,
      item_name: itemName,
      amount_cents: session.amount_total ?? null,
      currency,
      stripe_session_id: sessionId,
      stripe_payment_intent_id: paymentIntentId,
      connected_account_id:
        typeof meta.connected_account_id === "string"
          ? meta.connected_account_id
          : null,
      transfer_group: transferGroup,
      splits_applied: false,
      status: "paid",
    })
    .select("id")
    .maybeSingle();

  if (insErr) {
    if (insErr.code === "23505") return; // benign race
    throw new Error(`music purchase insert failed: ${insErr.message}`);
  }

  if (!transferGroup) return;

  const itemKind = (meta.item_kind as MusicItemKind | undefined) ?? null;
  const itemId = meta.item_id || null;
  if (!itemKind || !itemId) return;

  const purchaseId = (inserted as { id: string } | null)?.id ?? null;

  // A payout failure must never undo a recorded sale — the buyer paid and has
  // already earned their download. Errors land in the ledger and the logs.
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
    await executeSplitPayouts({
      stripe,
      supabase,
      item: { kind: itemKind, id: itemId, name: itemName, ownerProfileId },
      purchaseId,
      paymentIntentId,
      transferGroup,
      grossCents: amountCents,
      currency,
    });
    if (purchaseId) {
      await supabase
        .from("music_purchases")
        .update({ splits_applied: true })
        .eq("id", purchaseId);
    }
  } catch (err) {
    console.error("stripe/webhook split payout error:", err);
  }
}

// Photography deposit fulfillment — Phase 4. Marks the booking's deposit as
// paid and confirms it. Keyed by metadata.type === 'photo_deposit' (set at
// checkout in /api/booking/create) rather than the `source` tag the other
// branches use, since this checkout isn't tied to a single storefront
// "source" the way gallery/store/music purchases are. Idempotent: a booking
// already marked deposit_paid is left alone on a duplicate delivery.
async function fulfillPhotoDeposit(session: Stripe.Checkout.Session) {
  const supabase = createServiceClient();
  const bookingId = session.metadata?.bookingId;
  if (!bookingId) {
    console.error("stripe/webhook photo_deposit missing bookingId metadata");
    return;
  }

  const { data: booking, error: loadErr } = await supabase
    .from("photo_bookings")
    .select("id, deposit_paid, status")
    .eq("id", bookingId)
    .maybeSingle();

  if (loadErr || !booking) {
    console.error(`stripe/webhook photo_deposit booking not found: ${bookingId}`);
    return;
  }
  if (booking.deposit_paid) return; // already fulfilled — duplicate delivery

  const { error: updateErr } = await supabase
    .from("photo_bookings")
    .update({
      deposit_paid: true,
      status: "confirmed",
      stripe_session_id: session.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", bookingId);

  if (updateErr) {
    throw new Error(`photo_deposit booking update failed: ${updateErr.message}`);
  }
}

// Photography remaining-balance fulfillment. Marks the booking's balance as
// paid. Keyed by metadata.type === 'photo_balance' (set in
// /api/studio/bookings/[id]/balance). Idempotent: a booking already marked
// balance_paid is left alone on a duplicate delivery.
async function fulfillPhotoBalance(session: Stripe.Checkout.Session) {
  const supabase = createServiceClient();
  const bookingId = session.metadata?.bookingId;
  if (!bookingId) {
    console.error("stripe/webhook photo_balance missing bookingId metadata");
    return;
  }

  const { data: booking, error: loadErr } = await supabase
    .from("photo_bookings")
    .select("id, balance_paid")
    .eq("id", bookingId)
    .maybeSingle();

  if (loadErr || !booking) {
    console.error(`stripe/webhook photo_balance booking not found: ${bookingId}`);
    return;
  }
  if (booking.balance_paid) return; // already fulfilled — duplicate delivery

  const { error: updateErr } = await supabase
    .from("photo_bookings")
    .update({
      balance_paid: true,
      balance_cents: session.amount_total ?? undefined,
      balance_session_id: session.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", bookingId);

  if (updateErr) {
    throw new Error(`photo_balance booking update failed: ${updateErr.message}`);
  }
}
