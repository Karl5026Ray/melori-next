import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { jwtVerify } from "jose";
import { getAdminSecret } from "@/lib/admin-secret";

// Always run this route dynamically at request time. It reads cookies and
// queries Supabase, so it must never be statically evaluated during `next build`.
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

  try {
    const supabase = createServiceClient();

    const [
      { count: tracksCount },
      { count: releasesCount },
      { count: profilesCount },
      { count: artistsCount },
      { count: spacesCount },
      { count: pendingSubs },
    ] = await Promise.all([
      supabase.from("tracks").select("*", { count: "exact", head: true }),
      supabase.from("releases").select("*", { count: "exact", head: true }),
      supabase.from("profiles").select("*", { count: "exact", head: true }),
      supabase.from("artists").select("*", { count: "exact", head: true }),
      supabase.from("spaces").select("*", { count: "exact", head: true }),
      supabase
        .from("track_submissions")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending"),
    ]);

    return NextResponse.json({
      totalMembers: profilesCount || 0,
      totalArtists: artistsCount || 0,
      totalTracks: tracksCount || 0,
      totalReleases: releasesCount || 0,
      totalSpaces: spacesCount || 0,
      pendingSubmissions: pendingSubs || 0,
    });
  } catch (err: any) {
    console.error("Admin stats error:", err);
    return NextResponse.json({
      totalMembers: 0,
      totalArtists: 0,
      totalTracks: 0,
      totalReleases: 0,
      totalSpaces: 0,
      pendingSubmissions: 0,
    });
  }
}
