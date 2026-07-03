import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
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
export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const id = Number(params.id);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { data: track, error } = await supabaseAdmin
      .from("tracks")
      .select("id, audio_url, preview_url, preview_start, preview_end, is_published")
      .eq("id", id)
      .eq("is_published", true)
      .maybeSingle();

    if (error) throw error;
    if (!track) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { profile } = await getRequestMembership(request);
    const fullAccess = isSuperfanOrBetter(profile);

    // Superfans get the full track; free users get the dedicated sample clip if
    // one exists, else the full path capped client-side at 30s.
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

    const { data: signed, error: signError } = await supabaseAdmin.storage
      .from("audio-files")
      .createSignedUrl(sourcePath, EXPIRES_IN);

    if (signError) throw signError;
    if (!signed?.signedUrl) {
      throw new Error("Signed URL generation returned no URL");
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

    return NextResponse.json({
      url: signed.signedUrl,
      expiresIn: EXPIRES_IN,
      sample,
      // Cap the full file for free users; a dedicated preview is already short so
      // no client cap is imposed on it.
      sampleSeconds: windowed ? previewEnd - previewStart : null,
      previewStart: windowed ? previewStart : null,
      previewEnd: windowed ? previewEnd : null,
    });
  } catch (err) {
    console.error(`GET /api/tracks/${params.id}/stream failed:`, err);
    return NextResponse.json(
      { error: "Failed to create stream URL" },
      { status: 500 },
    );
  }
}
