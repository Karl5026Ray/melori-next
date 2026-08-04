import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";
import { approvedOrigin } from "@/lib/approved-origin";
import {
  getPayoutAccountForArtist,
  getPayoutAccountForProfile,
  getSplitsForItem,
  isResolveFailure,
  resolveMusicItem,
} from "@/lib/music-items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/music/checkout
// Music purchase via Stripe Checkout, for every kind of catalog item.
// NOTE: lives under /api/music/* (NOT /api/artist/* or /api/purchase/*) so it
// is a real Next.js route handler and is never proxied to the legacy VPS by
// the rewrites in next.config.js.
//
// Body: { releaseId } | { trackId } | { studioTrackId } | { studioAlbumId }.
// The body names an item and NOTHING ELSE — the price is read authoritatively
// from that row by resolveMusicItem. A client that posts a price is ignored.
//
// Payout model (per-artist, automatic, 0% platform fee):
//   • NO collaborator splits configured (the default, and every sale before
//     this feature existed): if the owning artist has a fully-onboarded
//     Connect account we use a DESTINATION CHARGE with on_behalf_of, so the
//     artist is the settlement account and keeps 100% minus Stripe's fee.
//     Unchanged from before.
//   • SPLITS configured: the charge settles on the PLATFORM account carrying a
//     `transfer_group`, and the webhook fans out one transfer per payee once
//     the real Stripe fee is known. A destination charge can only have one
//     destination, so it cannot express a split.
//   • Artist NOT onboarded: the sale still completes on the Melori platform
//     account. This unblocks every release immediately; earnings are
//     reconciled once they onboard. Previously this hard-failed with a 409.
//
// Fulfillment: the webhook (source "melorimusic.org/artist-purchase") records
// the purchase into music_purchases, which grants download access via
// /api/music/download, and writes the split ledger.

interface Body {
  releaseId?: number | string;
  trackId?: number | string;
  studioTrackId?: string;
  studioAlbumId?: string;
}

function toOptionalInt(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : Number.NaN;
}

export async function POST(req: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json(
      { error: "Checkout is not configured yet. Please try again later." },
      { status: 503 },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const releaseId = toOptionalInt(body.releaseId);
  const trackId = toOptionalInt(body.trackId);
  const studioTrackId =
    typeof body.studioTrackId === "string" ? body.studioTrackId : null;
  const studioAlbumId =
    typeof body.studioAlbumId === "string" ? body.studioAlbumId : null;

  if (Number.isNaN(releaseId) || Number.isNaN(trackId)) {
    return NextResponse.json(
      { error: "Provide a valid item id." },
      { status: 400 },
    );
  }
  if (!releaseId && !trackId && !studioTrackId && !studioAlbumId) {
    return NextResponse.json(
      { error: "Provide an item to purchase." },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();

  const item = await resolveMusicItem(
    { releaseId, trackId, studioTrackId, studioAlbumId },
    supabase,
  );
  if (isResolveFailure(item)) {
    return NextResponse.json({ error: item.error }, { status: 400 });
  }

  const totalCents = item.amountCents;
  if (!Number.isInteger(totalCents) || totalCents <= 0) {
    // A zero price means the artist made the item free — there is nothing to
    // check out. The UI renders Play/Download instead of Buy for these.
    return NextResponse.json(
      { error: "This item is free — no purchase needed." },
      { status: 400 },
    );
  }

  // Splits change the charge topology, so resolve them before building the
  // session. No rows = the pre-existing single-payee behaviour, untouched.
  const splits = await getSplitsForItem(item.kind, item.id, supabase).catch(
    () => [],
  );
  const hasSplits = splits.length > 0;

  const connectedAccountId = hasSplits
    ? null
    : item.artistId
      ? await getPayoutAccountForArtist(item.artistId, supabase)
      : await getPayoutAccountForProfile(item.ownerProfileId, supabase);

  const origin = approvedOrigin(req);

  // Attach buyer identity if signed in (optional for one-off purchases).
  const membership = await getRequestMembership(req).catch(() => null);
  const buyerUserId = membership?.userId ?? null;
  const buyerEmail = membership?.email ?? undefined;

  const stripe = getStripe();

  // A transfer_group ties the platform charge to the transfers the webhook
  // will create against it. Only set on the split path.
  const transferGroup = hasSplits
    ? `melori_${item.kind}_${item.id}_${Date.now()}`
    : null;

  // When the artist is onboarded and there are no splits, make them the
  // settlement account so Stripe's processing fee comes out of their balance
  // and they keep the remainder in full (Melori applies no platform fee).
  const paymentIntentData:
    | Stripe.Checkout.SessionCreateParams.PaymentIntentData
    | undefined = connectedAccountId
    ? {
        on_behalf_of: connectedAccountId,
        transfer_data: { destination: connectedAccountId },
      }
    : transferGroup
      ? { transfer_group: transferGroup }
      : undefined;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: item.currency || "usd",
            unit_amount: totalCents,
            product_data: { name: item.name },
          },
        },
      ],
      ...(paymentIntentData ? { payment_intent_data: paymentIntentData } : {}),
      success_url: `${origin}/music/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/music`,
      ...(buyerEmail ? { customer_email: buyerEmail } : {}),
      ...(buyerUserId ? { client_reference_id: buyerUserId } : {}),
      metadata: {
        source: "melorimusic.org/artist-purchase",
        item_kind: item.kind,
        item_id: item.id,
        ...(item.artistId ? { artist_id: String(item.artistId) } : {}),
        ...(item.ownerProfileId
          ? { owner_profile_id: item.ownerProfileId }
          : {}),
        ...(item.kind === "release" ? { release_id: item.id } : {}),
        ...(item.kind === "track" ? { track_id: item.id } : {}),
        ...(item.kind === "studio_track" ? { studio_track_id: item.id } : {}),
        ...(item.kind === "studio_album" ? { studio_album_id: item.id } : {}),
        item_name: item.name.slice(0, 200),
        total_cents: String(totalCents),
        ...(connectedAccountId
          ? { connected_account_id: connectedAccountId }
          : {}),
        ...(transferGroup ? { transfer_group: transferGroup } : {}),
        ...(buyerUserId ? { user_id: buyerUserId } : {}),
      },
    } satisfies Stripe.Checkout.SessionCreateParams);

    // BuyButton historically expected { checkout_url }; the newer client reads
    // { url }. Return both so either version works.
    return NextResponse.json({ url: session.url, checkout_url: session.url });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Stripe error";
    console.error("music/checkout error:", msg);
    return NextResponse.json(
      { error: "Could not start checkout. Please try again." },
      { status: 500 },
    );
  }
}
