import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/releases/[slug] — a single published release, its artist, and published tracks.
export async function GET(_request: Request, props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data: release, error: releaseError } = await supabaseAdmin
      .from("releases")
      .select("*")
      .eq("slug", params.slug)
      .eq("is_published", true)
      .maybeSingle();

    if (releaseError) throw releaseError;
    if (!release) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { data: artist, error: artistError } = await supabaseAdmin
      .from("artists")
      .select("name, slug")
      .eq("id", release.artist_id)
      .maybeSingle();

    if (artistError) throw artistError;

    const { data: tracks, error: tracksError } = await supabaseAdmin
      .from("tracks")
      .select(
        "id, title, release_id, track_number, duration_seconds, audio_url, preview_url, price, is_published, created_at",
      )
      .eq("release_id", release.id)
      .eq("is_published", true)
      // Publish-first: hide only tracks an admin explicitly took down. A strict
      // `= 'clean'` match wrongly hid legitimately-published tracks whose status
      // is NULL (older rows) or a transient review state (pending_review/flagged).
      .or("moderation_status.is.null,moderation_status.neq.removed")
      .order("track_number", { ascending: true });

    if (tracksError) throw tracksError;

    return NextResponse.json({
      release,
      artist: artist ?? null,
      tracks: tracks ?? [],
    });
  } catch (err) {
    console.error(`GET /api/releases/${params.slug} failed:`, err);
    return NextResponse.json(
      { error: "Failed to load release" },
      { status: 500 },
    );
  }
}
