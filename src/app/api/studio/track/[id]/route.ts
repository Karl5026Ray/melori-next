import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { assertTrackOwnership, isOwnershipFailure } from "@/lib/studio-ownership";

// GET /api/studio/track/[id] — Get single studio track
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  try {
    const supabase = createServiceClient();
    const ownership = await assertTrackOwnership(
      supabase,
      params.id,
      guard.membership.userId,
      "title, artist, album, genre, file_url, preview_url, preview_start, preview_end, duration, status"
    );
    if (isOwnershipFailure(ownership)) return ownership;

    return NextResponse.json(ownership.row);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
