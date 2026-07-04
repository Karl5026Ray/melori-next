import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { assertTrackOwnership, isOwnershipFailure, OWNER_COLUMN } from "@/lib/studio-ownership";

// PATCH /api/studio/track/[id]/preview — Update preview settings
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  try {
    const supabase = createServiceClient();
    const body = await req.json();

    const ownership = await assertTrackOwnership(
      supabase,
      params.id,
      guard.membership.userId
    );
    if (isOwnershipFailure(ownership)) return ownership;

    const { error } = await supabase
      .from("studio_tracks")
      .update({
        preview_url: body.previewUrl,
        preview_start: body.previewStart,
        preview_end: body.previewEnd,
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.id)
      .eq(OWNER_COLUMN, guard.membership.userId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
