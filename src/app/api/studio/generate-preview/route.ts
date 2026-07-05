import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { assertTrackOwnership, isOwnershipFailure, OWNER_COLUMN } from "@/lib/studio-ownership";

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

    // Validate the requested window. FFmpeg-based clip generation happens
    // out-of-band; even without a rendered clip we save the [start, end]
    // range on the track row so /api/tracks/[id]/stream can serve a windowed
    // preview from the full file. Without this save, the client generate
    // button used to silently do nothing.
    const s = Number(start);
    const e = Number(end);
    if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e <= s) {
      return NextResponse.json(
        { error: "Invalid preview window" },
        { status: 400 },
      );
    }

    // Defense-in-depth: the update is already guarded by assertTrackOwnership
    // above, but repeat the owner filter on the update itself so a race or a
    // refactor of the ownership helper can't turn this into a cross-tenant write.
    const { error: saveErr } = await supabase
      .from("studio_tracks")
      .update({ preview_start: s, preview_end: e })
      .eq("id", trackId)
      .eq(OWNER_COLUMN, guard.membership.userId);
    if (saveErr) {
      console.error("generate-preview save error:", saveErr);
      // Fall through — the client still gets a status so it can react.
    }

    return NextResponse.json({
      previewUrl: null,
      status: "saved",
      message:
        "Preview window saved. A background worker renders the trimmed clip.",
      trackId,
      previewStart: s,
      previewEnd: e,
    });
  } catch (err: any) {
    console.error("Preview generation error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
