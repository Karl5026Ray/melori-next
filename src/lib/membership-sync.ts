// Shared server-side membership state derivation.
//
// The Stripe price -> tier/interval mapping and the exact shape of the
// `profiles` membership update both live here so the members subscription
// webhook (api/members/stripe-webhook) and the post-payment onboarding flow
// (api/welcome/*) grant identical entitlements. Keeping one source of truth
// means a Superfan/Artist buyer ends up in the same DB state whether the
// webhook fires first or the /welcome form completes first.

export type Tier = "superfan" | "artist" | null;
export type Interval = "month" | "year" | null;

// Optional exact Stripe price-id -> tier map, configured via env so a coupon,
// tax line, or price-amount change can never misclassify a buyer. Format:
//   STRIPE_PRICE_MAP="price_abc:superfan,price_def:artist"
// Price ids are the most reliable signal (they never change for a given plan),
// so when present they win over the amount heuristic below.
function priceIdTierMap(): Record<string, Tier> {
  const raw = process.env.STRIPE_PRICE_MAP;
  if (!raw) return {};
  const map: Record<string, Tier> = {};
  for (const pair of raw.split(",")) {
    const [id, tier] = pair.split(":").map((s) => s?.trim());
    if (!id) continue;
    if (tier === "superfan" || tier === "artist") map[id] = tier;
  }
  return map;
}

export interface ClassifyInput {
  amountCents?: number | null;
  priceId?: string | null;
  interval?: Interval;
}

// Classify a subscription into { tier, interval }. Resolution order:
//   1. Exact Stripe price id (via STRIPE_PRICE_MAP) — most reliable.
//   2. Known price amounts (Superfan 299/2999, Artist 499/4999; legacy
//      999/9999 kept for in-flight pre-July-2026 subscriptions).
//   3. Safety net: ANY positive recurring amount that didn't match above still
//      grants at least Superfan, so a coupon/tax/price-change never silently
//      drops a *paying* buyer to `free`. Interval comes from Stripe when known.
//
// Accepts either a plain amount (legacy callers) or a ClassifyInput object.
export function classifyPrice(
  input: number | null | undefined | ClassifyInput,
): { tier: Tier; interval: Interval } {
  const {
    amountCents = null,
    priceId = null,
    interval: intervalHint = null,
  }: ClassifyInput =
    typeof input === "object" && input !== null
      ? input
      : { amountCents: input ?? null };

  // 1. Exact price-id map.
  if (priceId) {
    const mapped = priceIdTierMap()[priceId];
    if (mapped) {
      return { tier: mapped, interval: intervalHint ?? null };
    }
  }

  // 2. Known amounts.
  switch (amountCents) {
    case 299:
      return { tier: "superfan", interval: intervalHint ?? "month" };
    case 2999:
      return { tier: "superfan", interval: intervalHint ?? "year" };
    case 499:
      return { tier: "artist", interval: intervalHint ?? "month" };
    case 4999:
      return { tier: "artist", interval: intervalHint ?? "year" };
    // Legacy pricing fallbacks (pre July 2026):
    case 999:
      return { tier: "artist", interval: intervalHint ?? "month" };
    case 9999:
      return { tier: "artist", interval: intervalHint ?? "year" };
  }

  // 3. Safety net: a positive recurring charge we couldn't classify exactly is
  // still a PAYING member — grant Superfan rather than dropping to free. (A
  // null/0 amount with no price-id match stays unclassified, e.g. cancellations.)
  if (typeof amountCents === "number" && amountCents > 0) {
    return { tier: "superfan", interval: intervalHint ?? null };
  }

  return { tier: null, interval: intervalHint ?? null };
}

// The subset of a profile row this module reads when merging in new state.
export interface ExistingMembershipProfile {
  membership_tier?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  role?: string | null;
}

export interface MembershipInputs {
  tier: Tier;
  interval: Interval;
  customerId: string | null;
  subscriptionId: string | null;
  status: string;
  currentPeriodEnd?: string | null;
  canceled?: boolean;
}

// Build the deterministic `profiles` update for a membership event. Identical
// logic to the original members webhook so both entry points stay in lockstep.
// Admins are never downgraded; a cancel clears the paid fields and drops the
// role back to "free".
export function buildMembershipUpdate(
  inputs: MembershipInputs,
  profile: ExistingMembershipProfile,
): Record<string, unknown> {
  const canceled = !!inputs.canceled || inputs.status === "canceled";
  return {
    membership_status: canceled
      ? "free"
      : inputs.status === "past_due"
        ? "past_due"
        : "active",
    membership_tier: canceled ? null : inputs.tier ?? profile.membership_tier ?? null,
    membership_interval: canceled ? null : inputs.interval ?? null,
    stripe_customer_id: inputs.customerId ?? profile.stripe_customer_id ?? null,
    stripe_subscription_id: canceled
      ? null
      : inputs.subscriptionId ?? profile.stripe_subscription_id ?? null,
    membership_expires_at: canceled ? null : inputs.currentPeriodEnd ?? null,
    membership_updated_at: new Date().toISOString(),
    role:
      profile.role === "admin"
        ? "admin"
        : canceled
          ? "free"
          : inputs.tier ?? profile.membership_tier ?? profile.role ?? "free",
  };
}
