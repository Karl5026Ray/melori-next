import { NextResponse } from "next/server";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  resolveArtistId,
  getPayoutRow,
  isConnectNotEnabled,
  CONNECT_NOT_ENABLED_MESSAGE,
} from "@/lib/artist-payouts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/artist/connect/dashboard
// Returns a single-use login link to the artist's Stripe Express dashboard.
// Only works once the connected account exists.
export async function GET(req: Request) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json(
      { error: "Payouts are not configured yet." },
      { status: 503 },
    );
  }

  const userId = guard.membership.userId!;
  const supabase = getSupabaseAdmin();

  const artistId = await resolveArtistId(userId, supabase);
  if (!artistId) {
    return NextResponse.json(
      { error: "Could not resolve your artist profile." },
      { status: 400 },
    );
  }

  const payout = await getPayoutRow(artistId, supabase);
  if (!payout?.stripe_connect_account_id) {
    return NextResponse.json(
      { error: "No payout account yet. Set up payouts first." },
      { status: 400 },
    );
  }

  const stripe = getStripe();
  try {
    const link = await stripe.accounts.createLoginLink(
      payout.stripe_connect_account_id,
    );
    return NextResponse.json({ url: link.url });
  } catch (err: unknown) {
    if (isConnectNotEnabled(err)) {
      return NextResponse.json(
        { error: CONNECT_NOT_ENABLED_MESSAGE, connectDisabled: true },
        { status: 503 },
      );
    }
    const msg = err instanceof Error ? err.message : "Stripe error";
    console.error("artist/connect/dashboard error:", msg);
    return NextResponse.json(
      { error: "Could not open your Stripe dashboard. Please try again." },
      { status: 500 },
    );
  }
}
