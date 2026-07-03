import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";

// GET /api/studio/analytics — Aggregate play/revenue analytics for studio tracks.
// Revenue splits 70/30 in the artist's favor.
export async function GET(req: NextRequest) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  try {
    const supabase = createServiceClient();

    const { count: tracksCount } = await supabase
      .from("studio_tracks")
      .select("id", { count: "exact", head: true });

    const { data: analytics } = await supabase
      .from("track_analytics")
      .select("*");

    const totalStreams = (analytics || []).reduce(
      (sum, a: any) => sum + (a.streams || a.plays || 0),
      0
    );
    const totalDownloads = (analytics || []).reduce(
      (sum, a: any) => sum + (a.downloads || 0),
      0
    );
    const totalRevenue = (analytics || []).reduce(
      (sum, a: any) => sum + (a.revenue || 0),
      0
    );

    return NextResponse.json({
      totalStreams,
      totalDownloads,
      totalRevenue,
      artistShare: totalRevenue * 0.7,
      platformShare: totalRevenue * 0.3,
      tracksCount: tracksCount || 0,
      topTrack: null,
      monthlyData: [],
    });
  } catch (err) {
    console.error("Analytics API error:", err);
    return NextResponse.json({
      totalStreams: 0,
      totalDownloads: 0,
      totalRevenue: 0,
      artistShare: 0,
      platformShare: 0,
      tracksCount: 0,
      topTrack: null,
      monthlyData: [],
    });
  }
}
