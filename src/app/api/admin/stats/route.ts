import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { jwtVerify } from "jose";

const ADMIN_SECRET =
  process.env.ADMIN_JWT_SECRET || "melori-admin-fallback-secret";

async function verifyAdmin(req: NextRequest) {
  const token = req.cookies.get("admin_session")?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(ADMIN_SECRET));
    return true;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();

    const [
      { count: tracksCount },
      { count: releasesCount },
      { count: membersCount },
    ] = await Promise.all([
      supabase.from("tracks").select("*", { count: "exact", head: true }),
      supabase.from("releases").select("*", { count: "exact", head: true }),
      supabase
        .from("membership_tiers")
        .select("*", { count: "exact", head: true }),
    ]);

    const { data: orders } = await supabase
      .from("orders")
      .select("amount, created_at")
      .order("created_at", { ascending: false })
      .limit(10);

    const totalRevenue =
      orders?.reduce((sum, o: any) => sum + (o.amount || 0), 0) || 0;

    return NextResponse.json({
      totalRevenue: totalRevenue / 100, // cents to dollars
      totalOrders: orders?.length || 0,
      totalMembers: membersCount || 0,
      totalTracks: tracksCount || 0,
      totalReleases: releasesCount || 0,
      recentOrders: orders || [],
    });
  } catch (err: any) {
    console.error("Admin stats error:", err);
    return NextResponse.json({
      totalRevenue: 0,
      totalOrders: 0,
      totalMembers: 0,
      totalTracks: 0,
      totalReleases: 0,
      recentOrders: [],
    });
  }
}
