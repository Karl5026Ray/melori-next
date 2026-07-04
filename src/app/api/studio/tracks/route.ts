import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { OWNER_COLUMN } from "@/lib/studio-ownership";

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
export async function POST(req: NextRequest) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  try {
    const supabase = createServiceClient();
    const body = await req.json();

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
        [OWNER_COLUMN]: guard.membership.userId,
      })
      .select("id")
      .single();

    if (error) {
      console.error("Insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ id: data.id, success: true });
  } catch (err: any) {
    console.error("Create track error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
