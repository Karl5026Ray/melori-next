// POST /api/music/iap/product
//
// Called by the native app BEFORE it starts a StoreKit purchase, so it
// knows which Apple product id to buy for a given catalog item. Mirrors
// resolveMusicItem's authority model: the browser names an item, never a
// price or product id -- both are resolved here, server-side, from the
// same source of truth Stripe checkout uses.
//
// Body: { releaseId } | { trackId } | { studioTrackId } | { studioAlbumId }
// Response: { productId, priceCents, artistOwedCents, itemName }
// or 422 { error } if the item's price cannot be covered by any
// configured Apple tier yet (caller should fall back to "buy on the web").

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isResolveFailure, resolveMusicItem } from "@/lib/music-items";
import { resolveIapTier } from "@/lib/iap-products";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
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

const supabase = getSupabaseAdmin();
  const item = await resolveMusicItem(
    { releaseId, trackId, studioTrackId, studioAlbumId },
    supabase,
    );
  if (isResolveFailure(item)) {
    return NextResponse.json({ error: item.error }, { status: 400 });
  }

if (!Number.isInteger(item.amountCents) || item.amountCents <= 0) {
  return NextResponse.json(
    { error: "This item is free -- no purchase needed." },
    { status: 400 },
    );
}

const resolution = resolveIapTier(item.amountCents);
  if (!resolution) {
    return NextResponse.json(
      { error: "This item isn't available for in-app purchase yet. Buy it on melorimusic.org instead." },
      { status: 422 },
      );
  }

return NextResponse.json({
  productId: resolution.tier.productId,
  priceCents: resolution.tier.priceCents,
  artistOwedCents: resolution.artistOwedCents,
  itemName: item.name,
});
}
