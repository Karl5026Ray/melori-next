import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";

// GET /api/studio/track/[id] — Get single studio track
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
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

    // The WaveformEditor consumes camelCase fields; expose aliases alongside the
    // raw columns so it can load the master audio and preview window directly.
    return NextResponse.json({
      ...track,
      audioUrl: track.file_url,
      previewUrl: track.preview_url,
      previewStart: track.preview_start,
      previewEnd: track.preview_end,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PATCH /api/studio/track/[id] — Replace an existing track's master audio.
//
// Ownership: gated by requireArtist, mirroring every other studio route
// (GET/POST /api/studio/tracks and the preview PATCH). The studio_tracks table
// has no per-artist owner column in the current schema, so the artist-tier
// membership guard is the ownership boundary used across the studio API.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  try {
    const supabase = createServiceClient();
    const body = await req.json().catch(() => ({}));

    const update: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    // Master replacement — the primary purpose of this route.
    let replacingMaster = false;
    if (typeof body.file_url === "string" && body.file_url.trim()) {
      update.file_url = body.file_url;
      replacingMaster = true;
    }
    if (typeof body.file_path === "string" && body.file_path.trim()) {
      update.file_path = body.file_path;
    }
    if (body.duration != null) {
      const d = Number(body.duration);
      if (Number.isFinite(d) && d >= 0) update.duration = d;
    }

    // Optional metadata edits.
    if (typeof body.title === "string" && body.title.trim())
      update.title = body.title.trim();
    if (typeof body.artist === "string") update.artist = body.artist.trim();
    if (typeof body.album === "string") update.album = body.album.trim() || null;
    if (typeof body.genre === "string") update.genre = body.genre.trim() || null;

    // When the master is replaced, the previously generated 30-second preview
    // points at the old audio and is now stale. Clear it so nothing plays a
    // broken/mismatched clip; the artist re-picks the window on the new master.
    if (replacingMaster) {
      update.preview_url = null;
      update.preview_start = null;
      update.preview_end = null;
    }

    if (
      !replacingMaster &&
      Object.keys(update).length === 1 // only updated_at
    ) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("studio_tracks")
      .update(update)
      .eq("id", params.id)
      .select("id")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, previewCleared: replacingMaster });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
