// POST /api/music/iap/verify
//
// Called by the native app immediately after StoreKit reports a
// successful purchase. Verifies the signed transaction against Apple's
// servers, cross-checks it against the SAME price authority Stripe
// checkout uses (resolveMusicItem + resolveIapTier -- never trusts a
// client-supplied price or product id), then fulfils the purchase the
// same way the Stripe webhook does: a music_purchases row that grants
// /api/music/download access, plus a split_payouts "owed" row so the
// artist's full listed price is tracked for manual/Connect payout,
// since Apple pays Melori's developer account directly and cannot route
// funds to the artist's Connect account itself.
//
// Body: { signedTransactionInfo } + one of
// { releaseId } | { trackId } | { studioTrackId } | { studioAlbumId }

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";
import { isResolveFailure, resolveMusicItem } from "@/lib/music-items";
import { resolveIapTier } from "@/lib/iap-products";
import { verifySignedTransaction } from "@/lib/appleIap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  signedTransactionInfo?: string;
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
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

if (!body.signedTransactionInfo) {
  return NextResponse.json({ error: "Missing signedTransactionInfo." }, { status: 400 });
}

const releaseId = toOptionalInt(body.releaseId);
  const trackId = toOptionalInt(body.trackId);
  const studioTrackId = typeof body.studioTrackId === "string" ? body.studioTrackId : null;
  const studioAlbumId = typeof body.studioAlbumId === "string" ? body.studioAlbumId : null;

if (Number.isNaN(releaseId) || Number.isNaN(trackId)) {
  return NextResponse.json({ error: "Provide a valid item id." }, { status: 400 });
}
  if (!releaseId && !trackId && !studioTrackId && !studioAlbumId) {
    return NextResponse.json({ error: "Provide an item to purchase." }, { status: 400 });
  }

// A signed-in buyer is required -- we have to know whose library to grant
// this into. The native app should never call this route while signed out.
const membership = await getRequestMembership(req).catch(() => null);
  if (!membership?.userId) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

let verified;
  try {
    verified = await verifySignedTransaction(body.signedTransactionInfo);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Verification failed";
    console.error("iap/verify: signature verification failed:", msg);
    return NextResponse.json({ error: "Could not verify this purchase with Apple." }, { status: 400 });
  }

const supabase = getSupabaseAdmin();

// Idempotent: StoreKit redelivers unfinished transactions on relaunch, so
// this route WILL be called more than once for the same purchase.
const { data: existing } = await supabase
  .from("music_purchases")
  .select("id")
  .eq("apple_transaction_id", verified.transactionId)
  .maybeSingle();
  if (existing) {
    return NextResponse.json({ ok: true, alreadyFulfilled: true });
  }

const item = await resolveMusicItem(
  { releaseId, trackId, studioTrackId, studioAlbumId },
  supabase,
  );
  if (isResolveFailure(item)) {
    return NextResponse.json({ error: item.error }, { status: 400 });
  }

const resolution = resolveIapTier(item.amountCents);
  if (!resolution || resolution.tier.productId !== verified.productId) {
    // Either this item isn't sellable via IAP, or the app bought the wrong
  // tier for it -- never fulfil against a mismatched product id.
  console.error(
    "iap/verify: product/tier mismatch",
    { expected: resolution?.tier.productId, got: verified.productId, item: item.id },
    );
    return NextResponse.json({ error: "This purchase does not match the requested item." }, { status: 409 });
  }

let payeeName = "Artist";
  if (item.ownerProfileId) {
    const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, full_name, username")
    .eq("id", item.ownerProfileId)
    .maybeSingle();
    payeeName =
      (profile as { display_name?: string; full_name?: string; username?: string } | null)
    ?.display_name ||
      (profile as { full_name?: string } | null)?.full_name ||
      (profile as { username?: string } | null)?.username ||
      "Artist";
  }

const { error: insertErr } = await supabase.from("music_purchases").insert({
  buyer_user_id: membership.userId,
  buyer_email: membership.email ?? null,
  release_id: item.kind === "release" ? Number(item.id) : null,
  track_id: item.kind === "track" ? Number(item.id) : null,
  studio_track_id: item.kind === "studio_track" ? item.id : null,
  studio_album_id: item.kind === "studio_album" ? item.id : null,
  artist_id: item.artistId,
  seller_profile_id: item.ownerProfileId,
  item_name: item.name.slice(0, 200),
  amount_cents: resolution.tier.priceCents,
  currency: item.currency || "usd",
  status: "paid",
  payment_processor: "apple_iap",
  apple_transaction_id: verified.transactionId,
  apple_original_transaction_id: verified.originalTransactionId,
  apple_product_id: verified.productId,
  apple_environment: verified.environment,
  artist_owed_cents: resolution.artistOwedCents,
});

if (insertErr) {
  console.error("iap/verify: music_purchases insert failed:", insertErr.message);
  return NextResponse.json({ error: "Could not record this purchase. Please contact support." }, { status: 500 });
}

if (item.ownerProfileId) {
  const { error: payoutErr } = await supabase.from("split_payouts").insert({
    apple_transaction_id: verified.transactionId,
    item_kind: item.kind,
    item_id: item.id,
    item_name: item.name.slice(0, 200),
    payee_profile_id: item.ownerProfileId,
    payee_name: payeeName,
    basis_points: 10000,
    amount_cents: resolution.artistOwedCents,
    currency: item.currency || "usd",
    status: "owed",
  });
  if (payoutErr) {
    // The purchase itself already succeeded and access is granted; log
  // loudly so this can be reconciled by hand rather than failing the
  // buyer's purchase over a bookkeeping write.
  console.error("iap/verify: split_payouts insert failed:", payoutErr.message);
  }
}

return NextResponse.json({ ok: true });
}
