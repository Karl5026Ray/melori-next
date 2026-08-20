import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveAudioUrl } from "@/lib/supabase/storagePath";
import { getRequestMembership } from "@/lib/membership-server";
import { isSuperfanOrBetter, FREE_SAMPLE_SECONDS } from "@/lib/membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const EXPIRES_IN = 3600;

// GET /api/tracks/[id]/stream — a short-lived signed URL for the track's audio.
//
// Membership gating (server-enforced — the browser sends its Supabase access
// token as `Authorization: Bearer`):
//   - Superfan-or-better (active superfan/artist): full-length `audio_url`.
//   - Everyone else (free / logged-out): a 30-second sample only. If the track
//     has a dedicated `preview_url` clip we sign THAT (the full file is never
//     handed out); otherwise we sign the full file but flag it as a sample so
//     the player hard-caps playback at 30s.
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const id = Number(params.id);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Join to releases -> artists to resolve the owning artist's profile_id;
    // needed so a listen event can be attributed to the correct artist. Kept
    // as a single query so the hot streaming path stays one round-trip.
    const { data: track, error } = await supabaseAdmin
      .from("tracks")
      .select(
        "id, audio_url, preview_url, preview_start, preview_end, is_published, release:releases!inner(artist:artists!inner(profile_id))",
      )
      .eq("id", id)
      .eq("is_published", true)
      .eq("moderation_status", "clean") // publish-first: don't stream flagged/removed tracks
      .maybeSingle();

    if (error) throw error;
    if (!track) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { profile, userId: listenerId } = await getRequestMembership(request);
    const fullAccess = isSuperfanOrBetter(profile);

    // Resolve the owning artist's profile_id from the embed. Supabase returns
    // embedded relations as either an object or a single-item array depending
    // on join shape, so normalize before reading `profile_id`.
    const rel = (track as any).release;
    const releaseObj = Array.isArray(rel) ? rel[0] : rel;
    const artistObj = releaseObj && (Array.isArray(releaseObj.artist) ? releaseObj.artist[0] : releaseObj.artist);
    const artistOwnerId: string | null = artistObj?.profile_id ?? null;

    // Superfans get the full track; free users get the dedicated sample clip if
    // one exists, else the full path capped client-side at 30s.
    //
    // NOTE: when a free listener is served the full file with a client-side
    // cap, the cap is cosmetic — the signed URL is directly fetchable. To
    // fully protect unpurchased tracks, always publish a dedicated
    // `preview_url` clip. The admin/tracks flow supports generating one via
    // /api/studio/generate-preview. This route logs a warning whenever it
    // falls back so we can surface unprotected tracks operationally.
    const sourcePath = fullAccess
      ? track.audio_url ?? track.preview_url
      : track.preview_url ?? track.audio_url;

    if (!sourcePath) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // A free listener is served a sample whenever they lack full access. When a
    // dedicated preview clip exists the sample is inherently short; otherwise the
    // player must enforce the 30s cap on the full file.
    const sample = !fullAccess;
    const dedicatedPreview = !fullAccess && Boolean(track.preview_url);
    if (sample && !dedicatedPreview) {
      console.warn(
        `tracks/${id}/stream: serving full audio to free listener — track has no preview_url; client-side 30s cap is cosmetic. Generate a preview to protect this track.`,
      );
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

    // For a free listener served the full file, the audible window is the
    // admin-chosen [preview_start, preview_end] range (defaults 0..30). The
    // player seeks to previewStart and hard-caps at previewEnd. A dedicated
    // preview clip is already short, so no window is imposed on it.
    const rawStart = Number(track.preview_start ?? 0);
    const rawEnd = Number(track.preview_end ?? FREE_SAMPLE_SECONDS);
    const previewStart =
      Number.isFinite(rawStart) && rawStart >= 0 ? rawStart : 0;
    const previewEnd =
      Number.isFinite(rawEnd) && rawEnd > previewStart
        ? rawEnd
        : previewStart + FREE_SAMPLE_SECONDS;

    const windowed = sample && !dedicatedPreview;

    // Fire-and-forget: log a listen event when a superfan+ streams the full
    // track. We DO NOT block the response on this insert — playback should
    // start even if analytics logging fails. Free/anon streams are excluded
    // because the product definition of "superfan" is account holders with
    // an active tier; anonymous samples don't count toward the leaderboard.
    //
    // Self-listens (artist streaming their own track) are also excluded, so
    // artists can't inflate their own leaderboard by hitting refresh.
    if (fullAccess && listenerId && artistOwnerId && listenerId !== artistOwnerId) {
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
      sample,
      // Cap the full file for free users; a dedicated preview is already short so
      // no client cap is imposed on it.
      sampleSeconds: windowed ? previewEnd - previewStart : null,
      previewStart: windowed ? previewStart : null,
      previewEnd: windowed ? previewEnd : null,
      dedicatedPreview,
    });
  } catch (err) {
    console.error(`GET /api/tracks/${params.id}/stream failed:`, err);
    return NextResponse.json(
      { error: "Failed to create stream URL" },
      { status: 500 },
    );
  }
}
