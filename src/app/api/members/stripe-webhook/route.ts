import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase";
import { executeSplitPayouts } from "@/lib/split-payouts";
import type { MusicItemKind } from "@/lib/music-items";
import {
  buildMembershipUpdate,
  classifyPrice,
  type Interval,
  type Tier,
} from "@/lib/membership-sync";
import { ensureArtistRow } from "@/lib/artist";
import { banAuthUser, unbanAuthUser } from "@/lib/account-lockout";
import {
  constructWebhookEvent,
  webhookSecretCandidates,
  type StripeAccountOrigin,
} from "@/lib/stripe";
import {
  COIN_PACK_SOURCE,
  coinPackCreditReference,
  isCoinPackCheckoutMetadata,
} from "@/lib/gifting";
import { isUuid } from "@/lib/validators";

// ---------------------------------------------------------------------------
// MERGED Stripe webhook — replaces the two previously-separate endpoints:
//   - /api/stripe/webhook          (one-time purchases: store, gallery,
//                                    music, photo deposit/balance)
//   - /api/members/stripe-webhook  (subscriptions: membership tiers, login
//                                    lockout, artist role grant)
//
// Both endpoints were registered in Stripe with near-identical event lists,
// each carrying its own signing secret. That's two secrets to keep in sync
// with Vercel env vars instead of one, and it's why a stale secret on one
// side (the members endpoint) started failing signature verification while
// the other kept working. One endpoint, one secret, same event volume.
//
// Dispatch logic is unchanged from the two originals — this file interleaves
// them, it does not rewrite their behavior:
//   - checkout.session.completed with mode "subscription"  -> membership path
//   - checkout.session.completed with any other mode        -> one-time path,
//     routed by session.metadata.source / metadata.type exactly as before
//   - subscription + invoice events                          -> membership path
//
// Error-handling philosophy is preserved per path, on purpose:
//   - Membership handler errors return 500 so Stripe retries (the handler is
//     idempotent — see logEvent / membership_events unique constraint).
//   - Existing one-time fulfillment errors are logged but acknowledged with
//     200 because those handlers do not yet share a durable idempotency model.
//   - Coin-pack fulfillment returns 500 because its ledger reference makes
//     retries idempotent and acknowledging failure would lose purchased value.
// ---------------------------------------------------------------------------

const LOCKOUT_ENABLED = process.env.SNAPPD_LOGIN_LOCKOUT !== "false";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

// Dual-account inbound verification, carried over from the members webhook.
// STRIPE_WEBHOOK_SECRET_LEGACY is optional: with it unset there is a single
// candidate and behaviour is identical to verifying against the primary
// secret alone. Remove the legacy half once the last legacy subscription has
// lapsed.
function webhookSecrets() {
  return webhookSecretCandidates(
    process.env.STRIPE_MEMBERS_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET,
    process.env.STRIPE_WEBHOOK_SECRET_LEGACY,
  );
}

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_SECRET_KEY;
  const secrets = webhookSecrets();

  if (!secret || secrets.length === 0) {
    console.error("stripe-webhook: missing STRIPE keys");
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const rawBody = await req.text();
  const stripe = new Stripe(secret);

  let event: Stripe.Event;
  let origin: StripeAccountOrigin;
  try {
    ({ event, origin } = constructWebhookEvent(stripe, rawBody, sig, secrets));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "bad signature";
    console.error("stripe-webhook signature error:", msg);
    return NextResponse.json({ error: `Webhook error: ${msg}` }, { status: 400 });
  }

  if (origin === "legacy") {
    console.info(`stripe-webhook: legacy-account event ${event.id} (${event.type})`);
  }

  const supabase = createServiceClient();

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    if (session.mode === "subscription") {
      try {
        await applySubscriptionState(stripe, supabase, event, origin, {
          customerId:
            typeof session.customer === "string"
              ? session.customer
              : session.customer?.id ?? null,
          subscriptionId:
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription?.id ?? null,
          email:
            session.customer_details?.email ?? session.customer_email ?? null,
          amountTotal: session.amount_total ?? null,
          status: "active",
        });
      } catch (err) {
        console.error("stripe-webhook membership handler error:", err);
        return NextResponse.json({ error: "handler_failed" }, { status: 500 });
      }
      return NextResponse.json({ received: true });
    }

    // Coin purchases have an idempotent ledger reference and can safely ask
    // Stripe to retry a failed credit.
    const source = session.metadata?.source;
    if (source === COIN_PACK_SOURCE) {
      try {
        await fulfillCoinPack(session, supabase);
      } catch (err) {
        console.error("stripe-webhook coin fulfillment error:", err);
        return NextResponse.json({ error: "fulfillment_failed" }, { status: 500 });
      }
      return NextResponse.json({ received: true });
    }

    // Existing one-time purchases preserve their previous acknowledgement
    // behavior until each flow has its own durable idempotency/replay contract.
    try {
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
    } catch (err) {
      console.error("stripe-webhook fulfillment error:", err);
    }
    return NextResponse.json({ received: true });
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted" ||
    event.type === "invoice.paid" ||
    event.type === "invoice.payment_failed"
  ) {
    try {
      await handleMembershipEvent(stripe, supabase, event, origin);
    } catch (err) {
      // Return 500 (not 200) so Stripe RETRIES on its bounded schedule. The
      // whole handler is idempotent (deterministic profile update +
      // unique-constrained membership_events), so a retry safely re-applies
      // the same state.
      console.error("stripe-webhook membership handler error:", err);
      return NextResponse.json({ error: "handler_failed" }, { status: 500 });
    }
    return NextResponse.json({ received: true });
  }

  // Log unhandled event types too, so nothing is silently dropped.
  try {
    await logEvent(supabase, event, {
      customerId: null,
      subscriptionId: null,
      email: null,
      tier: null,
      interval: null,
      status: null,
      amountTotal: null,
      currentPeriodEnd: null,
    });
  } catch (err) {
    console.error("stripe-webhook: failed to log unhandled event", err);
  }
  return NextResponse.json({ received: true });
}

// ---------------------------------------------------------------------------
// One-time purchase fulfillment — unchanged from /api/stripe/webhook.
// ---------------------------------------------------------------------------

async function fulfillCoinPack(
  session: Stripe.Checkout.Session,
  supabase: ReturnType<typeof createServiceClient>,
) {
  const metadata = session.metadata;
  if (!isCoinPackCheckoutMetadata(metadata)) {
    throw new Error("coin-pack checkout missing required metadata");
  }
  if (session.payment_status !== "paid") {
    throw new Error(`coin-pack checkout is not paid (${session.payment_status})`);
  }

  const packId = metadata!.pack_id!;
  const userId = metadata!.user_id!;
  if (!isUuid(packId) || !isUuid(userId)) {
    throw new Error("coin-pack checkout has invalid identifiers");
  }
  const { data: pack, error: packError } = await supabase
    .from("coin_packs")
    .select("id, coin_amount, price_usd_cents, active")
    .eq("id", packId)
    .maybeSingle();
  if (packError || !pack || !pack.active) {
    throw new Error(`coin-pack not found or inactive: ${packId}`);
  }
  if (session.amount_total !== pack.price_usd_cents) {
    throw new Error(`coin-pack amount mismatch for ${packId}`);
  }

  // The unique (user_id, reference_id) ledger row makes this call idempotent
  // for Stripe's retries and duplicate delivery. The reference is a Stripe
  // session id, not a browser-supplied value.
  const { error } = await supabase.rpc("credit_wallet", {
    p_user_id: userId,
    p_coins: pack.coin_amount,
    p_reference_id: coinPackCreditReference(session.id),
  });
  if (error) throw new Error(`coin-pack wallet credit failed: ${error.message}`);
}

async function fulfillStoreOrder(session: Stripe.Checkout.Session) {
  const supabase = createServiceClient();
  const sessionId = session.id;

  const { data: existing } = await supabase
    .from("orders")
    .select("id")
    .eq("stripe_session_id", sessionId)
    .maybeSingle();
  if (existing) return;

  const lines = reassembleCart(session.metadata);
  const totalAmount = (session.amount_total ?? 0) / 100;
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
        `stripe-webhook order_item insert failed order=${order.id} product=${line.id}:`,
        itemErr.message,
      );
    }

    const { error: rpcErr } = await supabase.rpc("record_store_sale", {
      p_product_id: line.id,
      p_qty: line.qty,
    });
    if (rpcErr) {
      console.error(
        `stripe-webhook record_store_sale failed order=${order.id} product=${line.id}:`,
        rpcErr.message,
      );
    }
  }
}

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
    console.error("stripe-webhook gallery purchase missing metadata ids");
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
    if (insErr.code === "23505") return;
    throw new Error(`gallery purchase insert failed: ${insErr.message}`);
  }
}

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
    console.error("stripe-webhook music purchase missing item id metadata");
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
    if (insErr.code === "23505") return;
    throw new Error(`music purchase insert failed: ${insErr.message}`);
  }

  if (!transferGroup) return;

  const itemKind = (meta.item_kind as MusicItemKind | undefined) ?? null;
  const itemId = meta.item_id || null;
  if (!itemKind || !itemId) return;

  const purchaseId = (inserted as { id: string } | null)?.id ?? null;

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
    console.error("stripe-webhook split payout error:", err);
  }
}

async function fulfillPhotoDeposit(session: Stripe.Checkout.Session) {
  const supabase = createServiceClient();
  const bookingId = session.metadata?.bookingId;
  if (!bookingId) {
    console.error("stripe-webhook photo_deposit missing bookingId metadata");
    return;
  }

  const { data: booking, error: loadErr } = await supabase
    .from("photo_bookings")
    .select("id, deposit_paid, status")
    .eq("id", bookingId)
    .maybeSingle();

  if (loadErr || !booking) {
    console.error(`stripe-webhook photo_deposit booking not found: ${bookingId}`);
    return;
  }
  if (booking.deposit_paid) return;

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

async function fulfillPhotoBalance(session: Stripe.Checkout.Session) {
  const supabase = createServiceClient();
  const bookingId = session.metadata?.bookingId;
  if (!bookingId) {
    console.error("stripe-webhook photo_balance missing bookingId metadata");
    return;
  }

  const { data: booking, error: loadErr } = await supabase
    .from("photo_bookings")
    .select("id, balance_paid")
    .eq("id", bookingId)
    .maybeSingle();

  if (loadErr || !booking) {
    console.error(`stripe-webhook photo_balance booking not found: ${bookingId}`);
    return;
  }
  if (booking.balance_paid) return;

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

// ---------------------------------------------------------------------------
// Membership / subscription handling — unchanged from /api/members/stripe-webhook.
// ---------------------------------------------------------------------------

async function handleMembershipEvent(
  stripe: Stripe,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  event: Stripe.Event,
  origin: StripeAccountOrigin,
) {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const item = sub.items?.data?.[0];
      const amount = item?.price?.unit_amount ?? null;
      const priceId = item?.price?.id ?? null;
      const interval = item?.price?.recurring?.interval ?? null;
      const isCanceled =
        event.type === "customer.subscription.deleted" ||
        sub.status === "canceled" ||
        sub.status === "unpaid" ||
        sub.status === "incomplete_expired";

      await applySubscriptionState(stripe, supabase, event, origin, {
        customerId:
          typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null,
        subscriptionId: sub.id,
        email: null,
        amountTotal: amount,
        priceId,
        intervalOverride: (interval as Interval) ?? null,
        status: isCanceled
          ? "canceled"
          : sub.status === "active" || sub.status === "trialing"
            ? "active"
            : sub.status,
        currentPeriodEnd: sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null,
        clearOnCancel: isCanceled,
      });
      return;
    }

    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const line = invoice.lines?.data?.[0];
      const amount = line?.amount ?? invoice.amount_paid ?? null;
      await applySubscriptionState(stripe, supabase, event, origin, {
        customerId:
          typeof invoice.customer === "string"
            ? invoice.customer
            : invoice.customer?.id ?? null,
        subscriptionId:
          typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription?.id ?? null,
        email: invoice.customer_email ?? null,
        amountTotal: amount,
        status: "active",
        currentPeriodEnd: line?.period?.end
          ? new Date(line.period.end * 1000).toISOString()
          : null,
      });
      return;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      await applySubscriptionState(stripe, supabase, event, origin, {
        customerId:
          typeof invoice.customer === "string"
            ? invoice.customer
            : invoice.customer?.id ?? null,
        subscriptionId:
          typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription?.id ?? null,
        email: invoice.customer_email ?? null,
        amountTotal: invoice.amount_due ?? null,
        status: "past_due",
      });
      return;
    }

    default:
      return;
  }
}

interface StateArgs {
  customerId: string | null;
  subscriptionId: string | null;
  email: string | null;
  amountTotal: number | null;
  priceId?: string | null;
  status: string;
  intervalOverride?: Interval;
  currentPeriodEnd?: string | null;
  clearOnCancel?: boolean;
}

async function applySubscriptionState(
  stripe: Stripe,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  event: Stripe.Event,
  origin: StripeAccountOrigin,
  args: StateArgs,
) {
  const { tier, interval } = classifyPrice({
    amountCents: args.amountTotal,
    priceId: args.priceId ?? null,
    interval: args.intervalOverride ?? null,
  });
  const resolvedInterval = args.intervalOverride ?? interval;

  let email = args.email;
  if (!email && args.customerId && origin === "primary") {
    try {
      const customer = await stripe.customers.retrieve(args.customerId);
      if (customer && !("deleted" in customer && customer.deleted)) {
        email = (customer as Stripe.Customer).email ?? null;
      }
    } catch {
      /* non-fatal */
    }
  }

  await logEvent(supabase, event, {
    customerId: args.customerId,
    subscriptionId: args.subscriptionId,
    email,
    tier,
    interval: resolvedInterval,
    status: args.status,
    amountTotal: args.amountTotal,
    currentPeriodEnd: args.currentPeriodEnd ?? null,
  });

  const profile = await findProfile(supabase, {
    customerId: args.customerId,
    subscriptionId: args.subscriptionId,
    email,
  });
  if (!profile) {
    return;
  }

  const update = buildMembershipUpdate(
    {
      tier,
      interval: resolvedInterval,
      customerId: args.customerId,
      subscriptionId: args.subscriptionId,
      status: args.status,
      currentPeriodEnd: args.currentPeriodEnd ?? null,
      canceled: !!args.clearOnCancel,
    },
    profile,
  );

  await supabase.from("profiles").update(update).eq("id", profile.id);

  if (update.role === "artist") {
    await ensureArtistRow(profile.id, {}, supabase);
  }

  if (LOCKOUT_ENABLED && profile.role !== "admin") {
    if (args.clearOnCancel) {
      await banAuthUser(profile.id, supabase);
    } else if (args.status === "active") {
      await unbanAuthUser(profile.id, supabase);
    }
  }
}

async function findProfile(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  keys: { customerId: string | null; subscriptionId: string | null; email: string | null },
): Promise<{
  id: string;
  membership_tier: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  role: string | null;
} | null> {
  const cols = "id,membership_tier,stripe_customer_id,stripe_subscription_id,role";

  if (keys.customerId) {
    const { data } = await supabase
      .from("profiles")
      .select(cols)
      .eq("stripe_customer_id", keys.customerId)
      .maybeSingle();
    if (data) return data;
  }
  if (keys.subscriptionId) {
    const { data } = await supabase
      .from("profiles")
      .select(cols)
      .eq("stripe_subscription_id", keys.subscriptionId)
      .maybeSingle();
    if (data) return data;
  }
  if (keys.email) {
    const userId = await resolveUserIdByEmail(supabase, keys.email);
    if (userId) {
      const { data } = await supabase
        .from("profiles")
        .select(cols)
        .eq("id", userId)
        .maybeSingle();
      if (data) return data;
    }
  }
  return null;
}

async function resolveUserIdByEmail(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  email: string,
): Promise<string | null> {
  const target = email.trim().toLowerCase();
  if (!target) return null;
  try {
    const perPage = 200;
    const maxPages = 25;
    for (let page = 1; page <= maxPages; page += 1) {
      const { data, error } = await supabase.auth.admin.listUsers({
        page,
        perPage,
      });
      if (error || !data?.users?.length) return null;
      const match = data.users.find(
        (u: { id: string; email?: string | null }) =>
          (u.email ?? "").toLowerCase() === target,
      );
      if (match) return match.id;
      if (data.users.length < perPage) return null;
    }
  } catch (err) {
    console.error("stripe-webhook resolveUserIdByEmail error", err);
  }
  return null;
}

interface LogArgs {
  customerId: string | null;
  subscriptionId: string | null;
  email: string | null;
  tier: Tier;
  interval: Interval;
  status: string | null;
  amountTotal: number | null;
  currentPeriodEnd: string | null;
}

async function logEvent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  event: Stripe.Event,
  a: LogArgs,
) {
  const { error } = await supabase.from("membership_events").insert({
    stripe_event_id: event.id,
    event_type: event.type,
    stripe_customer_id: a.customerId,
    stripe_subscription_id: a.subscriptionId,
    customer_email: a.email,
    tier: a.tier,
    interval: a.interval,
    status: a.status,
    amount_total: a.amountTotal,
    current_period_end: a.currentPeriodEnd,
    raw: event.data.object as unknown as Record<string, unknown>,
  });
  if (error && error.code !== "23505") {
    console.error("membership_events insert error:", error);
  }
}
