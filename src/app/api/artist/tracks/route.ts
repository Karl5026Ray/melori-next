import { NextResponse } from "next/server";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { revalidatePath, revalidateTag } from "next/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/artist/tracks — PUBLISH-FIRST replacement for the old
// POST /api/artist/submissions approval flow.
//
// Instead of creating a `pending` track_submissions row and waiting for an admin
// to approve + publish, this creates the release + track immediately as PUBLISHED
// and returns the live track. A track_submissions row is still written (status
// 'auto_published') purely as a historical/report record. The post-upload
// track-cleanup edge function fires asynchronously off the INSERT and can
// flag/remove afterward without disrupting the artist.
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
  const duration = typeof body.duration_sec === "number" ? body.duration_sec : null;

  // ---- same validation as the old submissions route ----
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

  const userId = guard.membership.userId;
  const submissionFolder = `submissions/${userId}/`;
  if (audioUrl.includes("..") || !audioUrl.includes(submissionFolder)) {
    return NextResponse.json({ error: "audio_url is not scoped to caller" }, { status: 400 });
  }
  if (audioUrl.length > 2048) {
    return NextResponse.json({ error: "audio_url too long" }, { status: 400 });
  }
  if (coverUrl && (coverUrl.includes("..") || !coverUrl.includes(submissionFolder))) {
    return NextResponse.json({ error: "cover_url is not scoped to caller" }, { status: 400 });
  }
  if (genre && genre.length > 60) {
    return NextResponse.json({ error: "Genre too long" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Ensure the caller has an artist row (auto-create for a true self-serve flow).
  let { data: artist } = await supabase
    .from("artists")
    .select("id")
    .eq("profile_id", userId)
    .maybeSingle();

  if (!artist) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name, username, full_name")
      .eq("id", userId)
      .maybeSingle();
    const name =
      profile?.display_name || profile?.full_name || profile?.username || "New Artist";
    const artistSlug =
      `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50)}-${Date.now().toString(36)}`;
    const { data: createdArtist, error: artErr } = await supabase
      .from("artists")
      .insert({ name, slug: artistSlug, profile_id: userId, is_published: true })
      .select("id")
      .single();
    if (artErr || !createdArtist) {
      console.error("Auto-create artist failed:", artErr);
      return NextResponse.json({ error: "Could not create artist profile" }, { status: 500 });
    }
    artist = createdArtist;
  }

  // Build a URL-safe slug (same approach as the old approval path).
  const baseSlug =
    title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) ||
    `track-${Date.now()}`;
  const slug = `${baseSlug}-${Date.now().toString(36)}`;

  // Create release + track PUBLISHED immediately. Defaults are now true, but we
  // set them explicitly for clarity and to be independent of DB default drift.
  const { data: release, error: relErr } = await supabase
    .from("releases")
    .insert({
      title,
      slug,
      artist_id: artist.id,
      release_type: releaseType,
      description,
      cover_art_url: coverUrl,
      release_date: new Date().toISOString().slice(0, 10),
      is_published: true,
    })
    .select("id")
    .single();
  if (relErr || !release) {
    console.error("Publish-first release create failed:", relErr);
    return NextResponse.json({ error: "Failed to create release" }, { status: 500 });
  }

  const { data: track, error: trackErr } = await supabase
    .from("tracks")
    .insert({
      title,
      release_id: release.id,
      track_number: 1,
      duration_seconds: duration,
      audio_url: audioUrl,
      is_published: true,
      // moderation_status defaults to 'clean'; published_at auto-stamped by trigger.
    })
    .select("id, title, release_id, is_published, moderation_status, published_at")
    .single();
  if (trackErr || !track) {
    console.error("Publish-first track create failed:", trackErr);
    return NextResponse.json({ error: "Failed to create track" }, { status: 500 });
  }

  // History/report record (not a gate). status uses new 'auto_published' vocab.
  await supabase.from("track_submissions").insert({
    profile_id: userId,
    artist_id: artist.id,
    title,
    release_type: releaseType,
    genre,
    description,
    audio_url: audioUrl,
    cover_url: coverUrl,
    duration_sec: duration,
    status: "auto_published",
    approved_track_id: track.id,
    reviewed_at: new Date().toISOString(),
  });

  // Instant UI: bust caches so the track appears immediately on public pages.
  // (Client feeds using useRealtime<'tracks'> will also receive the INSERT event.)
  revalidateTag(`artist-${artist.id}`);
  revalidatePath("/browse");
  revalidatePath("/");

  return NextResponse.json({ track }, { status: 201 });
}
