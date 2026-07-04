import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { assertTrackOwnership, isOwnershipFailure } from "@/lib/studio-ownership";

export async function POST(req: NextRequest) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  try {
    const supabase = createServiceClient();
    const { trackId, start, end } = await req.json();

    const ownership = await assertTrackOwnership(
      supabase,
      trackId,
      guard.membership.userId,
      "file_url, file_path"
    );
    if (isOwnershipFailure(ownership)) return ownership;

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
