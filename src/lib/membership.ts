// Shared account model + gating helpers.
//
// Melori has no paid tiers, subscriptions or fees. `profiles.role` still holds
// 'free' | 'superfan' | 'artist' | 'admin' (legacy values), but the only role
// that changes what someone can do is 'admin'. Every other feature is gated on
// "is there a signed-in account".
//
// This module is pure and client-safe (no server-only imports). Reuse it on both
// the client (UI gating / CTAs) and the server (route handlers). Server-side
// request-profile resolution lives in `membership-server.ts`.

export interface MembershipProfile {
  role?: string | null;
}

// True when the caller is a platform administrator (profiles.role === 'admin').
export function isAdmin(profile: MembershipProfile | null | undefined): boolean {
  return (profile?.role ?? "").toString().toLowerCase() === "admin";
}

// True when there is a signed-in account. This is the single definition shared
// by the client gate (SignInPrompt / useCanParticipate) and the server gate
// (membership-server's requireAuth).
export function isSignedIn(profile: MembershipProfile | null | undefined): boolean {
  return profile != null;
}
