import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { OWNER_COLUMN } from "@/lib/studio-ownership";

// POST /api/studio/tracks/reorder
//
// Body: { album: string | null, orderedIds: string[] }
//
// Reassigns sort_order to 1..N within a single (owner_id, album) partition.
// Ownership is enforced by the OWNER_COLUMN filter on every UPDATE, so an
// artist can only reorder rows they own even if they submit someone else's
// track IDs.
//
// Concurrency: last write wins. Two artists reordering the same album from
// two tabs will produce whichever request lands last. That's acceptable for
// a personal-tool UI; a real conflict would require optimistic locking that
// the front-end can't currently surface.
export async function POST(req: NextRequest) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;

  let body: { album?: string | null; orderedIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const orderedIds = Array.isArray(body.orderedIds) ? body.orderedIds : null;
  if (!orderedIds || orderedIds.length === 0) {
    return NextResponse.json(
      { error: "orderedIds must be a non-empty array" },
      { status: 400 },
    );
  }
  if (!orderedIds.every((id) => typeof id === "string" && id.length > 0)) {
    return NextResponse.json(
      { error: "orderedIds entries must be non-empty strings" },
      { status: 400 },
    );
  }
  // De-dupe: if the client sends the same id twice we'd write two sort_order
  // values for one row and the higher one wins non-deterministically. Reject
  // rather than silently accept.
  if (new Set(orderedIds).size !== orderedIds.length) {
    return NextResponse.json(
      { error: "orderedIds contains duplicates" },
      { status: 400 },
    );
  }

  const albumFilter =
    typeof body.album === "string" && body.album.trim()
      ? body.album.trim()
      : null;

  const supabase = createServiceClient();
  const userId = guard.membership.userId;

  // Verify every id belongs to the caller AND to the specified album before
  // writing anything. If the client mixes albums (drag across groups), reject
  // — the reorder endpoint reorders WITHIN one album; cross-album moves go
  // through PATCH /api/studio/track/[id] which resets sort_order.
  const { data: owned, error: ownedError } = await supabase
    .from("studio_tracks")
    .select("id, album")
    .eq(OWNER_COLUMN, userId)
    .in("id", orderedIds as string[]);

  if (ownedError) {
    console.error("Reorder ownership check error:", ownedError);
    return NextResponse.json({ error: "Failed to verify ownership" }, { status: 500 });
  }
  if (!owned || owned.length !== orderedIds.length) {
    return NextResponse.json(
      { error: "One or more tracks are not owned by caller" },
      { status: 403 },
    );
  }
  const mismatched = owned.filter((row) => {
    const rowAlbum = row.album == null || row.album === "" ? null : row.album;
    return rowAlbum !== albumFilter;
  });
  if (mismatched.length > 0) {
    return NextResponse.json(
      { error: "One or more tracks do not belong to the specified album" },
      { status: 400 },
    );
  }

  // Write sort_order sequentially. We use per-row UPDATEs (not upsert)
  // because the row already exists and we don't want to overwrite unrelated
  // columns. Each UPDATE is scoped by (id, OWNER_COLUMN) so a spoofed id
  // from a different artist can't be modified.
  const errors: string[] = [];
  for (let i = 0; i < (orderedIds as string[]).length; i++) {
    const trackId = (orderedIds as string[])[i];
    const { error } = await supabase
      .from("studio_tracks")
      .update({ sort_order: i + 1 })
      .eq("id", trackId)
      .eq(OWNER_COLUMN, userId);
    if (error) {
      errors.push(`${trackId}: ${error.message}`);
    }
  }

  if (errors.length > 0) {
    console.error("Reorder update errors:", errors);
    return NextResponse.json(
      { error: "Failed to reorder some tracks", details: errors },
      { status: 500 },
    );
  }

  // Reorder can affect what a public visitor sees on /music (if any tracks
  // in this album are published, their order there changes). Cheap bust —
  // if nothing is published this is a no-op on the next request.
  revalidatePath("/music");
  revalidatePath("/");

  return NextResponse.json({ success: true, count: orderedIds.length });
}
