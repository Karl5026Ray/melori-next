import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";
import { isSuperfanOrBetter, FREE_SAMPLE_SECONDS } from "@/lib/membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const EXPIRES_IN = 3600;
const UUID_RE = /^[0-9a-f-]{36}$/i;

// GET /api/studio/tracks/[id]/stream — signed URL for a `studio_tracks` row.
//
// This mirrors the legacy `/api/tracks/[id]/stream` contract (integer ids)
// so the client audio pipeline can be unified against a single response
// shape. Membership gating is the same:
//   - Superfan-or-better: full-length audio.
//   - Everyone else: dedicated `preview_url` clip if present, otherwise
//     the full file with a client-side 30s cap.
//
// Listen logging fires only for authenticated superfans+ and excludes
// self-listens by the owning artist, matching the legacy route.
export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    if (!UUID_RE.test(params.id)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: track, error } = await supabaseAdmin
      .from("studio_tracks")
      .select("id, audio_url, preview_url, status, profile_id")
      .eq("id", params.id)
      .eq("status", "published")
      .maybeSingle();

    if (error) throw error;
    if (!track) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { profile, userId: listenerId } = await getRequestMembership(request);
    const fullAccess = isSuperfanOrBetter(profile);

    const sourcePath = fullAccess
      ? track.audio_url ?? track.preview_url
      : track.preview_url ?? track.audio_url;

    if (!sourcePath) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const sample = !fullAccess;
    const dedicatedPreview = !fullAccess && Boolean(track.preview_url);
    if (sample && !dedicatedPreview) {
      console.warn(
        `studio/tracks/${params.id}/stream: serving full audio to free listener — no preview_url; 30s cap is client-side only.`,
      );
    }

    const { data: signed, error: signError } = await supabaseAdmin.storage
      .from("audio-files")
      .createSignedUrl(sourcePath, EXPIRES_IN);

    if (signError) throw signError;
    if (!signed?.signedUrl) {
      throw new Error("Signed URL generation returned no URL");
    }

    // studio_tracks doesn't currently carry preview_start/preview_end; the
    // preview file is assumed to be short. Free listeners without a
    // dedicated preview fall back to the standard [0, FREE_SAMPLE_SECONDS]
    // window on the client, same as legacy.
    const previewStart = 0;
    const previewEnd = FREE_SAMPLE_SECONDS;
    const windowed = sample && !dedicatedPreview;

    // Listen logging: superfan+ only, exclude self-listens, fire-and-forget.
    if (
      fullAccess &&
      listenerId &&
      track.profile_id &&
      listenerId !== track.profile_id
    ) {
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
      url: signed.signedUrl,
      expiresIn: EXPIRES_IN,
      sample,
      sampleSeconds: windowed ? previewEnd - previewStart : null,
      previewStart: windowed ? previewStart : null,
      previewEnd: windowed ? previewEnd : null,
      dedicatedPreview,
    });
  } catch (err) {
    console.error(`GET /api/studio/tracks/${params.id}/stream failed:`, err);
    return NextResponse.json(
      { error: "Failed to create stream URL" },
      { status: 500 },
    );
  }
}
