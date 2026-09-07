import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveAudioUrl } from "@/lib/supabase/storagePath";
import { getRequestMembership } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const EXPIRES_IN = 3600;
const UUID_RE = /^[0-9a-f-]{36}$/i;

// GET /api/studio/tracks/[id]/stream — signed URL for a `studio_tracks` row.
//
// MUSIC IS FREE. Mirrors the legacy `/api/tracks/[id]/stream` contract: every
// listener gets the full-length master, there is no membership gate and no
// sample window. See that route for the reasoning.
//
// Listen logging fires for any authenticated listener and still excludes
// self-listens by the owning artist.
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    if (!UUID_RE.test(params.id)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: track, error } = await supabaseAdmin
      .from("studio_tracks")
      .select("id, file_url, file_path, preview_url, status, profile_id")
      .eq("id", params.id)
      .eq("status", "published")
      .eq("moderation_status", "clean")
      .maybeSingle();

    if (error) throw error;
    if (!track) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { userId: listenerId } = await getRequestMembership(request);

    // Prefer `file_path` (a bare Storage object key) for signing. Fall back to
    // `file_url` — historically a full public URL, which toObjectKey() reduces
    // to a key before signing — and finally to `preview_url` for rows where no
    // master was ever attached.
    const sourcePath = track.file_path ?? track.file_url ?? track.preview_url;

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

    // Listen logging: any authenticated listener, exclude self-listens,
    // fire-and-forget.
    if (listenerId && track.profile_id && listenerId !== track.profile_id) {
      void supabaseAdmin
        .from("track_listens")
        .insert({
          studio_track_id: track.id,
          listener_id: listenerId,
          artist_owner_id: track.profile_id,
        })
        .then(({ error: logErr }) => {
          if (logErr) {
            console.warn(
              `studio/tracks/${params.id}/stream: listen log failed`,
              logErr.message,
            );
          }
        });
    }

    return NextResponse.json({
      url: playbackUrl,
      expiresIn: EXPIRES_IN,
      // Retained for client compatibility. Music is free, so playback is never
      // sampled or windowed.
      sample: false,
      sampleSeconds: null,
      previewStart: null,
      previewEnd: null,
      dedicatedPreview: false,
    });
  } catch (err) {
    console.error(`GET /api/studio/tracks/${params.id}/stream failed:`, err);
    return NextResponse.json(
      { error: "Failed to create stream URL" },
      { status: 500 },
    );
  }
}
