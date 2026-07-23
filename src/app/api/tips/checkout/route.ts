import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";
import { approvedOrigin } from "@/lib/approved-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/tips/checkout
// Fan tip to an artist via Stripe Checkout (mode:payment). Clones the money-
// routing pattern from /api/music/checkout, with one deliberate difference:
// tips DO take a 10% platform application fee (music sales take 0%).
//
//   • Artist onboarded (payouts_enabled + connect account): destination charge
//     with on_behalf_of + transfer_data.destination and application_fee_amount
//     = 10% of the tip. The artist settles the remaining 90%.
//   • Not onboarded: the tip settles on the platform account for later
//     reconciliation (routed_to_artist=false), never blocked.
//
// Guests may tip (auth is optional). Fulfillment happens in the shared
// /api/stripe/webhook (checkout.session.completed, source:'tip').

interface Body {
  artistId?: number | string;
  amountCents?: number | string;
  source?: "artist" | "track" | "live" | "mirror";
  trackId?: number | string;
  spaceId?: string;
}

const MIN_CENTS = 100; // $1
const MAX_CENTS = 50000; // $500
const TIP_FEE_RATE = 0.1; // Melori tip fee = 10%

export async function POST(req: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json(
      { error: "Tipping is not configured yet. Please try again later." },
      { status: 503 },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const artistId = body.artistId != null ? Number(body.artistId) : null;
  if (!artistId || !Number.isInteger(artistId)) {
    return NextResponse.json({ error: "Provide a valid artistId." }, { status: 400 });
  }

  const amountCents = body.amountCents != null ? Number(body.amountCents) : NaN;
  if (
    !Number.isInteger(amountCents) ||
    amountCents < MIN_CENTS ||
    amountCents > MAX_CENTS
  ) {
    return NextResponse.json(
      { error: "Tip must be between $1 and $500." },
      { status: 400 },
    );
  }

  const source =
    body.source === "track" ||
    body.source === "live" ||
    body.source === "mirror"
      ? body.source
      : "artist";
  const trackId = body.trackId != null ? Number(body.trackId) : null;
  const spaceId = typeof body.spaceId === "string" ? body.spaceId : null;

  const supabase = getSupabaseAdmin();

  const { data: artist } = await supabase
    .from("artists")
    .select("id, name, slug, profile_id, is_published")
    .eq("id", artistId)
    .maybeSingle();
  if (!artist) {
    return NextResponse.json({ error: "Artist not found." }, { status: 400 });
  }

  // Resolve an onboarded Connect account to route funds directly to the artist.
  let connectedAccountId: string | null = null;
  const { data: payout } = await supabase
    .from("artist_payouts")
    .select("stripe_connect_account_id, payouts_enabled")
    .eq("artist_id", artistId)
    .maybeSingle();
  if (payout?.stripe_connect_account_id && payout.payouts_enabled) {
    connectedAccountId = payout.stripe_connect_account_id;
  }
  const routedToArtist = connectedAccountId != null;

  const origin = approvedOrigin(req);

  // Optional tipper identity — guests may tip.
  const membership = await getRequestMembership(req).catch(() => null);
  const tipperUserId = membership?.userId ?? null;
  const tipperEmail = membership?.email ?? undefined;

  const stripe = getStripe();

  const applicationFeeAmount = Math.round(amountCents * TIP_FEE_RATE);

  const paymentIntentData: Stripe.Checkout.SessionCreateParams.PaymentIntentData =
    {
      metadata: {
        source: "tip",
        tip_source: source,
        artist_id: String(artistId),
        ...(artist.profile_id
          ? { recipient_profile_id: String(artist.profile_id) }
          : {}),
        ...(trackId ? { track_id: String(trackId) } : {}),
        ...(spaceId ? { space_id: spaceId } : {}),
        amount_cents: String(amountCents),
        routed_to_artist: String(routedToArtist),
        ...(connectedAccountId ? { connected_account_id: connectedAccountId } : {}),
        ...(tipperUserId ? { tipper_user_id: tipperUserId } : {}),
      },
      ...(connectedAccountId
        ? {
            on_behalf_of: connectedAccountId,
            transfer_data: { destination: connectedAccountId },
            application_fee_amount: applicationFeeAmount,
          }
        : {}),
    };

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: amountCents,
            product_data: { name: `Tip for ${artist.name}` },
          },
        },
      ],
      payment_intent_data: paymentIntentData,
      success_url: `${origin}/tip/thanks?artist=${encodeURIComponent(artist.slug ?? "")}`,
      cancel_url: `${origin}/artists/${artist.slug ?? ""}`,
      ...(tipperEmail ? { customer_email: tipperEmail } : {}),
      ...(tipperUserId ? { client_reference_id: tipperUserId } : {}),
      metadata: {
        source: "tip",
        tip_source: source,
        artist_id: String(artistId),
        ...(artist.profile_id
          ? { recipient_profile_id: String(artist.profile_id) }
          : {}),
        ...(trackId ? { track_id: String(trackId) } : {}),
        ...(spaceId ? { space_id: spaceId } : {}),
        amount_cents: String(amountCents),
        routed_to_artist: String(routedToArtist),
        ...(connectedAccountId ? { connected_account_id: connectedAccountId } : {}),
        ...(tipperUserId ? { tipper_user_id: tipperUserId } : {}),
      },
    } satisfies Stripe.Checkout.SessionCreateParams);

    return NextResponse.json({ url: session.url });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Stripe error";
    console.error("tips/checkout error:", msg);
    return NextResponse.json(
      { error: "Could not start the tip. Please try again." },
      { status: 500 },
    );
  }
}
