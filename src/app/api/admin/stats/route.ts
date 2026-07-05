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

    const { data: orders } = await supabase
      .from("orders")
      .select("total_amount, created_at")
      .order("created_at", { ascending: false })
      .limit(30);

    const totalRevenue =
      orders?.reduce(
        (sum: number, o: any) => sum + Number(o.total_amount || 0),
        0,
      ) || 0;

    // Membership breakdown for the Overview tab.
    const { data: memberBreakdown } = await supabase
      .from("profiles")
      .select("membership_tier")
      .limit(10000);
    const tiers = { free: 0, superfan: 0, artist: 0 };
    for (const row of memberBreakdown ?? []) {
      const t = ((row as any).membership_tier ?? "free") as keyof typeof tiers;
      if (t in tiers) tiers[t]++;
      else tiers.free++;
    }

    return NextResponse.json({
      totalRevenue,
      totalOrders: orders?.length || 0,
      totalMembers: profilesCount || 0,
      totalArtists: artistsCount || 0,
      totalTracks: tracksCount || 0,
      totalReleases: releasesCount || 0,
      totalSpaces: spacesCount || 0,
      pendingSubmissions: pendingSubs || 0,
      recentOrders: orders?.slice(0, 10) || [],
      memberBreakdown: tiers,
    });
  } catch (err: any) {
    console.error("Admin stats error:", err);
    return NextResponse.json({
      totalRevenue: 0,
      totalOrders: 0,
      totalMembers: 0,
      totalArtists: 0,
      totalTracks: 0,
      totalReleases: 0,
      totalSpaces: 0,
      pendingSubmissions: 0,
      recentOrders: [],
      memberBreakdown: { free: 0, superfan: 0, artist: 0 },
    });
  }
}
