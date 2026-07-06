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

// Amounts in cents. Superfan: 299 / 2999. Artist: 499 / 4999.
// (Legacy amounts 999/9999 kept as fallbacks so any in-flight subscriptions
// created before the price change still classify correctly.)
export function classifyPrice(amountCents: number | null | undefined): {
  tier: Tier;
  interval: Interval;
} {
  switch (amountCents) {
    case 299:
      return { tier: "superfan", interval: "month" };
    case 2999:
      return { tier: "superfan", interval: "year" };
    case 499:
      return { tier: "artist", interval: "month" };
    case 4999:
      return { tier: "artist", interval: "year" };
    // Legacy pricing fallbacks (pre July 2026):
    case 999:
      return { tier: "artist", interval: "month" };
    case 9999:
      return { tier: "artist", interval: "year" };
    default:
      return { tier: null, interval: null };
  }
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
