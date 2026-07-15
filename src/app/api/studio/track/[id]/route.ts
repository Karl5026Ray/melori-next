import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import {
  assertTrackOwnership,
  isOwnershipFailure,
  OWNER_COLUMN,
  isOwnedStudioPath,
  isOwnedStudioFileUrl,
} from "@/lib/studio-ownership";

// Bust the public-site caches that surface studio_tracks (music catalog, home
// feed, artist pages, and any per-track deep link) whenever a track changes
// state that a viewer would see. Silent-safe: revalidatePath only queues an
// invalidation for the next request, so if a path doesn't exist yet it's a
// no-op instead of an error.
function revalidatePublicTrackPaths(trackId: string) {
  revalidatePath("/");
  revalidatePath("/music");
  revalidatePath(`/music/${trackId}`);
  revalidatePath("/artists");
}

// GET /api/studio/track/[id] — Get single studio track
//
// The audio-files bucket is private, so the raw `file_url` (a getPublicUrl
// output) cannot be fetched from the browser. Return a short-lived signed
// download URL as `audioUrl` instead. Legacy rows written before this fix
// only have `file_url` populated — fall back to it in that case so existing
// tracks still load until they are replaced.
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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

    // If album is changing, the track's existing sort_order refers to the OLD
    // album's ordering and would now collide with (or leave a gap in) the
    // NEW album. Recompute: append to the end of the destination album by
    // taking max(sort_order)+1 within that (owner_id, new album) partition.
    // The old album now has a gap at the vacated slot; that's harmless —
    // reordering the source album later re-normalizes 1..N.
    if ("album" in update) {
      const newAlbum: string | null = update.album;
      const orderQuery = supabase
        .from("studio_tracks")
        .select("sort_order")
        .eq(OWNER_COLUMN, userId)
        .neq("id", params.id); // exclude self so its own current value doesn't skew max
      const scoped =
        newAlbum == null
          ? orderQuery.is("album", null)
          : orderQuery.eq("album", newAlbum);
      const { data: existing } = await scoped
        .order("sort_order", { ascending: false, nullsFirst: false })
        .limit(1);
      update.sort_order =
        existing && existing[0]?.sort_order != null
          ? existing[0].sort_order + 1
          : 1;
    }

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

    // Bust the public-site cache whenever a studio track changes in a way a
    // viewer would see (publish/unpublish/title/master swap). Cheap no-op
    // when nothing on the public site references the id yet.
    revalidatePublicTrackPaths(params.id);

    return NextResponse.json({
      success: true,
      previewCleared: replacingMaster,
      track: data,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE /api/studio/track/[id] — remove a track and all of its storage
// artifacts. Order matters: fetch the row first so we know which paths to
// clean, delete the DB row (definitive record), THEN delete the storage
// objects. If the storage step fails we still return 200 with a `storageErrors`
// array — the row is already gone, so retrying the DELETE would 404. The
// admin can sweep any orphans separately; leaving the row behind is worse.
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const guard = await requireArtist(_req);
  if (isGuardFailure(guard)) return guard;

  const supabase = createServiceClient();

  // Ownership check + read the paths we need for storage cleanup in one shot.
  const ownership = await assertTrackOwnership(
    supabase,
    params.id,
    guard.membership.userId,
    "file_path, preview_url, cover_url",
  );
  if (isOwnershipFailure(ownership)) return ownership;

  const row = ownership.row as {
    file_path: string | null;
    preview_url: string | null;
    cover_url: string | null;
  };

  // Extract the storage-relative path from a public URL. Supabase public URLs
  // look like `<host>/storage/v1/object/public/<bucket>/<path>` — everything
  // after the bucket segment is the path we hand back to storage.remove().
  function pathFromPublicUrl(url: string | null, bucket: string): string | null {
    if (!url) return null;
    const marker = `/object/public/${bucket}/`;
    const idx = url.indexOf(marker);
    if (idx === -1) return null;
    return url.slice(idx + marker.length);
  }

  // Delete the row first — that's the source of truth users see. Even if
  // storage cleanup partially fails afterward, the track is gone from every
  // listing and detail page.
  const { error: deleteError } = await supabase
    .from("studio_tracks")
    .delete()
    .eq("id", params.id)
    .eq(OWNER_COLUMN, guard.membership.userId);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  const storageErrors: string[] = [];

  // Master audio in private `audio-files` bucket. file_path is stored raw
  // (already bucket-relative) so we pass it through directly.
  if (row.file_path) {
    const { error } = await supabase.storage
      .from("audio-files")
      .remove([row.file_path]);
    if (error) storageErrors.push(`audio-files:${error.message}`);
  }

  // Preview clip is stored as a public URL. Extract the object path so we can
  // ask storage to remove it. Skip silently if we can't parse the URL — it's
  // not worth a 500 to the user; the admin sweep can catch any orphan.
  const previewPath = pathFromPublicUrl(row.preview_url, "audio-files");
  if (previewPath) {
    const { error } = await supabase.storage
      .from("audio-files")
      .remove([previewPath]);
    if (error) storageErrors.push(`audio-files-preview:${error.message}`);
  }

  const coverPath = pathFromPublicUrl(row.cover_url, "covers");
  if (coverPath) {
    const { error } = await supabase.storage.from("covers").remove([coverPath]);
    if (error) storageErrors.push(`covers:${error.message}`);
  }

  revalidatePublicTrackPaths(params.id);

  return NextResponse.json({
    success: true,
    storageErrors: storageErrors.length ? storageErrors : undefined,
  });
}
