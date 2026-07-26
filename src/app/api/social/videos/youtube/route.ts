import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { fetchYouTubeTitle, parseYouTubeUrl } from "@/lib/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/social/videos/youtube — publish a YouTube video to Melori Mirror.
//
// ARTIST-ONLY. Native uploads (POST /api/social/videos) are open to any signed-in
// member, but a YouTube post links out to content we don't host, so it is gated
// on the same requireArtist guard the rest of the artist tooling uses (admins
// pass it too).
//
// Nothing is downloaded or re-hosted: we store the canonical watch URL plus the
// extracted video id, and the feed renders an inline YouTube player. video_url
// stays populated so every existing consumer of social_videos (profile grids,
// /api/social/videos, the archive) keeps working without a source check.
//
// Body: { url, title?, description? }
export async function POST(req: NextRequest) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;

  try {
    const body = await req.json().catch(() => ({}) as Record<string, unknown>);

    const video = parseYouTubeUrl(body.url);
    if (!video) {
      return NextResponse.json(
        { error: "Paste a valid YouTube video link" },
        { status: 400 },
      );
    }

    const description =
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim().slice(0, 1000)
        : null;

    // Prefer the artist's own title. When they leave it blank, ask YouTube's
    // oEmbed endpoint; if that's unavailable the post still publishes with a
    // neutral placeholder rather than an empty card.
    const typedTitle =
      typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
    const title =
      typedTitle || (await fetchYouTubeTitle(video.id)) || "YouTube video";

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("social_videos")
      .insert({
        user_id: guard.membership.userId,
        title,
        description,
        // Canonical watch URL, rebuilt from the extracted id — never the raw
        // string the client sent.
        video_url: video.url,
        thumbnail_url: video.thumbnailUrl,
        media_type: "video",
        source: "youtube",
        youtube_id: video.id,
        youtube_url: video.url,
        // expires_at is left to the BEFORE INSERT trigger (created_at + 24h),
        // so YouTube posts rotate out of Mirror exactly like uploads.
      })
      .select("*")
      .single();

    if (error) {
      console.error("YouTube post insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    revalidatePath("/");
    revalidatePath("/social/video");
    revalidatePath("/social/mirror");

    return NextResponse.json({ ...data, success: true }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Create YouTube post error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
