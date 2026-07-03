// Shared membership model + gating helpers.
//
// Membership lives in Supabase `profiles`:
//   - membership_tier: 'free' | 'superfan' | 'artist'  (artist is the TOP tier)
//   - membership_status: e.g. 'active'
//   - membership_expires_at: timestamptz | null
//
// Tier ranking (ascending): free < superfan < artist.
// An `artist` subscriber has ALL superfan privileges PLUS studio access.
//
// This module is pure and client-safe (no server-only imports). Reuse it on both
// the client (UI gating / CTAs) and the server (route handlers). Server-side
// request→profile resolution lives in `membership-server.ts`.

export type MembershipTier = "free" | "superfan" | "artist";

export interface MembershipProfile {
  membership_tier?: string | null;
  membership_status?: string | null;
  membership_expires_at?: string | null;
}

export function tierOf(profile: MembershipProfile | null | undefined): MembershipTier {
  const t = (profile?.membership_tier ?? "free").toLowerCase();
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
}

// "Superfan or better" — active AND tier in ['superfan', 'artist'].
export function isSuperfanOrBetter(profile: MembershipProfile | null | undefined): boolean {
  if (!isActive(profile)) return false;
  const tier = tierOf(profile);
  return tier === "superfan" || tier === "artist";
}

// Studio access — active AND tier === 'artist' (the top tier).
export function isArtistSubscriber(profile: MembershipProfile | null | undefined): boolean {
  return isActive(profile) && tierOf(profile) === "artist";
}

// Seconds of a full track a non-superfan free listener may hear.
export const FREE_SAMPLE_SECONDS = 30;
