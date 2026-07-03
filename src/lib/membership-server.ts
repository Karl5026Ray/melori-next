import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
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

export interface RequestMembership {
  userId: string | null;
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
  if (!token) return { userId: null, profile: null };

  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !anonKey) return { userId: null, profile: null };

  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data?.user) return { userId: null, profile: null };
  const userId = data.user.id;

  const admin = getSupabaseAdmin();
  const { data: profile } = await admin
    .from("profiles")
    .select("membership_tier, membership_status, membership_expires_at")
    .eq("id", userId)
    .maybeSingle();

  return { userId, profile: (profile as MembershipProfile) ?? null };
}

// Guards: return a NextResponse (401/403) when the caller is not authorized,
// otherwise return the resolved membership so the handler can proceed.
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
  if (!isSuperfanOrBetter(membership.profile)) {
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
  if (!isArtistSubscriber(membership.profile)) {
    return NextResponse.json(
      { error: "Artist membership required", upgrade: "/membership" },
      { status: 403 },
    );
  }
  return { membership };
}

export function isGuardFailure(
  result: { membership: RequestMembership } | NextResponse,
): result is NextResponse {
  return result instanceof NextResponse;
}
