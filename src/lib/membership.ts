// Shared membership model + gating helpers.
//
// Membership lives in Supabase `profiles`. `role` is the SOURCE OF TRUTH:
//   - role: 'free' | 'superfan' | 'artist' | 'admin'  (artist is the TOP paid tier)
//   - membership_status: e.g. 'active'
//   - membership_tier / membership_expires_at: derived Stripe fields; may be
//     ABSENT (null) for members whose role was granted directly (e.g. by an admin
//     via /api/admin/users) rather than through the Stripe flow.
//
// Because role is authoritative and is reset to 'free' on cancellation, tier
// resolution and the "superfan-or-above" gate key off role first (falling back to
// membership_tier for legacy callers that only carry the derived field). This
// keeps the client gate (which loads the raw profile row, so it has `role`) and
// the server gate (membership-server.ts maps role -> membership_tier) in lockstep
// so the check can't drift again.
//
// This module is pure and client-safe (no server-only imports). Reuse it on both
// the client (UI gating / CTAs) and the server (route handlers). Server-side
// request-profile resolution lives in `membership-server.ts`.

export type MembershipTier = "free" | "superfan" | "artist";

export interface MembershipProfile {
  role?: string | null;
  membership_tier?: string | null;
  membership_status?: string | null;
  membership_expires_at?: string | null;
}

// The effective tier string, preferring `role` (source of truth) and falling
// back to the derived `membership_tier` for callers that only pass the latter.
function effectiveTierString(
  profile: MembershipProfile | null | undefined,
): string {
  return (profile?.role ?? profile?.membership_tier ?? "free")
    .toString()
    .toLowerCase();
}

// True when the caller is a platform administrator (profiles.role === 'admin').
export function isAdmin(profile: MembershipProfile | null | undefined): boolean {
  return effectiveTierString(profile) === "admin";
}

export function tierOf(profile: MembershipProfile | null | undefined): MembershipTier {
  const t = effectiveTierString(profile);
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
}

// Canonical "superfan-or-above" predicate — the SINGLE definition shared by the
// client gate (UpgradePrompt / useCanParticipate) and the server gate
// (membership-server.requireSuperfan). Qualifies when role is in
// {superfan, artist, admin}. We do NOT require an active subscription status
// here: role is the source of truth and is reset to 'free' on cancellation, so
// an admin-granted artist (whose membership_status may still be the default
// 'inactive') correctly counts as a paying-tier member. Only `free`/logged-out
// users are excluded.
export function isSuperfanOrBetter(profile: MembershipProfile | null | undefined): boolean {
  const tier = tierOf(profile);
  return tier === "superfan" || tier === "artist";
}

// Studio access — role is 'artist' or 'admin'. Same role-first rationale as
// isSuperfanOrBetter above.
export function isArtistSubscriber(profile: MembershipProfile | null | undefined): boolean {
  return tierOf(profile) === "artist";
}

// Seconds of a full track a non-superfan free listener may hear.
export const FREE_SAMPLE_SECONDS = 30;
