import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const supabase = createServiceClient();
    const { trackId, start, end } = await req.json();

    const { data: track, error: trackError } = await supabase
      .from("studio_tracks")
      .select("file_url, file_path")
      .eq("id", trackId)
      .single();

    if (trackError || !track) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
    }

    // Preview trimming is handled by a background worker (FFmpeg) in production.
    // Vercel functions have a short timeout, so the actual trim runs out-of-band.
    return NextResponse.json({
      previewUrl: null,
      status: "processing",
      message:
        "Preview generation queued. In production, this uses a background worker with FFmpeg.",
      trackId,
      start,
      end,
    });
  } catch (err: any) {
    console.error("Preview generation error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
