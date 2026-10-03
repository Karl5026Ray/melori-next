import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { type MembershipProfile } from "@/lib/membership";

// Server-only account resolution for route handlers.
//
// Supabase auth on the client is localStorage-based (no cookies), so the browser
// must forward its access token as `Authorization: Bearer <token>`. We verify the
// token with the anon client, then read the caller's `role` with the
// service-role admin client (bypasses RLS). Melori has no paid tiers; role only
// matters for admin checks.

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
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  const profile: MembershipProfile | null = row
    ? { role: (row as { role?: string | null }).role ?? "free" }
    : null;

  return { userId, email, profile };
}

// Guards: return a NextResponse (401/403) when the caller is not authorized,
// otherwise return the resolved membership so the handler can proceed.

// Auth-only guard: any signed-in user passes, logged-out callers get a 401.
// Melori has no paid tiers, so this is the only non-admin guard.
export async function requireAuth(
  request: Request,
): Promise<{ membership: RequestMembership } | NextResponse> {
  const membership = await getRequestMembership(request);
  if (!membership.userId) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  return { membership };
}

export function isGuardFailure(
  result: { membership: RequestMembership } | NextResponse,
): result is NextResponse {
  return result instanceof NextResponse;
}
