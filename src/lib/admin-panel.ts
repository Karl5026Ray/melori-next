import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getRequestMembership } from "@/lib/membership-server";
import { isAdmin } from "@/lib/membership";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

// Server-only helpers for the User/Artist management admin panel.
//
// Authorization is the "melori way": the caller forwards their Supabase access
// token as `Authorization: Bearer <token>` (localStorage-based auth, no
// cookies). We resolve the caller with the shared bearer helper in
// membership-server, then require profiles.role === 'admin' — the single source
// of truth. This intentionally does NOT touch the legacy cookie/admin_session
// panel; it is a separate, self-contained gate.

export interface AdminCaller {
  userId: string;
  email: string | null;
}

// Resolve + gate the caller. Returns the admin identity, or a NextResponse
// (401/403) the route should return as-is.
export async function requireAdmin(
  request: Request,
): Promise<AdminCaller | NextResponse> {
  const membership = await getRequestMembership(request);
  if (!membership.userId) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  // membership-server maps profiles.role onto MembershipProfile.membership_tier,
  // and isAdmin() reads role ?? membership_tier — so this stays in lockstep with
  // the resolver even though the object has no bare `role` field.
  if (!isAdmin(membership.profile)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  return { userId: membership.userId, email: membership.email };
}

export function isAdminGuardFailure(
  result: AdminCaller | NextResponse,
): result is NextResponse {
  return result instanceof NextResponse;
}

export type AdminAction =
  | "create"
  | "update"
  | "role_change"
  | "reset_password"
  | "suspend"
  | "reactivate"
  | "delete";

// Write an audit row with the service-role client (bypasses RLS). Best-effort:
// a logging failure must never fail the underlying admin action, so we swallow
// errors after logging them to the server console.
export async function logAdminAction(
  admin: AdminCaller,
  params: {
    action: AdminAction;
    targetType: "user" | "artist";
    targetId: string;
    details?: Record<string, unknown>;
  },
  client?: SupabaseClient,
): Promise<void> {
  const supabase = client ?? getSupabaseAdmin();
  const { error } = await supabase.from("admin_activity_logs").insert({
    admin_id: admin.userId,
    admin_email: admin.email,
    action: params.action,
    target_type: params.targetType,
    target_id: params.targetId,
    details: params.details ?? {},
  });
  if (error) {
    console.error("admin_activity_logs insert failed:", error.message);
  }
}

// Count profiles that are active admins. Used to guard the "last admin"
// invariant: we must never demote, suspend, or delete the final admin and lock
// everyone out of the panel.
export async function countActiveAdmins(client?: SupabaseClient): Promise<number> {
  const supabase = client ?? getSupabaseAdmin();
  const { count, error } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin")
    .eq("status", "active");
  if (error) {
    console.error("countActiveAdmins failed:", error.message);
    // Fail closed: treat as if this is the last admin so we don't accidentally
    // strip the final admin when the count query is unavailable.
    return 1;
  }
  return count ?? 0;
}

// Generate a URL-safe temporary password (~12 chars) for admin-created accounts
// and password resets. Uses crypto for unpredictability.
export function generateTempPassword(length = 14): string {
  const alphabet =
    "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export const ADMIN_ROLES = ["free", "superfan", "artist", "admin"] as const;
export const ADMIN_STATUSES = ["active", "suspended", "deleted"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];
export type AdminStatus = (typeof ADMIN_STATUSES)[number];
