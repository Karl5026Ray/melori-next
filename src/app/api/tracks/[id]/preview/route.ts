import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveAudioUrl } from "@/lib/supabase/storagePath";
import {
  DOOR_PREVIEW_URL_TTL_SECONDS,
  isDoorPreviewTrack,
} from "@/lib/doorPreviews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/tracks/[id]/preview — a 30-second sample for a signed-out visitor.
//
// Karl, 16 Nov 2026: strangers can hear a few hand-picked songs on the door
// before making an account. This route is the ONLY way audio reaches someone
// who is not signed in, and it is deliberately narrow:
//   • only ids in DOOR_PREVIEW_TRACK_IDS (anything else: 401, as /stream does)
//   • only the preview clip (tracks.preview_url) — it never falls back to the
//     master in audio_url, unlike /stream
//   • only while both the track and its release are published
//   • a signed URL that lives five minutes
export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const { id: raw } = await props.params;
  const id = Number(raw);

  // Checked before any database call: a stranger probing ids costs nothing
  // and learns nothing.
  if (!Number.isInteger(id) || !isDoorPreviewTrack(id)) {
    return NextResponse.json(
      { error: "Create a free account to listen", requiresAuth: true },
      { status: 401 },
    );
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data: track, error } = await supabaseAdmin
      .from("tracks")
      // The release must be published too: hiding a release has to stop its
      // previews, not just its page.
      .select("id, preview_url, release:releases!inner(is_published)")
      .eq("id", id)
      .eq("is_published", true)
      .eq("moderation_status", "clean")
      .eq("release.is_published", true)
      .maybeSingle();
    if (error) throw error;
    if (!track?.preview_url) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const url = await resolveAudioUrl(
      supabaseAdmin,
      "audio-files",
      track.preview_url,
      DOOR_PREVIEW_URL_TTL_SECONDS,
    );
    if (!url) throw new Error("Could not sign preview");

    return NextResponse.json(
      { url, expiresIn: DOOR_PREVIEW_URL_TTL_SECONDS, preview: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error(`GET /api/tracks/${raw}/preview failed:`, err);
    return NextResponse.json({ error: "Preview unavailable" }, { status: 500 });
  }
}
