import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveAudioUrl } from "@/lib/supabase/storagePath";
import { getRequestMembership } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const EXPIRES_IN = 3600;

// GET /api/tracks/[id]/stream — a short-lived signed URL for the track's audio.
//
// MUSIC IS FREE, BUT NOT ANONYMOUS. Every signed-in account — free or any other
// role — gets the full-length master. There is no membership tier, no 30-second
// sample and no preview window. An unauthenticated request gets 401: the
// catalog opens at first sign in, not before it.
//
// The previous design gated on isSuperfanOrBetter() and, for free listeners,
// either signed a dedicated `preview_url` clip or — far more commonly, because
// no preview-rendering worker was ever built — signed the FULL master anyway
// and asked the browser to stop at 30 seconds. That cap was cosmetic: the
// signed URL was directly fetchable. So the paywall protected nothing while
// still costing a real listener the rest of the song.
//
// The response keeps its original shape so the client needs no change. `sample`
// is now always false, which means PlayerProvider never arms its playback cap.
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const id = Number(params.id);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Resolve the caller FIRST. An anonymous request never reaches the
    // database — it costs nothing and leaks nothing about the catalog.
    const { userId: listenerId } = await getRequestMembership(request);
    if (!listenerId) {
      return NextResponse.json(
        { error: "Create a free account to listen", requiresAuth: true },
        { status: 401 },
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Join to releases -> artists to resolve the owning artist's profile_id;
    // needed so a listen event can be attributed to the correct artist. Kept
    // as a single query so the hot streaming path stays one round-trip.
    const { data: track, error } = await supabaseAdmin
      .from("tracks")
      .select(
        "id, audio_url, preview_url, is_published, release:releases!inner(artist:artists!inner(profile_id))",
      )
      .eq("id", id)
      .eq("is_published", true)
      .eq("moderation_status", "clean") // publish-first: don't stream flagged/removed tracks
      .maybeSingle();

    if (error) throw error;
    if (!track) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Resolve the owning artist's profile_id from the embed. Supabase returns
    // embedded relations as either an object or a single-item array depending
    // on join shape, so normalize before reading `profile_id`.
    const rel = (track as any).release;
    const releaseObj = Array.isArray(rel) ? rel[0] : rel;
    const artistObj = releaseObj && (Array.isArray(releaseObj.artist) ? releaseObj.artist[0] : releaseObj.artist);
    const artistOwnerId: string | null = artistObj?.profile_id ?? null;

    // Always the full master. `preview_url` remains only as a fallback for the
    // handful of rows where `audio_url` was never populated.
    const sourcePath = track.audio_url ?? track.preview_url;

    if (!sourcePath) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const playbackUrl = await resolveAudioUrl(
      supabaseAdmin,
      "audio-files",
      sourcePath,
      EXPIRES_IN,
    );
    if (!playbackUrl) {
      throw new Error("Could not resolve a playable URL for the track audio");
    }

    // Fire-and-forget: log the listen. We DO NOT block the response on this
    // insert — playback should start even if analytics logging fails.
    //
    // Self-listens (artist streaming their own track) are excluded, so artists
    // can't inflate their own leaderboard by hitting refresh.
    if (artistOwnerId && listenerId !== artistOwnerId) {
      void supabaseAdmin
        .from("track_listens")
        .insert({
          legacy_track_id: id,
          listener_id: listenerId,
          artist_owner_id: artistOwnerId,
        })
        .then(({ error: logErr }) => {
          if (logErr) {
            // Non-fatal — just observability.
            console.warn(`tracks/${id}/stream: listen log failed`, logErr.message);
          }
        });
    }

    return NextResponse.json({
      url: playbackUrl,
      expiresIn: EXPIRES_IN,
      // Retained for client compatibility. Music is free to members, so
      // playback is never sampled or windowed.
      sample: false,
      sampleSeconds: null,
      previewStart: null,
      previewEnd: null,
      dedicatedPreview: false,
    });
  } catch (err) {
    console.error(`GET /api/tracks/${params.id}/stream failed:`, err);
    return NextResponse.json(
      { error: "Failed to create stream URL" },
      { status: 500 },
    );
  }
}
