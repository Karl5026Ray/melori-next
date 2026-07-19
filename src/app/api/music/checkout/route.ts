import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";
import { approvedOrigin } from "@/lib/approved-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/music/checkout
// Album / single-track music purchase via Stripe Checkout.
// NOTE: lives under /api/music/* (NOT /api/artist/* or /api/purchase/*) so it
// is a real Next.js route handler and is never proxied to the legacy VPS by
// the rewrites in next.config.js.
//
// Body: { releaseId } OR { trackId }. Price is read authoritatively from the
// database (never trusted from the client).
//
// Payout model (per-artist, automatic):
//   • If the owning artist has a fully-onboarded Stripe Connect account
//     (payouts_enabled), we use a DESTINATION CHARGE with on_behalf_of so the
//     artist is the settlement account and receives 100% minus Stripe's
//     processing fee. Melori takes no platform cut on music sales.
//   • If the artist is NOT onboarded yet, the sale still completes on the
//     Melori platform account (standard charge). This unblocks every release
//     immediately; earnings are reconciled to the artist once they onboard.
//     Previously this path hard-failed with a 409, so NO music could be sold.
//
// Fulfillment: the webhook (source "melorimusic.org/artist-purchase") records
// the purchase into music_purchases and thereby grants the buyer download
// access via /api/music/download.

interface Body {
  releaseId?: number | string;
  trackId?: number | string;
}

// DB prices are DECIMAL dollars; Stripe wants integer cents.
function toCents(dollars: number): number {
  return Math.round(dollars * 100);
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

  const releaseId = body.releaseId != null ? Number(body.releaseId) : null;
  const trackId = body.trackId != null ? Number(body.trackId) : null;
  if (
    (!releaseId && !trackId) ||
    (releaseId != null && !Number.isInteger(releaseId)) ||
    (trackId != null && !Number.isInteger(trackId))
  ) {
    return NextResponse.json(
      { error: "Provide a valid releaseId or trackId." },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();

  // Resolve the item, its price, and the owning artist id.
  let itemName = "";
  let priceDollars = 0;
  let artistId: number | null = null;

  if (trackId) {
    const { data: track } = await supabase
      .from("tracks")
      .select(
        "id, title, price, is_published, release:releases(id, title, price, artist_id)",
      )
      .eq("id", trackId)
      .maybeSingle();
    const rel = (track as any)?.release ?? null;
    if (!track || track.is_published === false || !rel) {
      return NextResponse.json(
        { error: "This track is not available." },
        { status: 400 },
      );
    }
    // Track price overrides release price; NULL inherits the release price.
    priceDollars =
      typeof track.price === "number" && track.price > 0
        ? track.price
        : Number(rel.price);
    itemName = `${track.title}`;
    artistId = rel.artist_id ?? null;
  } else {
    const { data: release } = await supabase
      .from("releases")
      .select("id, title, price, is_published, artist_id")
      .eq("id", releaseId!)
      .maybeSingle();
    if (!release || release.is_published === false) {
      return NextResponse.json(
        { error: "This release is not available." },
        { status: 400 },
      );
    }
    priceDollars = Number(release.price);
    itemName = release.title;
    artistId = release.artist_id ?? null;
  }

  const totalCents = toCents(priceDollars);
  if (!Number.isInteger(totalCents) || totalCents <= 0) {
    return NextResponse.json(
      { error: "This item has an invalid price." },
      { status: 400 },
    );
  }

  // If we can resolve an onboarded Connect account for the artist, route funds
  // directly to them (destination charge). Otherwise the sale completes on the
  // platform account — the purchase is never blocked.
  let connectedAccountId: string | null = null;
  if (artistId) {
    const { data: payout } = await supabase
      .from("artist_payouts")
      .select("stripe_connect_account_id, payouts_enabled")
      .eq("artist_id", artistId)
      .maybeSingle();
    if (payout?.stripe_connect_account_id && payout.payouts_enabled) {
      connectedAccountId = payout.stripe_connect_account_id;
    }
  }

  const origin = approvedOrigin(req);

  // Attach buyer identity if signed in (optional for one-off purchases).
  const membership = await getRequestMembership(req).catch(() => null);
  const buyerUserId = membership?.userId ?? null;
  const buyerEmail = membership?.email ?? undefined;

  const stripe = getStripe();

  // When the artist is onboarded, make them the settlement account so Stripe's
  // processing fee comes out of their balance and they keep 100% of the
  // remainder (Melori applies no platform fee). When not onboarded, this block
  // is simply omitted and the charge settles to the platform account.
  const paymentIntentData: Stripe.Checkout.SessionCreateParams.PaymentIntentData | undefined =
    connectedAccountId
      ? {
          on_behalf_of: connectedAccountId,
          transfer_data: { destination: connectedAccountId },
        }
      : undefined;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: totalCents,
            product_data: { name: itemName },
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
        ...(artistId ? { artist_id: String(artistId) } : {}),
        ...(releaseId ? { release_id: String(releaseId) } : {}),
        ...(trackId ? { track_id: String(trackId) } : {}),
        item_name: itemName.slice(0, 200),
        total_cents: String(totalCents),
        ...(connectedAccountId ? { connected_account_id: connectedAccountId } : {}),
        ...(buyerUserId ? { user_id: buyerUserId } : {}),
      },
    } satisfies Stripe.Checkout.SessionCreateParams);

    // BuyButton historically expected { checkout_url }; the newer client reads
    // { url }. Return both so either version works.
    return NextResponse.json({ url: session.url, checkout_url: session.url });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Stripe error";
    console.error("artist/purchase/checkout error:", msg);
    return NextResponse.json(
      { error: "Could not start checkout. Please try again." },
      { status: 500 },
    );
  }
}
