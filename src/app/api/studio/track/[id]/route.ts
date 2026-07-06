import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import {
  assertTrackOwnership,
  isOwnershipFailure,
  OWNER_COLUMN,
  isOwnedStudioPath,
  isOwnedStudioFileUrl,
} from "@/lib/studio-ownership";

// GET /api/studio/track/[id] — Get single studio track
//
// The audio-files bucket is private, so the raw `file_url` (a getPublicUrl
// output) cannot be fetched from the browser. Return a short-lived signed
// download URL as `audioUrl` instead. Legacy rows written before this fix
// only have `file_url` populated — fall back to it in that case so existing
// tracks still load until they are replaced.
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
      "title, artist, album, genre, file_url, file_path, preview_url, preview_start, preview_end, duration, status"
    );
    if (isOwnershipFailure(ownership)) return ownership;

    const track = ownership.row;

    let audioUrl: string | null = null;
    const filePath =
      typeof track.file_path === "string" && track.file_path.trim()
        ? track.file_path
        : null;
    if (filePath) {
      const { data: signed } = await supabase.storage
        .from("audio-files")
        .createSignedUrl(filePath, 60 * 60); // 1 hour is plenty for an edit session.
      audioUrl = signed?.signedUrl ?? null;
    }
    if (!audioUrl) audioUrl = track.file_url ?? null;

    // The WaveformEditor consumes camelCase fields; expose aliases alongside the
    // raw columns so it can load the master audio and preview window directly.
    return NextResponse.json({
      ...track,
      audioUrl,
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
// Ownership: gated by requireArtist AND assertTrackOwnership so an artist can
// only replace the master of their own track, matching every other studio
// route. The final update is also scoped by OWNER_COLUMN as defense-in-depth.
export async function PATCH(
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
      guard.membership.userId
    );
    if (isOwnershipFailure(ownership)) return ownership;

    const body = await req.json().catch(() => ({}));

    const update: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    // Master replacement — the primary purpose of this route. Both file_url
    // and file_path must be scoped under `studio/<callerUserId>/`. Without
    // this check an artist could point their own track row at another
    // artist's uploaded path; the GET route above signs `file_path` on read,
    // which would then hand out someone else's private master audio.
    let replacingMaster = false;
    const userId = guard.membership.userId;
    if (typeof body.file_url === "string" && body.file_url.trim()) {
      if (!isOwnedStudioFileUrl(body.file_url, userId)) {
        return NextResponse.json(
          { error: "file_url is not scoped to caller" },
          { status: 400 },
        );
      }
      update.file_url = body.file_url;
      replacingMaster = true;
    }
    if (typeof body.file_path === "string" && body.file_path.trim()) {
      if (!isOwnedStudioPath(body.file_path, userId)) {
        return NextResponse.json(
          { error: "file_path is not scoped to caller" },
          { status: 400 },
        );
      }
      update.file_path = body.file_path;
    }
    if (body.duration != null) {
      const d = Number(body.duration);
      if (Number.isFinite(d) && d >= 0) update.duration = d;
    }

    // Publish / unpublish. The DB CHECK constraint only permits these three
    // values, so validate before writing to avoid a raw constraint error.
    // Ownership was already asserted above (owner or admin via requireArtist +
    // assertTrackOwnership), and the update is scoped by OWNER_COLUMN below.
    if (body.status != null) {
      const allowed = ["draft", "scheduled", "published"] as const;
      if (!allowed.includes(body.status)) {
        return NextResponse.json(
          { error: "Invalid status" },
          { status: 400 },
        );
      }
      update.status = body.status;
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
      .eq(OWNER_COLUMN, userId)
      .select("id, status")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      previewCleared: replacingMaster,
      track: data,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
