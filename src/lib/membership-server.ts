import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  hasMembershipAccess,
  isAdmin,
  isArtistSubscriber,
  isSuperfanOrBetter,
  type MembershipProfile,
} from "@/lib/membership";

// Server-only membership resolution for route handlers.
//
// Supabase auth on the client is localStorage-based (no cookies), so the browser
// must forward its access token as `Authorization: Bearer <token>`. We verify the
// token with the anon client, then read the caller's membership row with the
// service-role admin client (bypasses RLS).
//
// NOTE: the `profiles` table stores tier + admin flag in a single `role` column
// (values: 'free' | 'superfan' | 'artist' | 'admin') alongside
// `membership_status` and `membership_expires_at` (populated by the Stripe
// members webhook). We read all three: `role` drives tier, and
// status + expiry drive the access/grace check (hasMembershipAccess) so a
// lapsed subscription actually loses access while admin-granted members (no
// expiry) never do.

export interface RequestMembership {
  userId: string | null;
  email: string | null;
  profile: MembershipProfile | null;
}

function bearerToken(request: Request): string | null {
  const header =
    request.headers.get("authorization") ??
    request.headers.get("Authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim() || null;
}

export async function getRequestMembership(
  request: Request,
): Promise<RequestMembership> {
  const token = bearerToken(request);
  if (!token) return { userId: null, email: null, profile: null };

  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !anonKey) return { userId: null, email: null, profile: null };

  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data?.user) return { userId: null, email: null, profile: null };

  const userId = data.user.id;
  const email = data.user.email ?? null;
  const admin = getSupabaseAdmin();
  const { data: row } = await admin
    .from("profiles")
    .select("role, membership_status, membership_expires_at")
    .eq("id", userId)
    .maybeSingle();

  const profile: MembershipProfile | null = row
    ? {
        role: (row as { role?: string | null }).role ?? "free",
        membership_tier: (row as { role?: string | null }).role ?? "free",
        membership_status:
          (row as { membership_status?: string | null }).membership_status ??
          null,
        membership_expires_at:
          (row as { membership_expires_at?: string | null })
            .membership_expires_at ?? null,
      }
    : null;

  return { userId, email, profile };
}

// Guards: return a NextResponse (401/403) when the caller is not authorized,
// otherwise return the resolved membership so the handler can proceed.

// Auth-only guard: any signed-in user passes (no tier requirement). Used for
// free-tier read/watch/listen access where publishing is gated separately.
export async function requireAuth(
  request: Request,
): Promise<{ membership: RequestMembership } | NextResponse> {
  const membership = await getRequestMembership(request);
  if (!membership.userId) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  return { membership };
}

export async function requireSuperfan(
  request: Request,
): Promise<{ membership: RequestMembership } | NextResponse> {
  const membership = await getRequestMembership(request);
  if (!membership.userId) {
    return NextResponse.json(
      { error: "Sign in required" },
      { status: 401 },
    );
  }
  if (!paidAccessAllowed(membership.profile, isSuperfanOrBetter)) {
    return NextResponse.json(
      { error: "Superfan membership required", upgrade: "/membership" },
      { status: 403 },
    );
  }
  return { membership };
}

export async function requireArtist(
  request: Request,
): Promise<{ membership: RequestMembership } | NextResponse> {
  const membership = await getRequestMembership(request);
  if (!membership.userId) {
    return NextResponse.json(
      { error: "Sign in required" },
      { status: 401 },
    );
  }
  if (!paidAccessAllowed(membership.profile, isArtistSubscriber)) {
    return NextResponse.json(
      { error: "Artist membership required", upgrade: "/membership" },
      { status: 403 },
    );
  }
  return { membership };
}

// A paid guard passes when the caller holds the required tier AND their
// membership is currently accessible (active, in past_due grace, or admin-
// granted with no expiry). Admins always pass. This is what wires expiry/status
// enforcement into the gates: previously they keyed off role alone, so a lapsed
// subscriber kept access until Stripe fired subscription.deleted.
function paidAccessAllowed(
  profile: MembershipProfile | null,
  tierCheck: (p: MembershipProfile | null | undefined) => boolean,
): boolean {
  if (isAdmin(profile)) return true;
  return tierCheck(profile) && hasMembershipAccess(profile);
}

export function isGuardFailure(
  result: { membership: RequestMembership } | NextResponse,
): result is NextResponse {
  return result instanceof NextResponse;
}
