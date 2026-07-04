import { NextResponse } from "next/server";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/artist/submissions — list the caller's own track submissions.
export async function GET(req: Request) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("track_submissions")
    .select("*")
    .eq("profile_id", guard.membership.userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("List artist submissions error:", error);
    return NextResponse.json({ error: "Failed to load submissions" }, { status: 500 });
  }
  return NextResponse.json({ submissions: data ?? [] });
}

// POST /api/artist/submissions — create a new pending submission after the
// audio (and optional cover) have been uploaded via /api/artist/upload-url.
export async function POST(req: Request) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const releaseType = typeof body.release_type === "string" ? body.release_type : "single";
  const genre = typeof body.genre === "string" ? body.genre.trim() : null;
  const description = typeof body.description === "string" ? body.description.trim() : null;
  const audioUrl = typeof body.audio_url === "string" ? body.audio_url : "";
  const coverUrl = typeof body.cover_url === "string" ? body.cover_url : null;
  const fileSize = typeof body.file_size_bytes === "number" ? body.file_size_bytes : null;
  const duration = typeof body.duration_sec === "number" ? body.duration_sec : null;

  if (!title || title.length > 200) {
    return NextResponse.json({ error: "Title must be 1–200 chars" }, { status: 400 });
  }
  if (!audioUrl) {
    return NextResponse.json({ error: "audio_url is required" }, { status: 400 });
  }
  if (!["single", "ep", "album"].includes(releaseType)) {
    return NextResponse.json({ error: "Invalid release_type" }, { status: 400 });
  }
  if (description && description.length > 2000) {
    return NextResponse.json({ error: "Description too long" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Try to link the submission to an existing artist row that this profile owns.
  const { data: linkedArtist } = await supabase
    .from("artists")
    .select("id")
    .eq("profile_id", guard.membership.userId)
    .maybeSingle();

  const { data, error } = await supabase
    .from("track_submissions")
    .insert({
      profile_id: guard.membership.userId,
      artist_id: linkedArtist?.id ?? null,
      title,
      release_type: releaseType,
      genre,
      description,
      audio_url: audioUrl,
      cover_url: coverUrl,
      file_size_bytes: fileSize,
      duration_sec: duration,
      status: "pending",
    })
    .select()
    .single();

  if (error) {
    console.error("Create artist submission error:", error);
    return NextResponse.json({ error: "Failed to create submission" }, { status: 500 });
  }
  return NextResponse.json({ submission: data }, { status: 201 });
}
