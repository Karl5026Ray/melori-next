import { NextResponse } from "next/server";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  resolveArtistId,
  getPayoutRow,
  syncPayoutRowFromAccount,
  isConnectNotEnabled,
  CONNECT_NOT_ENABLED_MESSAGE,
} from "@/lib/artist-payouts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/artist/connect/status
// Reports the caller's Stripe Connect onboarding state and mirrors the latest
// capability flags onto artist_payouts. Returns { connected:false } when no
// connected account exists yet.
export async function GET(req: Request) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({
      connected: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      needsOnboarding: true,
    });
  }

  const userId = guard.membership.userId!;
  const supabase = getSupabaseAdmin();

  const artistId = await resolveArtistId(userId, supabase);
  if (!artistId) {
    return NextResponse.json({
      connected: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      needsOnboarding: true,
    });
  }

  const payout = await getPayoutRow(artistId, supabase);
  if (!payout?.stripe_connect_account_id) {
    return NextResponse.json({
      connected: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      needsOnboarding: true,
    });
  }

  const stripe = getStripe();
  try {
    const account = await stripe.accounts.retrieve(
      payout.stripe_connect_account_id,
    );
    await syncPayoutRowFromAccount(account, supabase);

    const chargesEnabled = Boolean(account.charges_enabled);
    const payoutsEnabled = Boolean(account.payouts_enabled);
    const detailsSubmitted = Boolean(account.details_submitted);

    return NextResponse.json({
      connected: true,
      chargesEnabled,
      payoutsEnabled,
      detailsSubmitted,
      needsOnboarding: !payoutsEnabled || !detailsSubmitted,
    });
  } catch (err: unknown) {
    if (isConnectNotEnabled(err)) {
      return NextResponse.json(
        { error: CONNECT_NOT_ENABLED_MESSAGE, connectDisabled: true },
        { status: 503 },
      );
    }
    const msg = err instanceof Error ? err.message : "Stripe error";
    console.error("artist/connect/status error:", msg);
    return NextResponse.json(
      { error: "Could not check payout status. Please try again." },
      { status: 500 },
    );
  }
}
