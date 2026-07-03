import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

// GET /api/studio/track/[id] — Get single studio track
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createServiceClient();
    const { data: track, error } = await supabase
      .from("studio_tracks")
      .select(
        "id, title, artist, album, genre, file_url, preview_url, preview_start, preview_end, duration, status"
      )
      .eq("id", params.id)
      .single();

    if (error || !track) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
    }

    return NextResponse.json(track);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
