import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getAdminSecret } from "@/lib/admin-secret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin auth — mirrors every other /api/admin route: verify the signed
// `admin_session` cookie against ADMIN_JWT_SECRET. Owner-scoped studio routes
// (/api/studio/*) only let an artist touch their OWN tracks; this route is the
// site owner's cross-artist management surface for the public uploads
// collection, so it uses the admin service client (bypasses RLS) after the
// admin-cookie check.
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

// GET /api/admin/studio-tracks
// List every studio_tracks row across ALL artists so the owner can manage the
// public uploads collection. Sorted alphabetically by title (case-insensitive)
// to match how the public /music collection renders, with created_at as a
// tie-break.
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

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("studio_tracks")
    .select(
      "id, title, artist, album, genre, status, cover_url, duration, sort_order, profile_id, owner_id, created_at",
    )
    .limit(1000);

  if (error) {
    return NextResponse.json(
      { error: error.message ?? "Failed to load tracks" },
      { status: 500 },
    );
  }

  const tracks = (data ?? []).slice().sort((a, b) => {
    const at = (a.title ?? "").toLowerCase();
    const bt = (b.title ?? "").toLowerCase();
    const cmp = at.localeCompare(bt);
    if (cmp !== 0) return cmp;
    return (
      new Date(a.created_at ?? 0).getTime() -
      new Date(b.created_at ?? 0).getTime()
    );
  });

  return NextResponse.json({ tracks });
}
