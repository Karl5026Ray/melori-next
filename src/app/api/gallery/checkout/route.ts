import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";
import { approvedOrigin } from "@/lib/approved-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Snappd instant-print revenue split: Melori keeps this percentage of every
// gallery print sale; the owning photographer receives the remainder via their
// Stripe Connect account. Configurable via env so the split can change without
// a code deploy; defaults to 20% platform / 80% photographer.
const SNAPPD_PLATFORM_FEE_PERCENT = (() => {
  const raw = Number(process.env.SNAPPD_PLATFORM_FEE_PERCENT);
  return Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : 20;
})();

// POST /api/gallery/checkout — start a Stripe Checkout for a single digital
// download (a Snappd "instant print"). Guest checkout is allowed; if the caller
// is signed in we attach their id/email. Price is ALWAYS read server-side —
// never trust the client.
//
// Payout model (Snappd instant prints):
//   • If the gallery's photographer has a fully-onboarded Stripe Connect
//     account (payouts_enabled), we use a DESTINATION CHARGE with an
//     application_fee_amount equal to SNAPPD_PLATFORM_FEE_PERCENT of the sale.
//     Melori keeps that fee; the photographer receives the remainder (default
//     80%) directly to their connected account.
//   • If the photographer is NOT onboarded, the sale still completes on the
//     Melori platform account (standard charge) so a purchase is never blocked;
//     earnings are reconciled once they onboard.
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    return NextResponse.json(
      { error: "Checkout is not configured yet. Please try again later." },
      { status: 503 },
    );
  }

  let body: { imageId?: string };
  try {
    body = (await req.json()) as { imageId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const imageId = typeof body.imageId === "string" ? body.imageId : null;
  if (!imageId) {
    return NextResponse.json({ error: "imageId is required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: image, error } = await supabase
    .from("photo_gallery_images")
    .select(
      "id, gallery_id, filename, for_sale, price_cents, photo_galleries!inner(name, slug, is_active, photographer_id)",
    )
    .eq("id", imageId)
    .maybeSingle();

  if (error || !image) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  // Supabase returns the embedded relation as an array-typed field.
  const gallery = Array.isArray(image.photo_galleries)
    ? image.photo_galleries[0]
    : image.photo_galleries;

  if (!gallery?.is_active) {
    return NextResponse.json({ error: "Gallery unavailable" }, { status: 404 });
  }
  if (!image.for_sale || !Number.isInteger(image.price_cents) || image.price_cents <= 0) {
    return NextResponse.json(
      { error: "This photo is not for sale." },
      { status: 400 },
    );
  }

  const priceCents = image.price_cents as number;

  // Resolve the gallery's photographer -> Stripe Connect account so the sale
  // can be split. Chain: photo_galleries.photographer_id (profile uuid) ->
  // artists.profile_id -> artists.id -> artist_payouts.stripe_connect_account_id.
  // Any gap simply falls back to a platform charge (the sale is never blocked).
  let connectedAccountId: string | null = null;
  const photographerProfileId = gallery?.photographer_id ?? null;
  if (photographerProfileId) {
    const { data: artistRow } = await supabase
      .from("artists")
      .select("id")
      .eq("profile_id", photographerProfileId)
      .maybeSingle();
    if (artistRow?.id) {
      const { data: payout } = await supabase
        .from("artist_payouts")
        .select("stripe_connect_account_id, payouts_enabled")
        .eq("artist_id", artistRow.id)
        .maybeSingle();
      if (payout?.stripe_connect_account_id && payout.payouts_enabled) {
        connectedAccountId = payout.stripe_connect_account_id;
      }
    }
  }

  // Platform fee (Melori's cut) in integer cents. Only applied when the sale is
  // routed to a connected photographer account; otherwise it's meaningless
  // (the charge already settles to the platform).
  const applicationFeeCents = Math.round(
    (priceCents * SNAPPD_PLATFORM_FEE_PERCENT) / 100,
  );

  const origin = approvedOrigin(req);

  // Attach buyer identity if signed in (best-effort — guests are allowed).
  const membership = await getRequestMembership(req).catch(() => null);
  const buyerUserId = membership?.userId ?? null;
  const buyerEmail = membership?.email ?? undefined;

  const stripe = new Stripe(secret);

  // Destination charge with an application fee: the photographer's connected
  // account is the destination and receives (price - fee); Melori keeps the
  // application fee. Omitted entirely when the photographer isn't onboarded.
  const paymentIntentData:
    | Stripe.Checkout.SessionCreateParams.PaymentIntentData
    | undefined = connectedAccountId
    ? {
        transfer_data: { destination: connectedAccountId },
        ...(applicationFeeCents > 0
          ? { application_fee_amount: applicationFeeCents }
          : {}),
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
            unit_amount: priceCents,
            product_data: {
              name: `${gallery.name} — ${image.filename ?? "Photo"}`,
            },
          },
        },
      ],
      ...(paymentIntentData ? { payment_intent_data: paymentIntentData } : {}),
      success_url: `${origin}/gallery/purchase/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/gallery/${gallery.slug}`,
      ...(buyerEmail ? { customer_email: buyerEmail } : {}),
      ...(buyerUserId ? { client_reference_id: buyerUserId } : {}),
      metadata: {
        source: "melorimusic.org/gallery",
        image_id: image.id,
        gallery_id: image.gallery_id,
        price_cents: String(priceCents),
        ...(connectedAccountId
          ? {
              connected_account_id: connectedAccountId,
              platform_fee_cents: String(applicationFeeCents),
              platform_fee_percent: String(SNAPPD_PLATFORM_FEE_PERCENT),
            }
          : {}),
        ...(buyerUserId ? { user_id: buyerUserId } : {}),
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Stripe error";
    console.error("gallery/checkout error", msg);
    return NextResponse.json(
      { error: "Could not start checkout. Please try again." },
      { status: 500 },
    );
  }
}
