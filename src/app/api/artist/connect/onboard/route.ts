import { NextResponse } from "next/server";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { approvedOrigin } from "@/lib/approved-origin";
import {
  resolveArtistId,
  getPayoutRow,
  isConnectNotEnabled,
  CONNECT_NOT_ENABLED_MESSAGE,
} from "@/lib/artist-payouts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/artist/connect/onboard
// Creates (or reuses) a Stripe Express connected account for the caller's artist
// row and returns a fresh account-onboarding link. The client redirects the
// artist to `url` to complete Stripe onboarding.
export async function POST(req: Request) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json(
      { error: "Payouts are not configured yet. Please try again later." },
      { status: 503 },
    );
  }

  const userId = guard.membership.userId!;
  const email = guard.membership.email ?? undefined;
  const supabase = getSupabaseAdmin();

  const artistId = await resolveArtistId(userId, supabase);
  if (!artistId) {
    return NextResponse.json(
      { error: "Could not resolve your artist profile." },
      { status: 400 },
    );
  }

  const stripe = getStripe();
  const origin = approvedOrigin(req);

  try {
    let payout = await getPayoutRow(artistId, supabase);
    let accountId = payout?.stripe_connect_account_id ?? null;

    // Create the Express connected account only if we don't already have one.
    if (!accountId) {
      // Destination-charge model: the platform creates the charge and routes
      // 90% to the artist via `transfer_data.destination` + a 10%
      // `application_fee_amount` (see api/artist/purchase/checkout). In that
      // model the connected account only needs the `transfers` capability.
      // Requesting `card_payments` (a direct-charge capability) makes
      // accounts.create throw in live mode for this platform configuration.
      const account = await stripe.accounts.create({
        type: "express",
        country: "US",
        email,
        business_type: "individual",
        capabilities: {
          transfers: { requested: true },
        },
        metadata: { artist_id: String(artistId), profile_id: userId },
      });
      accountId = account.id;

      // Store the connected account id. Upsert-by-artist keeps this idempotent
      // if a row already exists without an account id.
      if (payout) {
        await supabase
          .from("artist_payouts")
          .update({
            stripe_connect_account_id: accountId,
            is_onboarded: false,
            updated_at: new Date().toISOString(),
          })
          .eq("id", payout.id);
      } else {
        await supabase.from("artist_payouts").insert({
          artist_id: artistId,
          stripe_connect_account_id: accountId,
          is_onboarded: false,
        });
      }
      payout = await getPayoutRow(artistId, supabase);
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${origin}/studio?connect=refresh`,
      return_url: `${origin}/studio?connect=return`,
      type: "account_onboarding",
    });

    return NextResponse.json({ url: accountLink.url });
  } catch (err: unknown) {
    if (isConnectNotEnabled(err)) {
      return NextResponse.json(
        { error: CONNECT_NOT_ENABLED_MESSAGE, connectDisabled: true },
        { status: 503 },
      );
    }
    // Surface the underlying Stripe failure so onboarding problems are
    // debuggable instead of collapsing into an opaque generic message. Stripe
    // errors carry `code`/`type`; plain errors just carry `message`.
    const e = err as { message?: string; code?: string; type?: string };
    const message = e?.message ?? "Stripe error";
    console.error("artist/connect/onboard error:", {
      message,
      code: e?.code,
      type: e?.type,
      err,
    });
    return NextResponse.json(
      {
        error: "Could not start payout onboarding. Please try again.",
        detail: message,
        code: e?.code,
        type: e?.type,
      },
      { status: 500 },
    );
  }
}
