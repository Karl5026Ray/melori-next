import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { OWNER_COLUMN } from "@/lib/studio-ownership";

// GET /api/studio/analytics — Aggregate play/revenue analytics for studio tracks.
// Revenue splits 70/30 in the artist's favor.
export async function GET(req: NextRequest) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  try {
    const supabase = createServiceClient();

    const { count: tracksCount } = await supabase
      .from("studio_tracks")
      .select("id", { count: "exact", head: true })
      .eq(OWNER_COLUMN, guard.membership.userId);

    // Only aggregate analytics for tracks the caller owns. Previously this
    // read every row in track_analytics, so every artist saw the whole
    // platform's numbers.
    const { data: ownedTracks } = await supabase
      .from("studio_tracks")
      .select("id")
      .eq(OWNER_COLUMN, guard.membership.userId);
    const ownedIds = (ownedTracks ?? []).map((t: any) => t.id);

    let analytics: any[] | null = [];
    if (ownedIds.length > 0) {
      const { data } = await supabase
        .from("track_analytics")
        .select("*")
        .in("track_id", ownedIds);
      analytics = data;
    }

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

    // Melori takes 0% on music sales. The artist keeps the full sale price
    // minus Stripe's processing fee (~2.9% + $0.30 per transaction). We show
    // an estimated net using the percentage component; the $0.30 fixed part is
    // per-transaction and reconciled precisely by Stripe on payout.
    const STRIPE_PCT = 0.029;
    const estimatedProcessingFees = totalRevenue * STRIPE_PCT;
    return NextResponse.json({
      totalStreams,
      totalDownloads,
      totalRevenue,
      artistShare: totalRevenue - estimatedProcessingFees,
      platformShare: 0,
      processingFees: estimatedProcessingFees,
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
