import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getAdminSecret } from "@/lib/admin-secret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function verifyAdmin(req: NextRequest) {
  const token = req.cookies.get("admin_session")?.value;
  if (!token) return false;
  const ADMIN_SECRET = getAdminSecret();
  if (!ADMIN_SECRET) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(ADMIN_SECRET));
    return true;
  } catch {
    return false;
  }
}

// GET /api/admin/users?q=&role=all|superfan|artist|admin&limit=100
// Paginated user list for the Users & Artists admin tab.
export async function GET(req: NextRequest) {
  const ADMIN_SECRET = getAdminSecret();
  if (!ADMIN_SECRET) {
    return NextResponse.json(
      { error: "Admin auth is not configured on this server." },
      { status: 503 },
    );
  }

  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl;
  const q = (url.searchParams.get("q") ?? "").trim();
  const role = url.searchParams.get("role") ?? "all";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("profiles")
    .select(
      "id, username, display_name, full_name, avatar_url, role, membership_tier, membership_status, membership_expires_at, verified, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (role !== "all") query = query.eq("role", role);
  if (q) {
    // Case-insensitive across the three name-ish columns.
    query = query.or(
      `username.ilike.%${q}%,display_name.ilike.%${q}%,full_name.ilike.%${q}%`,
    );
  }

  const { data, error } = await query;
  if (error) {
    console.error("Admin users list error:", error);
    return NextResponse.json({ error: "Failed to list users" }, { status: 500 });
  }
  return NextResponse.json({ users: data ?? [] });
}
