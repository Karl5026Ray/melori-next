import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import {
  OWNER_COLUMN,
  isOwnedStudioPath,
  isOwnedStudioFileUrl,
} from "@/lib/studio-ownership";

// GET /api/studio/tracks — List all studio tracks
export async function GET(req: NextRequest) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  try {
    const supabase = createServiceClient();
    // Ordering rationale: primary sort is (album, sort_order) so tracks within
    // the same album stay in the artist's chosen order. Tracks without an
    // album or without a sort_order fall back to created_at DESC (newest
    // first) so a freshly uploaded single lands at the top. NULLS LAST on
    // sort_order keeps un-positioned rows at the bottom of their album
    // grouping — otherwise a NULL would sort before 1 and reshuffle the album.
    const { data: tracks, error } = await supabase
      .from("studio_tracks")
      .select(
        "id, title, artist, album, genre, status, preview_url, created_at, duration, sort_order"
      )
      .eq(OWNER_COLUMN, guard.membership.userId)
      .order("album", { ascending: true, nullsFirst: false })
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Supabase error:", error);
      return NextResponse.json({ tracks: [] }, { status: 500 });
    }

    return NextResponse.json({ tracks: tracks || [] });
  } catch (err) {
    console.error("Tracks API error:", err);
    return NextResponse.json({ tracks: [] }, { status: 500 });
  }
}

// POST /api/studio/tracks — Create new studio track
//
// Path scoping: the client hands back `file_path` (and `file_url`) that came
// from /api/studio/upload-url, which always issues paths under
// `studio/<callerUserId>/`. Without this check an artist could submit another
// artist's path — the GET route signs whatever file_path is stored, so a
// forged path would leak someone else's private master. Reject anything not
// scoped under the caller's own subfolder before writing the row.
export async function POST(req: NextRequest) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  try {
    const supabase = createServiceClient();
    const body = await req.json();
    const userId = guard.membership.userId;

    // file_path is the field the GET route signs — it MUST be caller-scoped.
    if (
      body.file_path != null &&
      !isOwnedStudioPath(body.file_path, userId)
    ) {
      return NextResponse.json(
        { error: "file_path is not scoped to caller" },
        { status: 400 },
      );
    }
    // file_url is a getPublicUrl string that embeds the same path; validating
    // it stops a client from persisting a public URL pointing at someone
    // else's file even when file_path is omitted.
    if (
      body.file_url != null &&
      !isOwnedStudioFileUrl(body.file_url, userId)
    ) {
      return NextResponse.json(
        { error: "file_url is not scoped to caller" },
        { status: 400 },
      );
    }

    // Assign the next sort_order within this (owner_id, album) partition so a
    // newly created track lands at the end of its album, not somewhere
    // arbitrary. Two concurrent inserts to the same album could collide on
    // the same value (Postgres offers no easy per-partition sequence), but
    // a collision just means both share a slot until the artist reorders —
    // no data loss, no error. If album is null we still compute a bucket
    // value so "no album" ordering is deterministic.
    const albumForOrder = typeof body.album === "string" && body.album.trim()
      ? body.album.trim()
      : null;
    let nextSortOrder = 1;
    {
      const orderQuery = supabase
        .from("studio_tracks")
        .select("sort_order")
        .eq(OWNER_COLUMN, userId);
      const scoped = albumForOrder == null
        ? orderQuery.is("album", null)
        : orderQuery.eq("album", albumForOrder);
      const { data: existing } = await scoped
        .order("sort_order", { ascending: false, nullsFirst: false })
        .limit(1);
      if (existing && existing[0]?.sort_order != null) {
        nextSortOrder = existing[0].sort_order + 1;
      }
    }

    const { data, error } = await supabase
      .from("studio_tracks")
      .insert({
        title: body.title,
        artist: body.artist,
        album: body.album,
        genre: body.genre,
        release_date: body.release_date,
        file_url: body.file_url,
        file_path: body.file_path,
        cover_url: body.cover_url,
        type: body.type,
        sort_order: nextSortOrder,
        status: body.status || "draft",
        // Both ownership columns must be the caller's uid: profile_id
        // (OWNER_COLUMN, what studio routes filter by) AND owner_id (the column
        // RLS "Owners manage" / "Published viewable" policies check). Writing
        // only profile_id left owner_id null, so published-visibility and any
        // future anon reads broke; setting both keeps the row consistent.
        [OWNER_COLUMN]: userId,
        owner_id: userId,
      })
      .select("id, status, owner_id, profile_id")
      .single();

    if (error) {
      console.error("Insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // A new track — even a draft — shows up in the artist's own listings
    // immediately, and a track created with status="published" needs to hit
    // /music and the home feed on the next request. Both pages read via
    // Server Components, so bust them here rather than waiting for a
    // background revalidation tick.
    if (data?.status === "published") {
      revalidatePath("/");
      revalidatePath("/music");
      revalidatePath("/artists");
    }

    return NextResponse.json({ ...data, success: true });
  } catch (err: any) {
    console.error("Create track error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
