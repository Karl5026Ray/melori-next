import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";
import { tierOf } from "@/lib/membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/user/me — the signed-in user's profile + resolved tier.
// Caller is identified from the Supabase access token (Authorization: Bearer …).
// Reads with the service-role client so it never depends on RLS or a page-level
// select tripping over an optional column — this is the resilient data source
// the /settings and /superfan pages fetch so they never hang.
export async function GET(req: NextRequest) {
  const { userId, email } = await getRequestMembership(req);
  if (!userId) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: error.message ?? "Could not load profile" },
      { status: 500 },
    );
  }

  const row = (data as Record<string, any>) ?? {};
  const role = (row.role as string | undefined) ?? "free";

  return NextResponse.json({
    id: userId,
    email,
    role,
    tier: tierOf({ membership_tier: role }),
    isAdmin: role === "admin",
    profile: {
      id: userId,
      username: row.username ?? null,
      display_name: row.display_name ?? null,
      full_name: row.full_name ?? null,
      avatar_url: row.avatar_url ?? null,
      bio: row.bio ?? null,
      role,
      membership_status: row.membership_status ?? null,
      membership_tier: row.membership_tier ?? role,
      membership_interval: row.membership_interval ?? null,
      membership_expires_at: row.membership_expires_at ?? null,
      notifications_email: row.notifications_email ?? true,
    },
  });
}
