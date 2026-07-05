// Shared membership model + gating helpers.
//
// Membership lives in Supabase `profiles`:
//   - membership_tier: 'free' | 'superfan' | 'artist' | 'admin'  (artist is the TOP paid tier)
//   - membership_status: e.g. 'active'
//   - membership_expires_at: timestamptz | null
//
// NOTE: the DB column is actually `role`; membership-server.ts maps role -> membership_tier
// before these helpers run, so `membership_tier` here may hold 'admin'.
//
// Tier ranking (ascending): free < superfan < artist. Admins are treated as top
// tier for access purposes and bypass the active-subscription requirement.
//
// This module is pure and client-safe (no server-only imports). Reuse it on both
// the client (UI gating / CTAs) and the server (route handlers). Server-side
// request-profile resolution lives in `membership-server.ts`.

export type MembershipTier = "free" | "superfan" | "artist";

export interface MembershipProfile {
  membership_tier?: string | null;
  membership_status?: string | null;
  membership_expires_at?: string | null;
    // Internal/comp access flags. Any of these grants full access without a paid tier.
  is_comp?: boolean | null;
  billing_exempt?: boolean | null;
  is_internal_test?: boolean | null;
}

// True when the caller is a platform administrator (profiles.role === 'admin').
export function isAdmin(profile: MembershipProfile | null | undefined): boolean {
  return (profile?.membership_tier ?? "").toLowerCase() === "admin";
}

export function tierOf(profile: MembershipProfile | null | undefined): MembershipTier {
  const t = (profile?.membership_tier ?? "free").toLowerCase();
  if (t === "admin") return "artist"; // admins treated as top tier
  if (t === "artist") return "artist";
  if (t === "superfan") return "superfan";
  return "free";
}

// Active = status is 'active' (a missing status is treated as active) AND the
// membership has no expiry, or an expiry in the future.
export function isActive(profile: MembershipProfile | null | undefined): boolean {
  if (!profile) return false;
  const status = (profile.membership_status ?? "active").toLowerCase();
  if (status !== "active") return false;
  const expires = profile.membership_expires_at;
  if (expires) {
    const ts = new Date(expires).getTime();
    if (Number.isFinite(ts) && ts < Date.now()) return false;
  }
  return true;

  // Comp access: internal test, complimentary, or billing-exempt profiles. These are
  // staff/test accounts that should never be paywalled but are not paying members.
  export function isComp(profile: MembershipProfile | null | undefined): boolean {
    if (!profile) return false;
    return Boolean(profile.is_comp || profile.billing_exempt || profile.is_internal_test);
    }

// "Superfan or better" — admins always qualify; otherwise active AND tier in
// ['superfan', 'artist'].
export function isSuperfanOrBetter(profile: MembershipProfile | null | undefined): boolean {
  if (isAdmin(profile)) return true;
  // Comp / billing-exempt / internal-test accounts get full access regardless of paid tier.
  if (isComp(profile)) return true;
  if (!isActive(profile)) return false;
  const tier = tierOf(profile);
  return tier === "superfan" || tier === "artist";
}

// Studio access — admins always qualify; otherwise active AND tier === 'artist'.
export function isArtistSubscriber(profile: MembershipProfile | null | undefined): boolean {
  if (isAdmin(profile)) return true;
  return isActive(profile) && tierOf(profile) === "artist";
}

// Seconds of a full track a non-superfan free listener may hear.
export const FREE_SAMPLE_SECONDS = 30;
