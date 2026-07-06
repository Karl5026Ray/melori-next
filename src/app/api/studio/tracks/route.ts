import { NextRequest, NextResponse } from "next/server";
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
    const { data: tracks, error } = await supabase
      .from("studio_tracks")
      .select(
        "id, title, artist, album, genre, status, preview_url, created_at, duration"
      )
      .eq(OWNER_COLUMN, guard.membership.userId)
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

    return NextResponse.json({ ...data, success: true });
  } catch (err: any) {
    console.error("Create track error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
