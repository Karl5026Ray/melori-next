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
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    if (!UUID_RE.test(params.id)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: track, error } = await supabaseAdmin
      .from("studio_tracks")
      .select("id, file_url, file_path, preview_url, preview_start, preview_end, status, profile_id")
      .eq("id", params.id)
      .eq("status", "published")
      .maybeSingle();

    if (error) throw error;
    if (!track) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { profile, userId: listenerId } = await getRequestMembership(request);
    const fullAccess = isSuperfanOrBetter(profile);

    // Prefer `file_path` (Supabase Storage object key) for signing. Fall back
    // to `file_url` if that's what was populated. Preview mirrors the same
    // logic for free listeners.
    const fullPath = track.file_path ?? track.file_url;
    const sourcePath = fullAccess
      ? fullPath ?? track.preview_url
      : track.preview_url ?? fullPath;

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

    // Free listeners without a dedicated preview clip get a windowed sample.
    // Use the track's own preview_start/preview_end if set, else default to
    // [0, FREE_SAMPLE_SECONDS] — same behavior as the legacy route.
    const previewStart = Number(track.preview_start ?? 0) || 0;
    const previewEnd =
      Number(track.preview_end ?? 0) > previewStart
        ? Number(track.preview_end)
        : previewStart + FREE_SAMPLE_SECONDS;
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
