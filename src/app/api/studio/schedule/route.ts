import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { OWNER_COLUMN } from "@/lib/studio-ownership";

// GET /api/studio/schedule — Studio tracks that have a release date, for the calendar.
export async function GET(req: NextRequest) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("studio_tracks")
      .select("id, title, release_date, status, type")
      .eq(OWNER_COLUMN, guard.membership.userId)
      .not("release_date", "is", null)
      .order("release_date", { ascending: true });

    if (error) {
      return NextResponse.json({ releases: [] });
    }

    const releases = (data || []).map((t: any) => ({
      id: t.id,
      title: t.title,
      releaseDate: t.release_date,
      status: t.status,
      type: t.type === "album_track" ? "album" : "single",
    }));

    return NextResponse.json({ releases });
  } catch (err) {
    console.error("Schedule API error:", err);
    return NextResponse.json({ releases: [] });
  }
}
