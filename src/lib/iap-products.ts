// src/lib/iap-products.ts
//
// Maps Melori's arbitrary artist-set prices onto Apple's fixed IAP price
// tiers for native-app music purchases. Web/Stripe pricing is untouched --
// this file is only consulted by the native purchase-intent and
// verification routes.
//
// WHY A MARKUP, NOT A FLAT PASS-THROUGH:
// Apple takes a commission (APPLE_FEE_RATE) out of every IAP transaction
// before paying Melori. The artist is still owed their full listed price,
// same as a web sale, so the iOS buyer is charged the smallest Apple tier
// that nets the artist their full amount after Apple's cut -- the iOS
// buyer absorbs the markup, not the artist and not Melori.
//
// SETUP STEP (manual, App Store Connect): for each tier below, create a
// Consumable In-App Purchase with that exact Product ID and the matching
// USD price point. This file is the source of truth for what must exist
// there -- add a tier here, then add the matching product in App Store
// Connect before shipping.

export const APPLE_FEE_RATE = 0.15; // Small Business Program rate. Raise to
// 0.30 here if Melori's trailing-12-month proceeds exceed Apple's
// threshold and it drops out of the program.

export interface IapTier {
  productId: string;
  priceCents: number;
}

// Apple's standard USD price-tier list, restricted to the range Melori's
// catalog actually uses (singles floor at $1.99, albums default $9.99,
// custom prices go higher). Extend this list if an artist's price can no
// longer be covered by the top tier.
export const IAP_MUSIC_TIERS: IapTier[] = [
  { productId: "music_tier_199", priceCents: 199 },
  { productId: "music_tier_299", priceCents: 299 },
  { productId: "music_tier_399", priceCents: 399 },
  { productId: "music_tier_499", priceCents: 499 },
  { productId: "music_tier_599", priceCents: 599 },
  { productId: "music_tier_699", priceCents: 699 },
  { productId: "music_tier_799", priceCents: 799 },
  { productId: "music_tier_999", priceCents: 999 },
  { productId: "music_tier_1499", priceCents: 1499 },
  { productId: "music_tier_1999", priceCents: 1999 },
  { productId: "music_tier_2499", priceCents: 2499 },
  { productId: "music_tier_2999", priceCents: 2999 },
  { productId: "music_tier_3999", priceCents: 3999 },
  { productId: "music_tier_4999", priceCents: 4999 },
  ];

export interface IapTierResolution {
  tier: IapTier;
  /** What the artist is owed for this sale -- always their full listed price. */
artistOwedCents: number;
  /** What Apple is expected to remit to Melori after their cut. Informational only; the real number comes from the transaction/App Store Server API at settlement. */
expectedNetToMeloriCents: number;
}

/**
* Picks the cheapest Apple tier that still nets the artist their full
* listed price after Apple's commission. Returns null if the artist's
* price exceeds what even the top tier can cover -- callers should fall
* back to "not available for in-app purchase yet, buy on the web" rather
* than charging the wrong amount.
*/
export function resolveIapTier(artistPriceCents: number): IapTierResolution | null {
  if (!Number.isInteger(artistPriceCents) || artistPriceCents <= 0) return null;

for (const tier of IAP_MUSIC_TIERS) {
  const netToMelori = Math.floor(tier.priceCents * (1 - APPLE_FEE_RATE));
  if (netToMelori >= artistPriceCents) {
    return {
      tier,
      artistOwedCents: artistPriceCents,
      expectedNetToMeloriCents: netToMelori,
    };
  }
}
  return null;
}

export function findTierByProductId(productId: string): IapTier | null {
  return IAP_MUSIC_TIERS.find((t) => t.productId === productId) ?? null;
}
