import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";
import { approvedOrigin } from "@/lib/approved-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/artist/purchase/checkout
// Additive artist-attributed music purchase using Stripe destination charges so
// the sale is split 90% artist / 10% platform. Body: { releaseId } or
// { trackId }. Price is read authoritatively from the DB (never trusted from the
// client). The release's artist must have an onboarded Connect account with
// payouts enabled; otherwise we return a clear error and DO NOT charge — the
// existing purchase flows are left untouched.
//
// application_fee_amount = round(total * 0.10) (platform 10%)
// transfer_data.destination = artist connected account (artist keeps 90%)

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
  if (!artistId) {
    return NextResponse.json(
      { error: "This item is not linked to an artist." },
      { status: 400 },
    );
  }

  // The artist must have an onboarded Connect account with payouts enabled to
  // receive a destination charge. If not, return a clear error rather than
  // silently charging without a split.
  const { data: payout } = await supabase
    .from("artist_payouts")
    .select("stripe_connect_account_id, payouts_enabled")
    .eq("artist_id", artistId)
    .maybeSingle();

  if (!payout?.stripe_connect_account_id || !payout.payouts_enabled) {
    return NextResponse.json(
      {
        error:
          "This artist hasn't finished setting up payouts yet. Please try again later.",
        payoutsUnavailable: true,
      },
      { status: 409 },
    );
  }

  const applicationFee = Math.round(totalCents * 0.1); // platform 10%
  const origin = approvedOrigin(req);

  // Attach buyer identity if signed in (optional for one-off purchases).
  const membership = await getRequestMembership(req).catch(() => null);
  const buyerUserId = membership?.userId ?? null;
  const buyerEmail = membership?.email ?? undefined;

  const stripe = getStripe();

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
      payment_intent_data: {
        application_fee_amount: applicationFee,
        transfer_data: { destination: payout.stripe_connect_account_id },
      },
      success_url: `${origin}/studio?purchase=success`,
      cancel_url: `${origin}/studio?purchase=cancel`,
      ...(buyerEmail ? { customer_email: buyerEmail } : {}),
      ...(buyerUserId ? { client_reference_id: buyerUserId } : {}),
      metadata: {
        source: "melorimusic.org/artist-purchase",
        artist_id: String(artistId),
        ...(releaseId ? { release_id: String(releaseId) } : {}),
        ...(trackId ? { track_id: String(trackId) } : {}),
        total_cents: String(totalCents),
        application_fee_cents: String(applicationFee),
        ...(buyerUserId ? { user_id: buyerUserId } : {}),
      },
    } satisfies Stripe.Checkout.SessionCreateParams);

    return NextResponse.json({ url: session.url });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Stripe error";
    console.error("artist/purchase/checkout error:", msg);
    return NextResponse.json(
      { error: "Could not start checkout. Please try again." },
      { status: 500 },
    );
  }
}
